import { KeyPair } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import { baseEncode } from "@near-js/utils";
import { Account, connect, keyStores } from "near-api-js";
import { EvaluatorOutputSchema, type EvaluatorInput } from "@securelambda/schemas";
import type { OutLayerClient, TxStatus } from "./outlayer-client";

export interface NearOutLayerOptions {
  rpcUrl: string;
  networkId: string;
  /** The OutLayer contract that takes `request_execution` (`outlayer.testnet`). */
  contractId: string;
  /** Account that signs and pays for executions. The unused part of each deposit is refunded to it. */
  signerAccountId: string;
  /** `ed25519:<base58>` secret key of the signer. */
  signerPrivateKey: string;
  /** `owner/name` of the deployed evaluator project. */
  project: string;
  /** Account that stored the project's EVALUATOR_PRIVATE_KEY secret (usually the project owner). */
  secretsAccountId: string;
  secretsProfile?: string;
  /** Attached to each request; OutLayer charges for the run and refunds the rest. 0.0021 NEAR covers a typical run. */
  depositYocto?: bigint;
  maxExecutionSeconds?: number;
  maxInstructions?: number;
  maxMemoryMb?: number;
  /** How long a transaction may stay unknown to the network before it is treated as dropped (default 2 minutes). */
  notObservedGraceMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/** JSON-RPC call; injectable so tests need no network. Resolves to the RPC `result`, rejects with `{ rpcError }` on an RPC error. */
export type RpcCall = (method: string, params: unknown) => Promise<unknown>;

const DEFAULT_DEPOSIT_YOCTO = 2_100_000_000_000_000_000_000n; // 0.0021 NEAR
const GAS = 300_000_000_000_000n; // 300 TGas, the maximum; unused gas is refunded
const DEFAULT_NOT_OBSERVED_GRACE_MS = 120_000;

interface RpcFailure {
  rpcError: { name?: string; cause?: { name?: string; info?: { cause?: string } }; message?: string };
}

const isRpcFailure = (e: unknown): e is RpcFailure => typeof e === "object" && e !== null && "rpcError" in e;

/** The network has no record of this transaction (never included, or dropped), as opposed to "still executing". */
function isNotObserved(err: unknown): boolean {
  if (!isRpcFailure(err)) return false;
  const { cause } = err.rpcError;
  return cause?.name === "UNKNOWN_TRANSACTION" || cause?.info?.cause === "NOT_OBSERVED" || cause?.info?.cause === "UNKNOWN_TRANSACTION";
}

function fetchRpc(rpcUrl: string): RpcCall {
  return async (method, params) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "securelambda", method, params }),
    });
    if (response.status === 429 || response.status >= 500) throw new Error(`NEAR RPC ${method}: HTTP ${response.status}`);
    const body = (await response.json()) as { result?: unknown; error?: RpcFailure["rpcError"] };
    if (body.error) throw { rpcError: body.error } satisfies RpcFailure;
    return body.result;
  };
}

/** Lets the subclass reach near-api-js's protected signer so we can broadcast asynchronously ourselves. */
class SigningAccount extends Account {
  sign(receiverId: string, actions: Parameters<Account["signAndSendTransaction"]>[0]["actions"]) {
    return this.signTransaction(receiverId, actions);
  }
}

/**
 * Runs the evaluator in OutLayer's TEE by calling `request_execution` on the OutLayer contract on NEAR.
 *
 * - The transaction is broadcast with `broadcast_tx_async`, so a slow TEE never surfaces as a client timeout
 *   (the OutLayer CLI's "request failed with timeout" can still mean the run succeeded). We keep the tx hash
 *   and poll it; `pending` is never a failure.
 * - The result and the wasm hash that actually ran are read from the chain: the transaction's return value
 *   and the contract's own `execution_completed` event. The worker compares that hash with the listing's
 *   pinned `EvaluatorVersion.wasmHash` before settling.
 */
export class NearOutLayerClient implements OutLayerClient {
  readonly mode = "enclave" as const;
  private signer?: Promise<SigningAccount>;
  /** When each transaction was first looked for, so a transaction nobody has ever seen is not waited on forever. */
  private readonly firstSeen = new Map<string, number>();

  constructor(
    private readonly opts: NearOutLayerOptions,
    private readonly rpc: RpcCall = fetchRpc(opts.rpcUrl),
  ) {}

  private getSigner(): Promise<SigningAccount> {
    this.signer ??= (async () => {
      const keyStore = new keyStores.InMemoryKeyStore();
      await keyStore.setKey(this.opts.networkId, this.opts.signerAccountId, KeyPair.fromString(this.opts.signerPrivateKey as `ed25519:${string}`) as never);
      const near = await connect({ networkId: this.opts.networkId, nodeUrl: this.opts.rpcUrl, keyStore });
      const base = await near.account(this.opts.signerAccountId);
      return new SigningAccount((base as unknown as { connection: ConstructorParameters<typeof Account>[0] }).connection, this.opts.signerAccountId);
    })();
    return this.signer;
  }

