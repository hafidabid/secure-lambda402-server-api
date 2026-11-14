import { randomUUID } from "node:crypto";
import type { EvaluatorInput, EvaluatorSuccessOutput } from "@securelambda/schemas";
import type { OutLayerClient, TxStatus } from "./outlayer-client";

/**
 * Fault scripts named in docs/05 section 7.2 ("Mock OutLayer... can be
 * told to delay, time out, fail transiently, hang, report the wrong wasm
 * hash or return a bad attestation").
 */
export type FaultScript =
  | "ok"
  | "slow"
  | "timeout_then_success"
  | "transient_then_success"
  | "transient_always"
  | "hang"
  | "wrong_wasm_hash"
  | "bad_attestation"
  | "deterministic_failure";

export interface ScriptConfig {
  script: FaultScript;
  /** Returned on the attempt that succeeds. */
  successOutput?: EvaluatorSuccessOutput;
  /** wasmHash reported in the attestation on a successful completion. */
  wasmHash?: string;
  /** For 'slow'/'timeout_then_success': how many pending polls before completing. */
  pendingPollsBeforeDone?: number;
  /** For 'deterministic_failure': the evaluator error code to report. */
  errorCode?: string;
}

interface TxState {
  runId: string;
  attempt: number;
  pollCount: number;
}

const DEFAULT_SUCCESS_OUTPUT: EvaluatorSuccessOutput = {
  v: 1,
  ok: true,
  metrics: { accuracy: 0.83, auc: 0.9, f1: 0.8 },
  n_bucket: "100-199",
  evaluator_version: "1.0.0",
};
const DEFAULT_WASM_HASH = "d".repeat(64);

export class MockOutLayerClient implements OutLayerClient {
  private readonly scripts = new Map<string, ScriptConfig>();
  private readonly attemptsByRunId = new Map<string, number>();
  private readonly txState = new Map<string, TxState>();

  setScript(runId: string, config: ScriptConfig): void {
    this.scripts.set(runId, config);
  }

  async requestExecution(_projectId: string, input: EvaluatorInput): Promise<{ txHash: string }> {
    const attempt = this.attemptsByRunId.get(input.run_id) ?? 0;
    this.attemptsByRunId.set(input.run_id, attempt + 1);
    const txHash = `tx_${randomUUID()}`;
    this.txState.set(txHash, { runId: input.run_id, attempt, pollCount: 0 });
    return { txHash };
  }

  async txStatus(txHash: string): Promise<TxStatus> {
    const state = this.txState.get(txHash);
    if (!state) throw new Error(`unknown txHash in mock: ${txHash}`);
    const config = this.scripts.get(state.runId) ?? { script: "ok" };
    state.pollCount += 1;

    const succeed = (): TxStatus => ({
      kind: "completed",
      success: true,
      output: config.successOutput ?? DEFAULT_SUCCESS_OUTPUT,
      wasmHash: config.wasmHash ?? DEFAULT_WASM_HASH,
    });

    switch (config.script) {
      case "ok":
        return succeed();

      case "slow": {
        const threshold = config.pendingPollsBeforeDone ?? 2;
        return state.pollCount <= threshold ? { kind: "pending" } : succeed();
      }

      case "timeout_then_success": {
        const threshold = config.pendingPollsBeforeDone ?? 2;
        return state.pollCount <= threshold ? { kind: "pending" } : succeed();
      }

      case "transient_then_success":
        return state.attempt === 0
          ? { kind: "completed", success: false, transient: true, code: "RUN_TIMEOUT_UNKNOWN", message: "Execution promise failed: Failed." }
          : succeed();

      case "transient_always":
        return { kind: "completed", success: false, transient: true, code: "RUN_TIMEOUT_UNKNOWN", message: "Execution promise failed: Failed." };

      case "hang":
        return { kind: "pending" };

      case "wrong_wasm_hash":
        return { kind: "completed", success: true, output: config.successOutput ?? DEFAULT_SUCCESS_OUTPUT, wasmHash: "f".repeat(64) };

      case "bad_attestation":
        return { kind: "completed", success: true, output: config.successOutput ?? DEFAULT_SUCCESS_OUTPUT, wasmHash: "" };

      case "deterministic_failure":
        return {
          kind: "completed",
          success: false,
          transient: false,
          code: config.errorCode ?? "DATA_UNUSABLE",
          message: "evaluator rejected the input",
        };

      default:
        return succeed();
    }
  }
}
