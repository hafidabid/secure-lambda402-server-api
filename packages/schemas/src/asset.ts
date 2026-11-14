import { z } from "zod";
import { ASSET_ROLES, EnvelopeSchema } from "./envelope";

export const MAX_UPLOAD_BYTES_TONIGHT = 1 * 1024 * 1024; // 1 MB (docs/03 section 9, "Tonight")
export const MAX_UPLOAD_BYTES_V1 = 50 * 1024 * 1024; // 50 MB (V1)

export const AssetKindSchema = z.enum(ASSET_ROLES);

export const AssetSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  kind: AssetKindSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size_bytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES_V1),
  storage_key: z.string(),
  created_at: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

/** Multipart upload is `ciphertext` (raw bytes) + `wrapped_key` (JSON envelope) per docs/03 B4. */
export const UploadAssetMetaSchema = z.object({
  wrapped_key: EnvelopeSchema,
});
export type UploadAssetMeta = z.infer<typeof UploadAssetMetaSchema>;

export const UploadAssetResponseSchema = z.object({
  asset_id: z.string(),
});
export type UploadAssetResponse = z.infer<typeof UploadAssetResponseSchema>;

export const EvaluatorMetadataSchema = z.object({
  version: z.string(),
  project_id: z.string(),
  wasm_hash: z.string().regex(/^[a-f0-9]{64}$/),
  public_key: z.string(), // base64 X25519 public key, E_pub
  trust_tier: z.union([z.literal(1), z.literal(2)]),
});
export type EvaluatorMetadata = z.infer<typeof EvaluatorMetadataSchema>;
