import type { EvaluatorInput, EvaluatorSuccessOutput } from "@securelambda/schemas";

export type TxStatus =
  | { kind: "pending" } // RPC/CLI timeout or still running — never a failure by itself (docs/03 B5)
  | { kind: "completed"; success: true; output: EvaluatorSuccessOutput; wasmHash: string }
  | { kind: "completed"; success: false; transient: boolean; code: string; message: string };

/**
 * Port onto the OutLayer TEE (docs/03 B2 "jobs (worker)": calls
 * `request_execution`, polls status). A real implementation submits a NEAR
 * transaction and polls `near.tx_status`; this build ships only the mock
 * used for the state-machine tests, per docs/05 section 7.1 seam I5 ("Mock
 * OutLayer with faults, then testnet" — testnet access isn't available
 * here).
 */
export interface OutLayerClient {
  requestExecution(projectId: string, input: EvaluatorInput): Promise<{ txHash: string }>;
  txStatus(txHash: string): Promise<TxStatus>;
}
