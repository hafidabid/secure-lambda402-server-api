import { test } from "node:test";
import assert from "node:assert/strict";
import type { Receipt, Run } from "@securelambda/schemas";
import { deriveStages } from "./run-stages.ts";

const T0 = Date.parse("2026-11-14T09:00:00Z");

function run(over: Partial<Run>): Run {
  return {
    id: "run_1",
    listing_id: "lst",
    buyer_id: "b",
    model_id: "m",
    state: "PAYMENT_VERIFIED",
    payment_nonce: "n",
    attempt: 0,
    exec_tx_hash: null,
    result: null,
    error_code: null,
    mode: "enclave",
    created_at: new Date(T0).toISOString(),
    updated_at: new Date(T0).toISOString(),
    ...over,
  };
}

const RESULT = { metrics: { accuracy: 0.8, auc: 0.9, f1: 0.7 }, n_bucket: "500-999" as const };
const statuses = (r: Run, receipt?: Receipt, now = T0 + 1000) => deriveStages(r, receipt, now).map((s) => s.status);

test("executing past 30 s is slow, not failed", () => {
  assert.deepEqual(statuses(run({ state: "EXECUTING" }), undefined, T0 + 31_000), ["done", "pending", "slow", "slow"]);
});

test("result can land before payment settles", () => {
  const receipt: Receipt = { exec_tx: "e", settle_tx: null, wasm_hash: "h", attested: true };
  assert.deepEqual(statuses(run({ state: "RESULT_READY", result: RESULT }), receipt), ["done", "active", "done", "done"]);
});

test("local mode never shows attested", () => {
  const receipt: Receipt = { exec_tx: "e", settle_tx: "s", wasm_hash: "h", attested: true };
  assert.equal(statuses(run({ state: "SETTLED", result: RESULT, mode: "local" }), receipt)[2], "skipped");
});

test("a failed run is not charged", () => {
  assert.deepEqual(statuses(run({ state: "FAILED_NOT_CHARGED" })), ["done", "skipped", "failed", "failed"]);
});
