import type { PrismaClient, Prisma } from "@securelambda/db";
import type Redis from "ioredis";
import type { FacilitatorPort } from "@securelambda/facilitator";
import type { EvaluatorInput, PaymentAsset, SignedPayment, X402Accept } from "@securelambda/schemas";
import { MAX_RUN_ATTEMPTS, POLL_DEADLINE_MS, POLL_INTERVAL_MS, BACKGROUND_POLL_DEADLINE_MS } from "@securelambda/schemas";
import type { OutLayerClient } from "./outlayer-client";
import type { StorageClient } from "./storage-client";

export interface RunProcessorDeps {
  prisma: PrismaClient;
  redis: Redis;
  outlayer: OutLayerClient;
  facilitator: FacilitatorPort;
  storage: StorageClient;
  pollIntervalMs?: number;
  pollDeadlineMs?: number;
  backgroundPollDeadlineMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Implements the worker algorithm verbatim from docs/03 B5: claim under a
 * lock, submit, persist the tx hash before waiting, poll without treating a
 * timeout as failure, retry transient failures as fresh requests (at most
 * twice), check the attestation hash before ever settling, and never
 * charge the buyer for anything but a verified success.
 */
export class RunProcessor {
  private readonly pollIntervalMs: number;
  private readonly pollDeadlineMs: number;
  private readonly backgroundPollDeadlineMs: number;

  constructor(private readonly deps: RunProcessorDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.pollDeadlineMs = deps.pollDeadlineMs ?? POLL_DEADLINE_MS;
    this.backgroundPollDeadlineMs = deps.backgroundPollDeadlineMs ?? BACKGROUND_POLL_DEADLINE_MS;
  }

  async processRun(runId: string): Promise<void> {
    const { prisma, redis } = this.deps;

    const lockKey = `lock:run:${runId}`;
    // RN-14: duplicate queue delivery is resolved by a lock, not by luck.
    const locked = await redis.set(lockKey, "1", "PX", 30_000, "NX");
    if (!locked) return;

    try {
      let run = await this.loadRun(runId);
      if (!run) return;
      if (["SETTLED", "FAILED_NOT_CHARGED", "PAYMENT_REJECTED"].includes(run.state)) return; // already terminal

      if (run.state === "QUEUED") {
        run = await this.submit(run);
        if (!run) return; // someone else already claimed the QUEUED -> SUBMITTED transition
      }

      if (run.state === "SUBMITTED" || run.state === "RETRYING" || run.state === "POLLING") {
        await this.pollUntilDone(run);
      }
    } finally {
      await redis.del(lockKey);
    }
  }

  /** Re-attempts settlement for a run stuck in SETTLE_PENDING (docs/03 B12, B11 alerts). */
  async retrySettlement(runId: string): Promise<void> {
    const run = await this.loadRun(runId);
    if (!run || run.state !== "SETTLE_PENDING") return;
    await this.settleRun(run);
  }

