import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { FILE_NONCE_BYTES, GCM_TAG_BYTES } from "@securelambda/schemas";

export const K_FILE_BYTES = 32;

export interface EncryptedFile {
  /** On-wire blob: 12-byte nonce || ciphertext || 16-byte GCM tag (docs/03 B7). */
  blob: Buffer;
  kFile: Buffer;
}

/** AES-256-GCM encrypt with a fresh random key and nonce. No AAD, no compression (B7). */
export function encryptFile(plaintext: Buffer): EncryptedFile {
  if (plaintext.length === 0) {
    // CR-12: an empty file is rejected before any key is generated or bytes are encrypted.
    throw new RangeError("cannot encrypt an empty file");
  }
  const kFile = randomBytes(K_FILE_BYTES);
  const nonce = randomBytes(FILE_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", kFile, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { blob: Buffer.concat([nonce, ciphertext, tag]), kFile };
}

export class FileDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileDecryptError";
  }
}

/** Splits the on-wire blob and decrypts. Throws FileDecryptError on a bad tag (CR-07). */
export function decryptFile(blob: Buffer, kFile: Buffer): Buffer {
  if (blob.length < FILE_NONCE_BYTES + GCM_TAG_BYTES) {
    throw new FileDecryptError("ciphertext blob too short to contain nonce and tag");
  }
  const nonce = blob.subarray(0, FILE_NONCE_BYTES);
  const tag = blob.subarray(blob.length - GCM_TAG_BYTES);
  const ciphertext = blob.subarray(FILE_NONCE_BYTES, blob.length - GCM_TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", kFile, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new FileDecryptError(`AES-GCM authentication failed: ${(err as Error).message}`);
  }
}
