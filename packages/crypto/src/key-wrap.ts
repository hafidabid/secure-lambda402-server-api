import { gcm } from "@noble/ciphers/aes";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import {
  buildAad,
  EPK_BYTES,
  type Envelope,
  type EnvelopeAadContext,
  WRAP_NONCE_BYTES,
  WRAPPED_KEY_CT_BYTES,
} from "@securelambda/schemas";

const HKDF_INFO = utf8ToBytes("securelambda/v1/wrap");
const HKDF_SALT = new Uint8Array(0);
const WRAPPING_KEY_BYTES = 32;

export function generateEvaluatorKeypair(): { publicKey: Buffer; privateKey: Buffer } {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey: Buffer.from(publicKey), privateKey: Buffer.from(privateKey) };
}

function deriveWrappingKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, HKDF_SALT, HKDF_INFO, WRAPPING_KEY_BYTES);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
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
export function wrapKey(kFile: Uint8Array, evaluatorPublicKey: Uint8Array, ctx: EnvelopeAadContext): Envelope {
  if (evaluatorPublicKey.length !== EPK_BYTES) {
    throw new EnvelopeError(`evaluator public key must be ${EPK_BYTES} bytes`);
  }
  const ephemeralPrivate = x25519.utils.randomPrivateKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, evaluatorPublicKey);
  const wrappingKey = deriveWrappingKey(sharedSecret);

  const nonce = randomBytes(WRAP_NONCE_BYTES);
  const ct = gcm(wrappingKey, nonce, buildAad(ctx)).encrypt(kFile);

  return {
    v: 1,
    epk: toBase64(ephemeralPublic),
    nonce: toBase64(nonce),
    ct: toBase64(ct),
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
  evaluatorPrivateKey: Uint8Array,
  expectedCtx: EnvelopeAadContext,
): Uint8Array {
  if (envelope.v !== 1) {
    throw new EnvelopeError(`unsupported envelope version: ${envelope.v}`);
  }
  const epk = fromBase64(envelope.epk);
  const nonce = fromBase64(envelope.nonce);
  const ct = fromBase64(envelope.ct);
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
  try {
    return gcm(wrappingKey, nonce, buildAad(expectedCtx)).decrypt(ct);
  } catch (err) {
    throw new EnvelopeError(`UNWRAP_FAILED: ${(err as Error).message}`);
  }
}
