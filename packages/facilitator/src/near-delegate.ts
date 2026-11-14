import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { KeyPair, KeyType, PublicKey } from "@near-js/crypto";
import {
  Signature,
  SignedDelegate,
  SCHEMA,
  actionCreators,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
} from "@near-js/transactions";
import { deserialize } from "borsh";
import type { SignedPayment, X402Accept } from "@securelambda/schemas";

/**
 * Real NEP-366 delegate actions for the x402 "exact" scheme on NEAR.
 *
 * The buyer signs a DelegateAction that calls `ft_transfer` on a NEP-141 token
 * contract ("move N tokens from me to the seller"). The relayer wraps that
 * signature in a normal transaction and pays the gas. The buyer never submits
 * anything, and funds only move when the relayer submits (at settle time).
 *
 * Why a token and not a native NEAR `Transfer`: the deposit of any action inside a
 * delegate is charged to the relayer, not the sender. A native transfer would be
 * paid for by the relayer. `ft_transfer` debits the buyer's token balance inside
 * the token contract; the relayer only attaches the mandatory 1 yoctoNEAR.
 *
 * `SignedPayment.signedDelegate` carries the base64 borsh `SignedDelegate`.
 * `payerPublicKey` stays a base64 raw 32-byte ed25519 key, as in the sandbox.
 */

/** NEP-141 requires exactly 1 yoctoNEAR attached to `ft_transfer`; the relayer supplies it. */
export const FT_TRANSFER_DEPOSIT = 1n;
export const FT_TRANSFER_GAS = 30_000_000_000_000n; // 30 Tgas

export interface DecodedDelegate {
  senderId: string;
  receiverId: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: Buffer; // raw 32 bytes
  /** The single FunctionCall the delegate makes, or null when the actions are anything else. */
  call: { methodName: string; args: Buffer; deposit: bigint; gas: bigint } | null;
  signature: Buffer; // raw 64 bytes
  /** sha256 over the NEP-461 prefixed borsh bytes: exactly what the buyer signed. */
  signingHash: Buffer;
}

export function decodeSignedDelegate(base64: string): DecodedDelegate {
  const decoded = deserialize(SCHEMA.SignedDelegate, Buffer.from(base64, "base64")) as unknown as SignedDelegate;
  const da = decoded.delegateAction;
  const only = da.actions.length === 1 ? da.actions[0] : undefined;
  const sigData = decoded.signature.ed25519Signature?.data;
  const keyData = da.publicKey.ed25519Key?.data;
  if (!sigData || !keyData) throw new Error("only ed25519 delegate signatures are supported");
  return {
    senderId: da.senderId,
    receiverId: da.receiverId,
    nonce: BigInt(da.nonce),
    maxBlockHeight: BigInt(da.maxBlockHeight),
    publicKey: Buffer.from(keyData),
    call: only?.functionCall
      ? {
          methodName: only.functionCall.methodName,
          args: Buffer.from(only.functionCall.args),
          deposit: BigInt(only.functionCall.deposit),
          gas: BigInt(only.functionCall.gas),
        }
      : null,
    signature: Buffer.from(sigData),
    signingHash: Buffer.from(sha256(encodeDelegateAction(da))),
  };
}

export function verifyDelegateSignature(d: DecodedDelegate): boolean {
  try {
    return ed25519.verify(d.signature, d.signingHash, d.publicKey);
  } catch {
    return false;
  }
}

export interface SignDelegatePaymentInput {
  payerId: string;
  /** NEAR secret key string, `ed25519:<base58>`. */
  privateKey: string;
  quote: X402Accept;
  /** The access key's current on-chain nonce (the delegate uses nonce + 1). */
  accessKeyNonce: bigint;
  /** Current chain height; the delegate expires `ttlBlocks` after it. */
  currentBlockHeight: number;
  ttlBlocks: number;
}

/** Builds the `SignedPayment` an agent sends in `X-Payment`, backed by a real signed delegate action. */
export function signDelegatePayment(input: SignDelegatePaymentInput): SignedPayment {
  if (!input.quote.assetContract) throw new Error("quote has no assetContract; the NEAR facilitator pays in a NEP-141 token");
  const keyPair = KeyPair.fromString(input.privateKey as `ed25519:${string}`);
  const publicKey = keyPair.getPublicKey();
  const rawPublicKey = publicKey.ed25519Key!.data;
  const maxBlockHeight = input.currentBlockHeight + input.ttlBlocks;

  const delegateAction = buildDelegateAction({
    senderId: input.payerId,
    receiverId: input.quote.assetContract,
    actions: [
      actionCreators.functionCall(
        "ft_transfer",
        new TextEncoder().encode(
          JSON.stringify({ receiver_id: input.quote.payTo, amount: input.quote.maxAmountRequired, memo: input.quote.nonce }),
        ),
        FT_TRANSFER_GAS,
        FT_TRANSFER_DEPOSIT,
      ),
    ],
    nonce: input.accessKeyNonce + 1n,
    maxBlockHeight: BigInt(maxBlockHeight),
    publicKey: new PublicKey({ keyType: KeyType.ED25519, data: rawPublicKey }),
  });
  const { signature } = keyPair.sign(sha256(encodeDelegateAction(delegateAction)));
  const signed = new SignedDelegate({
    delegateAction,
    signature: new Signature({ keyType: KeyType.ED25519, data: signature }),
  });

  const unsigned = {
    nonce: input.quote.nonce,
    payerId: input.payerId,
    payerPublicKey: toBase64(rawPublicKey),
    payTo: input.quote.payTo,
    asset: input.quote.asset,
    amount: input.quote.maxAmountRequired,
    validUntil: input.quote.validUntil,
    maxBlockHeight,
  };
  return { ...unsigned, signedDelegate: toBase64(encodeSignedDelegate(signed)) };
}

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

/** A fresh random NEAR secret key (`ed25519:<base58>`). Handy for tests and for building deliberately invalid payments. */
export function randomNearPrivateKey(): string {
  return KeyPair.fromRandom("ed25519").toString();
}
