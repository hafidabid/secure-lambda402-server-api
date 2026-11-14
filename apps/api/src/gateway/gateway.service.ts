import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import {
  ApiError,
  SignedPaymentSchema,
  X402AcceptSchema,
  type EvaluatePendingResponse,
  type EvaluateSuccessResponse,
  type SignedPayment,
  type X402Accept,
  type X402Quote,
} from "@securelambda/schemas";
import { PrismaService } from "../common/prisma.service";
import { loadReceipt } from "../common/receipt";
import { RedisService } from "../common/redis.service";
import type { AppConfig } from "../config";
import type { FacilitatorPort } from "@securelambda/facilitator";
import { FACILITATOR_PORT } from "../facilitator/facilitator.module";
import { RUN_QUEUE, type RunJobData } from "./run-queue";

const QUOTE_TTL_SECONDS = 15 * 60;
const INLINE_WAIT_BUDGET_MS = 1500;
const INLINE_WAIT_STEP_MS = 100;

export type EvaluateResult =
  | { kind: "quote"; quote: X402Quote }
  | { kind: "success"; body: EvaluateSuccessResponse }
  | { kind: "pending"; body: EvaluatePendingResponse };

@Injectable()
export class GatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Inject(FACILITATOR_PORT) private readonly facilitator: FacilitatorPort,
    @Inject(RUN_QUEUE) private readonly runQueue: Queue<RunJobData>,
  ) {}

  async evaluate(
    listingId: string,
    buyerId: string,
    modelId: string,
    clientIp: string,
    paymentHeader: string | undefined,
  ): Promise<EvaluateResult> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new ApiError("LISTING_NOT_FOUND", `listing ${listingId} not found`);
    if (listing.status !== "published") {
      throw new ApiError("LISTING_NOT_PUBLISHED", `listing ${listingId} is not published`);
    }

    const model = await this.prisma.model.findUnique({ where: { id: modelId } });
    if (!model) throw new ApiError("MODEL_NOT_FOUND", `model ${modelId} not found`);
    if (model.listingId !== listingId) {
      throw new ApiError("MODEL_BOUND_TO_OTHER_LISTING", `model ${modelId} was uploaded for a different listing`);
    }

    // AP-14 / AP-15: rate limit and budget are checked before any 402 is issued.
    await this.checkPerIpRateLimit(clientIp);
    await this.checkRunsPerDayAndBudget(listing, buyerId);

    const resource = `/v1/listings/${listingId}/evaluate`;

    if (!paymentHeader) {
      const quote = await this.issueQuote(listing, resource);
      return { kind: "quote", quote };
    }

    const payment = this.decodePayment(paymentHeader);
    const existingRun = await this.prisma.run.findUnique({ where: { paymentNonce: payment.nonce } });
    if (existingRun) {
      return this.respondForRun(existingRun.id);
    }

    const cachedQuote = await this.loadCachedQuote(payment.nonce);
    if (!cachedQuote) {
      throw new ApiError("PAYMENT_INVALID", "payment nonce does not match any quote we issued (expired or unknown)");
    }
    // PY-12: a payment quoted for a different resource (e.g. another listing) must not be honoured here.
    if (cachedQuote.resource !== resource) {
      throw new ApiError("PAYMENT_INVALID", "payment was signed for a different resource");
    }

    const verifyResult = await this.facilitator.verify(payment, cachedQuote);
    if (!verifyResult.ok) {
      throw new ApiError(verifyResult.code, verifyResult.reason);
    }

    const runId = await this.createRunAndEnqueue(listing.id, buyerId, modelId, payment, cachedQuote);
    return this.respondForRun(runId);
  }

  private async checkPerIpRateLimit(clientIp: string): Promise<void> {
    const limit = this.configService.get("RATE_LIMIT_PER_IP_PER_MINUTE", { infer: true });
    const key = `rl:ip:${clientIp}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, 60);
    }
    if (count > limit) {
      throw new ApiError("RATE_LIMITED", `more than ${limit} requests per minute from this IP`);
    }
  }

  private async checkRunsPerDayAndBudget(
    listing: { id: string; rulesJson: unknown },
    buyerId: string,
  ): Promise<void> {
    const rules = listing.rulesJson as { runs_per_day: number; lifetime_budget: number };
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);

    const countToday = await this.prisma.run.count({
      where: { buyerId, listingId: listing.id, createdAt: { gte: startOfUtcDay } },
    });
    if (countToday >= rules.runs_per_day) {
      throw new ApiError("RATE_LIMITED", `buyer exceeded ${rules.runs_per_day} runs per day for this listing`);
    }

    const countLifetime = await this.prisma.run.count({ where: { buyerId, listingId: listing.id } });
    if (countLifetime >= rules.lifetime_budget) {
      throw new ApiError("BUDGET_EXHAUSTED", `buyer exceeded the lifetime budget of ${rules.lifetime_budget} runs`);
    }
  }

  private async issueQuote(
    listing: { id: string; sellerId: string; priceAmount: { toFixed(decimalPlaces?: number): string }; priceAsset: string },
    resource: string,
  ): Promise<X402Quote> {
    const validMinutes = this.configService.get("PAYMENT_VALID_MINUTES", { infer: true });
    const validUntil = new Date(Date.now() + validMinutes * 60 * 1000).toISOString();
    const nonce = `n_${randomUUID()}`;

    const accept: X402Accept = {
      scheme: "exact",
      network: `near:${this.configService.get("NEAR_NETWORK", { infer: true })}`,
      asset: listing.priceAsset === "usdc" ? "usdc" : "near",
      // toFixed, not toString: Decimal prints 10^22 as "1e+22", which is not a valid integer string.
      maxAmountRequired: listing.priceAmount.toFixed(0),
      payTo: listing.sellerId,
      assetContract: this.configService.get("PAYMENT_TOKEN_CONTRACT", { infer: true }) || undefined,
      resource,
      validUntil,
      nonce,
    };

    await this.redis.client.set(`quote:${nonce}`, JSON.stringify(accept), "EX", QUOTE_TTL_SECONDS);
    return { x402Version: 1, accepts: [accept] };
  }

  private async loadCachedQuote(nonce: string): Promise<X402Accept | null> {
    const raw = await this.redis.client.get(`quote:${nonce}`);
    if (!raw) return null;
    const parsed = X402AcceptSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  private decodePayment(header: string): SignedPayment {
    try {
      const json = Buffer.from(header, "base64").toString("utf8");
      const parsed = SignedPaymentSchema.safeParse(JSON.parse(json));
      if (!parsed.success) throw new Error(parsed.error.message);
      return parsed.data;
    } catch (err) {
      throw new ApiError("PAYMENT_INVALID", `malformed X-Payment header: ${(err as Error).message}`);
    }
  }

  private async createRunAndEnqueue(
    listingId: string,
    buyerId: string,
    modelId: string,
    payment: SignedPayment,
    quote: X402Accept,
  ): Promise<string> {
    const runId = `run_${randomUUID()}`;
    await this.prisma.$transaction([
      this.prisma.run.create({
        data: {
          id: runId,
          listingId,
          buyerId,
          modelId,
          state: "QUEUED",
          paymentNonce: payment.nonce,
          mode: "enclave",
        },
      }),
      this.prisma.payment.create({
        data: {
          runId,
          nonce: payment.nonce,
          payerId: payment.payerId,
          payerPublicKey: payment.payerPublicKey,
          payTo: payment.payTo,
          asset: payment.asset,
          assetContract: quote.assetContract ?? null,
          amount: payment.amount,
          validUntil: new Date(payment.validUntil),
          maxBlockHeight: payment.maxBlockHeight,
          status: "verified",
          signedPayload: Buffer.from(payment.signedDelegate, "base64"),
        },
      }),
    ]);
    await this.runQueue.add("run", { runId }, { jobId: runId });
    return runId;
  }

  /** Waits briefly for a result inline, then falls back to 202 (docs/03 B4 "If the run does not finish inside the HTTP timeout"). */
  private async respondForRun(runId: string): Promise<EvaluateResult> {
    const deadline = Date.now() + INLINE_WAIT_BUDGET_MS;
    while (Date.now() < deadline) {
      const run = await this.prisma.run.findUnique({ where: { id: runId } });
      if (run && (run.state === "SETTLED" || run.state === "FAILED_NOT_CHARGED")) {
        return await this.buildResponseForRun(run);
      }
      await new Promise((resolve) => setTimeout(resolve, INLINE_WAIT_STEP_MS));
    }
    return { kind: "pending", body: { run_id: runId, location: `/v1/runs/${runId}` } };
  }

  private async buildResponseForRun(run: {
    id: string;
    listingId: string;
    state: string;
    mode: string;
    resultJson: unknown;
    execTxHash: string | null;
    errorCode: string | null;
  }): Promise<EvaluateResult> {
    if (run.state === "SETTLED" && run.resultJson) {
      return {
        kind: "success",
        body: {
          run_id: run.id,
          mode: run.mode as "enclave" | "local",
          result: run.resultJson as EvaluateSuccessResponse["result"],
          receipt: await loadReceipt(this.prisma, run),
        },
      };
    }
    throw new ApiError(
      "RUN_FAILED_NOT_CHARGED",
      `run ${run.id} failed: ${run.errorCode ?? "unknown error"} (not charged)`,
    );
  }
}
