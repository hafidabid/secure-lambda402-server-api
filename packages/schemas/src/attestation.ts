import { z } from "zod";

/** Parsed `execution_completed`-style event (docs/03 B4, U7 in docs/02). */
export const AttestationSchema = z.object({
  run_id: z.string(),
  wasm_hash: z.string().regex(/^[a-f0-9]{64}$/),
  quote_raw: z.string().optional(), // base64 TDX quote, opaque for Tier 1
  verified: z.boolean(),
  notes: z.string().optional(),
});
export type Attestation = z.infer<typeof AttestationSchema>;

export const ReceiptSchema = z.object({
  exec_tx: z.string(),
  settle_tx: z.string().nullable(),
  wasm_hash: z.string(),
  // Optional so a dashboard deployed ahead of the API still parses older receipts.
  pinned_wasm_hash: z.string().optional(),
  attested: z.boolean(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/**
 * Compares the attested wasm hash against the listing's pinned hash. A
 * mismatch must block settlement (docs/03 B10, RN-08, SC-07) regardless of
 * whether the attestation quote itself parses as "verified".
 */
export function attestationMatchesListing(attestation: Attestation, listingWasmHash: string): boolean {
  return attestation.wasm_hash === listingWasmHash;
}
