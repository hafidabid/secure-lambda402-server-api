import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvaluatorInput } from "@securelambda/schemas";
import { LocalEvaluatorClient } from "./local-evaluator-client";

const INPUT = { v: 1, run_id: "run_1" } as unknown as EvaluatorInput;
const WASM_HASH = "c".repeat(64);
const OK_OUTPUT = { v: 1, ok: true, metrics: { accuracy: 0.9, auc: 0.9, f1: 0.9 }, n_bucket: "100-199", evaluator_version: "1.0.0" };

/** A stand-in for the Rust binary: reads the job from stdin, prints `stdout` (and checks it got the key). */
function fakeEvaluator(stdout: string, exitCode = 0): string {
  const path = join(mkdtempSync(join(tmpdir(), "fake-eval-")), "evaluator.sh");
  writeFileSync(path, `#!/bin/sh\ncat > /dev/null\n[ -n "$EVALUATOR_PRIVATE_KEY" ] || exit 9\nprintf '%s' '${stdout}'\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
}

function client(binaryPath: string) {
  return new LocalEvaluatorClient({ binaryPath, privateKeyBase64: "a2V5", wasmHash: WASM_HASH });
}

async function run(c: LocalEvaluatorClient) {
  const { txHash } = await c.requestExecution("project", INPUT);
  return c.txStatus(txHash);
}

describe("LocalEvaluatorClient", () => {
  it("declares itself local so runs are never reported as attested", () => {
    expect(client(fakeEvaluator("{}")).mode).toBe("local");
  });

  it("returns the evaluator's metrics along with the configured wasm hash", async () => {
    expect(await run(client(fakeEvaluator(JSON.stringify(OK_OUTPUT))))).toEqual({
      kind: "completed",
      success: true,
      output: OK_OUTPUT,
      wasmHash: WASM_HASH,
    });
  });

  it("maps a deterministic evaluator failure to a non-transient failure with the evaluator's code", async () => {
    expect(await run(client(fakeEvaluator(JSON.stringify({ v: 1, ok: false, error: "DATA_UNUSABLE" }))))).toMatchObject({
      kind: "completed",
      success: false,
      transient: false,
      code: "DATA_UNUSABLE",
    });
  });

  it("treats an INTERNAL evaluator error as transient, so the run is retried", async () => {
    expect(await run(client(fakeEvaluator(JSON.stringify({ v: 1, ok: false, error: "INTERNAL" }))))).toMatchObject({
      success: false,
      transient: true,
    });
  });

  it("treats garbage output as a transient failure rather than a result", async () => {
    expect(await run(client(fakeEvaluator("not json", 1)))).toMatchObject({ success: false, transient: true, code: "INTERNAL" });
  });

  it("treats a missing binary as a transient failure", async () => {
    expect(await run(client("/nonexistent/evaluator"))).toMatchObject({ success: false, transient: true, code: "INTERNAL" });
  });

  it("reports a result it no longer has (worker restarted) as transient so the run is re-submitted", async () => {
    expect(await client(fakeEvaluator("{}")).txStatus("local_unknown")).toMatchObject({ success: false, transient: true });
  });
});