  private async loadRun(runId: string) {
    const { prisma } = this.deps;
    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: {
        listing: { include: { evaluator: true } },
        model: { include: { asset: true } },
        payment: true,
      },
    });
    return run;
  }

  private async submit(run: NonNullable<Awaited<ReturnType<RunProcessor["loadRun"]>>>) {
    const { prisma } = this.deps;
    const input = await this.buildInput(run);
    const { txHash } = await this.deps.outlayer.requestExecution(run.listing.evaluator.projectId, input);

    // Persist the tx hash BEFORE polling (docs/03 B5: "stored BEFORE waiting").
    const claim = await prisma.run.updateMany({
      where: { id: run.id, state: "QUEUED" },
      data: { state: "SUBMITTED", execTxHash: txHash },
    });
    if (claim.count !== 1) return null;
    await this.logEvent(run.id, "QUEUED", "SUBMITTED", { execTxHash: txHash });
    return { ...run, state: "SUBMITTED" as const, execTxHash: txHash };
  }

  private async pollUntilDone(initialRun: NonNullable<Awaited<ReturnType<RunProcessor["loadRun"]>>>): Promise<void> {
    let run = initialRun;
    let deadline = Date.now() + this.pollDeadlineMs;
    const backgroundDeadline = Date.now() + this.backgroundPollDeadlineMs;
    let movedToPolling = run.state === "POLLING";

    while (Date.now() < backgroundDeadline) {
      const execTxHash = run.execTxHash;
      if (!execTxHash) return; // should never happen once SUBMITTED, defensive only
      const status = await this.deps.outlayer.txStatus(execTxHash);

      if (status.kind === "pending") {
        // RUN-02: an RPC/CLI timeout is "unknown", never a failure.
        if (Date.now() >= deadline && !movedToPolling) {
          await this.deps.prisma.run.update({ where: { id: run.id }, data: { state: "POLLING" } });
          await this.logEvent(run.id, run.state, "POLLING", {});
          movedToPolling = true;
        }
        await sleep(this.pollIntervalMs);
        continue;
      }

      if (status.success) {
        if (status.wasmHash !== run.listing.evaluator.wasmHash) {
          // RN-08 / SC-07: a hash mismatch blocks settlement and pauses the listing, never silently proceeds.
          await this.deps.prisma.$transaction([
            this.deps.prisma.attestation.upsert({
              where: { runId: run.id },
              create: { runId: run.id, wasmHash: status.wasmHash, verified: false, notes: "wasm hash did not match the listing" },
              update: { wasmHash: status.wasmHash, verified: false, notes: "wasm hash did not match the listing" },
            }),
            this.deps.prisma.run.update({ where: { id: run.id }, data: { state: "FAILED_NOT_CHARGED", errorCode: "EVALUATOR_MISMATCH" } }),
            this.deps.prisma.listing.update({ where: { id: run.listingId }, data: { status: "paused" } }),
          ]);
          await this.logEvent(run.id, run.state, "FAILED_NOT_CHARGED", { reason: "EVALUATOR_MISMATCH" });
          return;
        }

        await this.deps.prisma.$transaction([
          this.deps.prisma.attestation.upsert({
            where: { runId: run.id },
            create: { runId: run.id, wasmHash: status.wasmHash, verified: true },
            update: { wasmHash: status.wasmHash, verified: true },
          }),
          this.deps.prisma.run.update({
            where: { id: run.id },
            data: { state: "RESULT_READY", resultJson: { metrics: status.output.metrics, n_bucket: status.output.n_bucket } },
          }),
        ]);
        await this.logEvent(run.id, run.state, "RESULT_READY", {});
        run = { ...run, state: "RESULT_READY" };
        await this.settleRun(run);
        return;
      }

      // Failure.
      if (status.transient) {
        if (run.attempt + 1 < MAX_RUN_ATTEMPTS) {
          // RN-06/FR-09: re-enqueue as a FRESH request, at most 2 retries.
          const nextAttempt = run.attempt + 1;
          await this.deps.prisma.run.update({ where: { id: run.id }, data: { attempt: nextAttempt, state: "RETRYING" } });
          await this.logEvent(run.id, run.state, "RETRYING", { attempt: nextAttempt, reason: status.message });

          const input = await this.buildInput(run);
          const { txHash } = await this.deps.outlayer.requestExecution(run.listing.evaluator.projectId, input);
          await this.deps.prisma.run.update({ where: { id: run.id }, data: { state: "SUBMITTED", execTxHash: txHash } });
          await this.logEvent(run.id, "RETRYING", "SUBMITTED", { execTxHash: txHash });

          run = { ...run, state: "SUBMITTED", attempt: nextAttempt, execTxHash: txHash };
          deadline = Date.now() + this.pollDeadlineMs;
          movedToPolling = false;
          continue;
        }
        await this.finalizeFailed(run, status.code || "RUN_TIMEOUT_UNKNOWN");
        return;
      }

      // RN-07: a deterministic evaluator failure is never retried.
      await this.finalizeFailed(run, status.code);
      return;
    }

    // RN-16: no result within the background deadline. Still never charged; a late success (RN-17) is recorded as an audit note, not settled.
    await this.finalizeFailed(run, "RUN_TIMEOUT_UNKNOWN", { lateResultPossible: true });
  }

  private async finalizeFailed(
    run: { id: string; state: string },
    errorCode: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await this.deps.prisma.run.update({ where: { id: run.id }, data: { state: "FAILED_NOT_CHARGED", errorCode } });
    await this.logEvent(run.id, run.state, "FAILED_NOT_CHARGED", { errorCode, ...detail });
  }

  private async settleRun(run: NonNullable<Awaited<ReturnType<RunProcessor["loadRun"]>>>): Promise<void> {
    const payment = run.payment;
    if (!payment) {
      await this.finalizeFailed(run, "INTERNAL", { reason: "no payment row for a run reaching settlement" });
      return;
    }

    const signedPayment: SignedPayment = {
      nonce: payment.nonce,
      payerId: payment.payerId,
      payerPublicKey: payment.payerPublicKey,
      payTo: payment.payTo,
      asset: payment.asset as PaymentAsset,
      amount: payment.amount.toString(),
      validUntil: payment.validUntil.toISOString(),
      maxBlockHeight: Number(payment.maxBlockHeight),
      signedDelegate: payment.signedPayload.toString("base64"),
    };
    const quote: X402Accept = {
      scheme: "exact",
      network: "near:testnet",
      asset: signedPayment.asset,
      maxAmountRequired: signedPayment.amount,
      payTo: signedPayment.payTo,
      resource: `/v1/listings/${run.listingId}/evaluate`,
      validUntil: signedPayment.validUntil,
      nonce: signedPayment.nonce,
    };

    // "Re-verify payment still valid" (docs/03 B5): idempotent against an
    // already-consumed identical nonce, so this never double-spends.
    const reverify = await this.deps.facilitator.verify(signedPayment, quote);
    const settleResult = reverify.ok ? await this.deps.facilitator.settle(signedPayment) : { ok: false as const, reason: reverify.reason };

    if (settleResult.ok) {
      await this.deps.prisma.$transaction([
        this.deps.prisma.run.update({ where: { id: run.id }, data: { state: "SETTLED" } }),
        this.deps.prisma.payment.update({
          where: { runId: run.id },
          data: { status: "settled", settleTxHash: settleResult.settleTxHash },
        }),
      ]);
      await this.logEvent(run.id, "RESULT_READY", "SETTLED", {});
      return;
    }

    // PY-15/PY-18/PY-19: settlement failed — retried with backoff, alerted, never silently dropped.
    await this.deps.prisma.run.update({ where: { id: run.id }, data: { state: "SETTLE_PENDING" } });
    await this.logEvent(run.id, "RESULT_READY", "SETTLE_PENDING", { reason: settleResult.reason });

    const failureCount = await this.deps.prisma.runEvent.count({
      where: { runId: run.id, toState: "SETTLE_PENDING" },
    });
    if (failureCount >= 3) {
      // eslint-disable-next-line no-console
      console.error(`ALERT: run ${run.id} has failed to settle ${failureCount} times (docs/03 B11 alert threshold)`);
    }
  }

  private async buildInput(run: NonNullable<Awaited<ReturnType<RunProcessor["loadRun"]>>>): Promise<EvaluatorInput> {
    const listing = run.listing;
    if (!listing.datasetAssetId || !listing.datasetWrappedKey) {
      throw new Error(`listing ${listing.id} has no dataset asset — should never reach the worker in this state`);
    }
    const datasetAsset = await this.deps.prisma.asset.findUnique({ where: { id: listing.datasetAssetId } });
    if (!datasetAsset) throw new Error(`dataset asset ${listing.datasetAssetId} not found`);

    const [datasetCt, modelCt] = await Promise.all([
      this.deps.storage.getCiphertext(datasetAsset.storageKey),
      this.deps.storage.getCiphertext(run.model.asset.storageKey),
    ]);

    const rules = listing.rulesJson as { min_rows: number; min_class_count: number; round: number; metrics: string[] };

    return {
      v: 1,
      run_id: run.id,
      listing_id: listing.id,
      evaluator_version: listing.evaluatorVersion,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schema: listing.schemaJson as any,
      rules: {
        min_rows: rules.min_rows,
        min_class_count: rules.min_class_count,
        round: rules.round,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metrics: rules.metrics as any,
      },
      dataset: {
        ct_b64: datasetCt.toString("base64"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wrapped_key: listing.datasetWrappedKey as any,
      },
      model: {
        ct_b64: modelCt.toString("base64"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wrapped_key: run.model.wrappedKey as any,
      },
    };
  }

  private async logEvent(runId: string, fromState: string, toState: string, detail: Record<string, unknown>): Promise<void> {
    await this.deps.prisma.runEvent.create({
      data: { runId, fromState, toState, detail: detail as Prisma.InputJsonValue },
    });
  }
}
