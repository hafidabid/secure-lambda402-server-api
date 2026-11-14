import { test } from "node:test";
import assert from "node:assert/strict";
import type { Receipt } from "@securelambda/schemas";
import { checkEvaluatorHash } from "./evaluator-check.ts";

const receipt = (wasm_hash: string, pinned_wasm_hash?: string): Receipt => ({ exec_tx: "e", settle_tx: null, wasm_hash, pinned_wasm_hash, attested: false });

test("the executed build matches the listing's pinned build", () => {
  assert.equal(checkEvaluatorHash(receipt("a".repeat(64), "a".repeat(64))), "match");
});

test("a different executed build is a mismatch", () => {
  assert.equal(checkEvaluatorHash(receipt("b".repeat(64), "a".repeat(64))), "mismatch");
});

test("nothing to compare before the run executes or when the API predates the pin", () => {
  assert.equal(checkEvaluatorHash(receipt("", "a".repeat(64))), "unknown");
  assert.equal(checkEvaluatorHash(receipt("a".repeat(64))), "unknown");
  assert.equal(checkEvaluatorHash(undefined), "unknown");
});
