import { z } from "zod";

export const ASSET_ROLES = ["dataset", "model"] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

/** Base64 (standard alphabet, with padding) — rejects URL-safe/unpadded input. Canonical per CR-17. */
export const Base64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be standard base64 (padded, no URL-safe chars)")
  .refine((s) => s.length % 4 === 0, "base64 length must be a multiple of 4");

export const EnvelopeAadContextSchema = z.object({
  listing: z.string().min(1),
  role: z.enum(ASSET_ROLES),
  ev: z.string().min(1),
  ct_sha256: z.string().regex(/^[a-f0-9]{64}$/, "ct_sha256 must be a lowercase hex sha256"),
});
export type EnvelopeAadContext = z.infer<typeof EnvelopeAadContextSchema>;

/**
 * Wrapped-key envelope per docs/03 B7. `ct` is AES-256-GCM(K_file) under the
 * X25519+HKDF wrapping key: 32-byte key + 16-byte GCM tag, base64-encoded.
 */
export const EnvelopeSchema = z.object({
  v: z.literal(1),
  epk: Base64Schema,
  nonce: Base64Schema,
  ct: Base64Schema,
  aad_ctx: EnvelopeAadContextSchema,
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** Raw byte lengths the envelope's base64 fields must decode to. */
export const EPK_BYTES = 32;
export const WRAP_NONCE_BYTES = 12;
export const WRAPPED_KEY_CT_BYTES = 48; // 32-byte K_file + 16-byte GCM tag

/** File ciphertext on-wire layout: 12-byte nonce || ciphertext || 16-byte GCM tag. */
export const FILE_NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;
export const AAD_DOMAIN = "securelambda/v1";

export function buildAad(ctx: EnvelopeAadContext): Uint8Array {
  return new TextEncoder().encode([AAD_DOMAIN, ctx.listing, ctx.role, ctx.ev, ctx.ct_sha256].join("||"));
}
