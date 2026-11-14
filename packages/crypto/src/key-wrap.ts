import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import {
  buildAad,
  EPK_BYTES,
  type Envelope,
  type EnvelopeAadContext,
  WRAP_NONCE_BYTES,
  WRAPPED_KEY_CT_BYTES,
} from "@securelambda/schemas";

const HKDF_INFO = Buffer.from("securelambda/v1/wrap", "utf8");
const HKDF_SALT = new Uint8Array(0);
const WRAPPING_KEY_BYTES = 32;

export function generateEvaluatorKeypair(): { publicKey: Buffer; privateKey: Buffer } {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey: Buffer.from(publicKey), privateKey: Buffer.from(privateKey) };
}

function deriveWrappingKey(sharedSecret: Uint8Array): Buffer {
  return Buffer.from(hkdf(sha256, sharedSecret, HKDF_SALT, HKDF_INFO, WRAPPING_KEY_BYTES));
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}

/**
 * Wraps a file key to the evaluator's X25519 public key, binding the
 * envelope to `ctx` (listing, role, evaluator version, ciphertext hash) via
 * AES-GCM AAD, per docs/03 B7.
 */
export function wrapKey(kFile: Buffer, evaluatorPublicKey: Buffer, ctx: EnvelopeAadContext): Envelope {
  if (evaluatorPublicKey.length !== EPK_BYTES) {
    throw new EnvelopeError(`evaluator public key must be ${EPK_BYTES} bytes`);
  }
  const ephemeralPrivate = x25519.utils.randomPrivateKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, evaluatorPublicKey);
  const wrappingKey = deriveWrappingKey(sharedSecret);

  const nonce = randomBytes(WRAP_NONCE_BYTES);
  const aad = buildAad(ctx);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, nonce);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(kFile), cipher.final(), cipher.getAuthTag()]);

  return {
    v: 1,
    epk: Buffer.from(ephemeralPublic).toString("base64"),
    nonce: nonce.toString("base64"),
    ct: ct.toString("base64"),
    aad_ctx: ctx,
  };
}

/**
 * Unwraps a file key using the evaluator's private key. The AAD is rebuilt
 * from `expectedCtx` — values the caller independently knows to be true
 * (job input + the sha256 it computed itself over the received ciphertext)
 * — never from `envelope.aad_ctx`, which is attacker-controlled input. This
 * is what makes replaying a wrapped key on another listing, role or
 * evaluator version fail (CR-04, CR-05, CR-06, SC-04).
 */
export function unwrapKey(
  envelope: Envelope,
  evaluatorPrivateKey: Buffer,
  expectedCtx: EnvelopeAadContext,
): Buffer {
  if (envelope.v !== 1) {
    throw new EnvelopeError(`unsupported envelope version: ${envelope.v}`);
  }
  const epk = Buffer.from(envelope.epk, "base64");
  const nonce = Buffer.from(envelope.nonce, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  if (epk.length !== EPK_BYTES || nonce.length !== WRAP_NONCE_BYTES || ct.length !== WRAPPED_KEY_CT_BYTES) {
    throw new EnvelopeError("envelope field has an unexpected decoded length");
  }

  let sharedSecret: Uint8Array;
  try {
    sharedSecret = x25519.getSharedSecret(evaluatorPrivateKey, epk);
  } catch (err) {
    // CR-16: @noble/curves itself rejects known low-order points (e.g. the
    // all-zero point) before producing a shared secret.
    throw new EnvelopeError(`UNWRAP_FAILED: low-order or invalid ephemeral public key (${(err as Error).message})`);
  }
  if (sharedSecret.every((b) => b === 0)) {
    // Defence in depth for any low-order point @noble/curves does not itself reject.
    throw new EnvelopeError("UNWRAP_FAILED: low-order or invalid ephemeral public key");
  }
  const wrappingKey = deriveWrappingKey(sharedSecret);
  const aad = buildAad(expectedCtx);

  const tag = ct.subarray(ct.length - 16);
  const ciphertext = ct.subarray(0, ct.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", wrappingKey, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new EnvelopeError(`UNWRAP_FAILED: ${(err as Error).message}`);
  }
}
