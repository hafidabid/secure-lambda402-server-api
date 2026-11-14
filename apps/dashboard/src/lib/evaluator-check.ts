import type { Receipt } from "@securelambda/schemas";

export type EvaluatorHashCheck = "match" | "mismatch" | "unknown";

export function checkEvaluatorHash(receipt: Receipt | undefined): EvaluatorHashCheck {
  if (!receipt?.wasm_hash || !receipt.pinned_wasm_hash) return "unknown";
  return receipt.wasm_hash === receipt.pinned_wasm_hash ? "match" : "mismatch";
}
