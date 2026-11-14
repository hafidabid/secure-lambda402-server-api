import { createHash } from "node:crypto";
import type { AssetRole, Envelope } from "@securelambda/schemas";
import { decryptFile, encryptFile } from "./file-cipher";
import { unwrapKey, wrapKey } from "./key-wrap";

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface SealContext {
  listing: string;
  role: AssetRole;
  ev: string;
}

export interface SealedFile {
  blob: Buffer;
  envelope: Envelope;
}

/** Full browser-side seal: encrypt the file, then wrap K_file bound to the resulting ciphertext hash. */
export function sealFile(plaintext: Buffer, evaluatorPublicKey: Buffer, ctx: SealContext): SealedFile {
  const { blob, kFile } = encryptFile(plaintext);
  const envelope = wrapKey(kFile, evaluatorPublicKey, { ...ctx, ct_sha256: sha256Hex(blob) });
  return { blob, envelope };
}

/**
 * Full evaluator-side open: recompute the ciphertext hash from the bytes
 * actually received (never trust the envelope's self-reported hash), unwrap
 * K_file bound to that hash plus the caller's own listing/role/version, then
 * decrypt the file.
 */
export function openFile(blob: Buffer, envelope: Envelope, evaluatorPrivateKey: Buffer, ctx: SealContext): Buffer {
  const kFile = unwrapKey(envelope, evaluatorPrivateKey, { ...ctx, ct_sha256: sha256Hex(blob) });
  return decryptFile(blob, kFile);
}
