import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { AssetRole, Envelope } from "@securelambda/schemas";
import { decryptFile, encryptFile } from "./file-cipher";
import { unwrapKey, wrapKey } from "./key-wrap";

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

export interface SealContext {
  listing: string;
  role: AssetRole;
  ev: string;
}

export interface SealedFile {
  blob: Uint8Array;
  envelope: Envelope;
}

/** Full browser-side seal: encrypt the file, then wrap K_file bound to the resulting ciphertext hash. */
export function sealFile(plaintext: Uint8Array, evaluatorPublicKey: Uint8Array, ctx: SealContext): SealedFile {
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
export function openFile(blob: Uint8Array, envelope: Envelope, evaluatorPrivateKey: Uint8Array, ctx: SealContext): Uint8Array {
  const kFile = unwrapKey(envelope, evaluatorPrivateKey, { ...ctx, ct_sha256: sha256Hex(blob) });
  return decryptFile(blob, kFile);
}
