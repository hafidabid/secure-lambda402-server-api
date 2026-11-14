import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EvaluatorOutputSchema, type EvaluatorInput } from "@securelambda/schemas";
import type { OutLayerClient, TxStatus } from "./outlayer-client";

export interface LocalEvaluatorOptions {
  /** Path to the compiled crates/evaluator binary (the same Rust code that runs in the TEE, built natively). */
  binaryPath: string;
  /** Base64 X25519 private key matching the public key in EvaluatorVersion. */
  privateKeyBase64: string;
  /** Reported back as the "attested" wasm hash. The listing's EvaluatorVersion.wasmHash must equal this. */
  wasmHash: string;
  timeoutMs?: number;
}

/**
 * Runs the real Rust evaluator as a child process on the worker's own machine.
 * The decryption, scoring and rounding are the real thing; what is missing is
 * the hardware enclave, so runs are marked mode="local" and never "attested".
 *
 * Results live in memory only: if the worker restarts mid-run, that run is
 * reported as a transient failure and re-submitted, which is safe because
 * nothing is charged until a verified result exists.
 */
export class LocalEvaluatorClient implements OutLayerClient {
  readonly mode = "local" as const;
  private readonly results = new Map<string, Promise<TxStatus>>();

  constructor(private readonly opts: LocalEvaluatorOptions) {}

  async requestExecution(_projectId: string, input: EvaluatorInput): Promise<{ txHash: string }> {
    const txHash = `local_${randomUUID()}`;
    this.results.set(txHash, this.execute(input));
    return { txHash };
  }

  async txStatus(txHash: string): Promise<TxStatus> {
    const result = this.results.get(txHash);
    if (!result) {
      return { kind: "completed", success: false, transient: true, code: "RUN_TIMEOUT_UNKNOWN", message: "local result lost (worker restarted)" };
    }
    return result;
  }

  private execute(input: EvaluatorInput): Promise<TxStatus> {
    return new Promise((resolve) => {
      const child = spawn(this.opts.binaryPath, [], {
        env: { EVALUATOR_PRIVATE_KEY: this.opts.privateKeyBase64 },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), this.opts.timeoutMs ?? 60_000);
      const fail = (message: string): TxStatus => ({ kind: "completed", success: false, transient: true, code: "INTERNAL", message });

      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(fail(`could not start evaluator: ${err.message}`));
      });
      child.on("close", () => {
        clearTimeout(timer);
        // The evaluator reports its own failures as JSON on stdout (it never prints inputs or keys).
        try {
          const parsed = EvaluatorOutputSchema.parse(JSON.parse(stdout.trim()));
          if (parsed.ok) {
            resolve({ kind: "completed", success: true, output: parsed, wasmHash: this.opts.wasmHash });
          } else {
            resolve({ kind: "completed", success: false, transient: parsed.error === "INTERNAL", code: parsed.error, message: "evaluator rejected the input" });
          }
        } catch {
          resolve(fail("evaluator produced no valid output"));
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
  }
}
