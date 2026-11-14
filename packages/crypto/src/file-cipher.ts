import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import { FILE_NONCE_BYTES, GCM_TAG_BYTES } from "@securelambda/schemas";

export const K_FILE_BYTES = 32;

export interface EncryptedFile {
  /** On-wire blob: 12-byte nonce || ciphertext || 16-byte GCM tag (docs/03 B7). */
  blob: Uint8Array;
  kFile: Uint8Array;
}

/** AES-256-GCM encrypt with a fresh random key and nonce. No AAD, no compression (B7). */
export function encryptFile(plaintext: Uint8Array): EncryptedFile {
  if (plaintext.length === 0) {
    // CR-12: an empty file is rejected before any key is generated or bytes are encrypted.
    throw new RangeError("cannot encrypt an empty file");
  }
  const kFile = randomBytes(K_FILE_BYTES);
  const nonce = randomBytes(FILE_NONCE_BYTES);
  const sealed = gcm(kFile, nonce).encrypt(plaintext);
  const blob = new Uint8Array(nonce.length + sealed.length);
  blob.set(nonce);
  blob.set(sealed, nonce.length);
  return { blob, kFile };
}

export class FileDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileDecryptError";
  }
}

/** Splits the on-wire blob and decrypts. Throws FileDecryptError on a bad tag (CR-07). */
export function decryptFile(blob: Uint8Array, kFile: Uint8Array): Uint8Array {
  if (blob.length < FILE_NONCE_BYTES + GCM_TAG_BYTES) {
    throw new FileDecryptError("ciphertext blob too short to contain nonce and tag");
  }
  try {
    return gcm(kFile, blob.subarray(0, FILE_NONCE_BYTES)).decrypt(blob.subarray(FILE_NONCE_BYTES));
  } catch (err) {
    throw new FileDecryptError(`AES-GCM authentication failed: ${(err as Error).message}`);
  }
}