  async requestExecution(projectId: string, input: EvaluatorInput): Promise<{ txHash: string }> {
    // projectId comes from the listing's EvaluatorVersion; it must match the project this client was configured for.
    if (projectId !== this.opts.project) {
      throw new Error(`listing evaluator project "${projectId}" does not match OUTLAYER_PROJECT "${this.opts.project}"`);
    }
    const args = {
      source: { Project: { project_id: projectId, version_key: null } },
      input_data: JSON.stringify(input),
      resource_limits: {
        max_instructions: this.opts.maxInstructions ?? 1_000_000_000,
        max_memory_mb: this.opts.maxMemoryMb ?? 128,
        max_execution_seconds: this.opts.maxExecutionSeconds ?? 10,
      },
      response_format: "Json",
      secrets_ref: { profile: this.opts.secretsProfile ?? "default", account_id: this.opts.secretsAccountId },
      params: null,
      payer_account_id: null,
    };
    const account = await this.getSigner();
    const [hashBytes, signedTx] = await account.sign(this.opts.contractId, [
      actionCreators.functionCall("request_execution", args, GAS, this.opts.depositYocto ?? DEFAULT_DEPOSIT_YOCTO),
    ]);
    await this.rpc("broadcast_tx_async", [Buffer.from(signedTx.encode()).toString("base64")]);
    const txHash = baseEncode(hashBytes);
    this.firstSeen.set(txHash, this.now());
    return { txHash };
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  async txStatus(txHash: string): Promise<TxStatus> {
    let result: TxStatusResult;
    try {
      result = (await this.rpc("EXPERIMENTAL_tx_status", {
        tx_hash: txHash,
        sender_account_id: this.opts.signerAccountId,
        wait_until: "FINAL",
      })) as TxStatusResult;
    } catch (err) {
      // Still executing, RPC timeout, network blip: all mean "unknown", never a failure.
      if (isNotObserved(err)) {
        // A broadcast can be accepted and then dropped, and the network will never learn of it. After a grace period
        // that is a transient failure, so the worker resubmits instead of blocking on a transaction that does not exist.
        const first = this.firstSeen.get(txHash) ?? this.now();
        this.firstSeen.set(txHash, first);
        if (this.now() - first >= (this.opts.notObservedGraceMs ?? DEFAULT_NOT_OBSERVED_GRACE_MS)) {
          this.firstSeen.delete(txHash);
          return { kind: "completed", success: false, transient: true, code: "RUN_TIMEOUT_UNKNOWN", message: "transaction was never observed on chain (dropped)" };
        }
        return { kind: "pending" };
      }
      if (isRpcFailure(err) || err instanceof Error) return { kind: "pending" };
      throw err;
    }
    this.firstSeen.delete(txHash);
    return parseTxResult(result);
  }
}

interface TxStatusResult {
  status?: { SuccessValue?: string | null; Failure?: unknown };
  receipts_outcome?: { outcome: { logs: string[]; executor_id: string } }[];
}

const OUTLAYER_EVENT_PREFIX = "EVENT_JSON:";

/** Pure: turns a finished `request_execution` transaction into a TxStatus. Exported for tests. */
export function parseTxResult(result: TxStatusResult): TxStatus {
  const logs = (result.receipts_outcome ?? []).flatMap((r) => r.outcome.logs);

  if (result.status?.Failure !== undefined) {
    return { kind: "completed", success: false, transient: true, code: "RUN_TIMEOUT_UNKNOWN", message: "request_execution transaction failed" };
  }

  const encoded = result.status?.SuccessValue;
  const text = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
  if (text === "" || text === "null") {
    // OutLayer refunds and returns null when the execution itself failed (trap, limit, worker error). Retrying is safe.
    const reason = logs.find((l) => l.includes("Execution promise failed")) ?? "OutLayer execution failed";
    return { kind: "completed", success: false, transient: true, code: "RUN_TIMEOUT_UNKNOWN", message: reason.slice(0, 200) };
  }

  let output;
  try {
    output = EvaluatorOutputSchema.parse(JSON.parse(text));
  } catch {
    return { kind: "completed", success: false, transient: true, code: "INTERNAL", message: "OutLayer returned output that is not a valid evaluator result" };
  }
  if (!output.ok) {
    return { kind: "completed", success: false, transient: output.error === "INTERNAL", code: output.error, message: "evaluator rejected the input" };
  }

  const wasmHash = executedWasmHash(logs);
  if (!wasmHash) {
    return { kind: "completed", success: false, transient: true, code: "INTERNAL", message: "no execution_completed event found for the run" };
  }
  return { kind: "completed", success: true, output, wasmHash };
}

/** The hash of the wasm OutLayer says it executed, from the contract's own `execution_completed` event. */
function executedWasmHash(logs: string[]): string | null {
  for (const line of logs) {
    if (!line.startsWith(OUTLAYER_EVENT_PREFIX)) continue;
    try {
      const event = JSON.parse(line.slice(OUTLAYER_EVENT_PREFIX.length)) as {
        event?: string;
        data?: { success?: boolean; code_source?: { WasmUrl?: { hash?: string } } }[];
      };
      if (event.event !== "execution_completed") continue;
      const hash = event.data?.[0]?.code_source?.WasmUrl?.hash;
      if (event.data?.[0]?.success && hash) return hash;
    } catch {
      /* not our event */
    }
  }
  return null;
}
