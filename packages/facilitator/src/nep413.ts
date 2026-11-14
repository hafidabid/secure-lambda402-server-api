import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { KeyPair, PublicKey } from "@near-js/crypto";
import { serialize } from "borsh";

/**
 * NEP-413: sign an off-chain message with a NEAR key, to prove control of an account without a transaction.
 * The signed bytes are sha256(borsh(2^31 + 413 as u32) ++ borsh(Payload)), so a signature can never be
 * replayed as a transaction (the tag makes it an invalid transaction prefix).
 */
export const NEP413_TAG = 2147484061; // 2**31 + 413

export interface Nep413Payload {
  message: string;
  /** 32 random bytes, chosen by the verifier, so a signature is good for one login only. */
  nonce: Buffer;
  /** Who the signature is for (here, this API's audience string). */
  recipient: string;
  callbackUrl?: string;
}

const PAYLOAD_SCHEMA = {
  struct: {
    tag: "u32",
    message: "string",
    nonce: { array: { type: "u8", len: 32 } },
    recipient: "string",
    callbackUrl: { option: "string" },
  },
} as const;

/** The 32-byte digest that is actually signed. */
export function nep413Hash(payload: Nep413Payload): Buffer {
  if (payload.nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const bytes = serialize(PAYLOAD_SCHEMA, {
    tag: NEP413_TAG,
    message: payload.message,
    nonce: Array.from(payload.nonce),
    recipient: payload.recipient,
    callbackUrl: payload.callbackUrl ?? null,
  });
  return createHash("sha256").update(bytes).digest();
}

export interface Nep413Signature {
  /** `ed25519:<base58>` public key that signed. */
  publicKey: string;
  /** base64 of the raw 64-byte signature. */
  signature: string;
}

export function signNep413(privateKey: string, payload: Nep413Payload): Nep413Signature {
  const keyPair = KeyPair.fromString(privateKey as `ed25519:${string}`);
  const { signature } = keyPair.sign(nep413Hash(payload));
  return { publicKey: keyPair.getPublicKey().toString(), signature: Buffer.from(signature).toString("base64") };
}

/** True only if `signature` is a valid ed25519 signature by `publicKey` over this exact payload. */
export function verifyNep413(publicKey: string, signatureBase64: string, payload: Nep413Payload): boolean {
  try {
    const raw = Buffer.from(signatureBase64, "base64");
    if (raw.length !== 64) return false;
    const parsed = PublicKey.fromString(publicKey);
    if (!parsed.ed25519Key) return false;
    return ed25519.verify(raw, nep413Hash(payload), Buffer.from(parsed.ed25519Key.data));
  } catch {
    return false;
  }
}
