import type Redis from "ioredis";
import { KeyType, PublicKey } from "@near-js/crypto";
import { buildPaymentSigningPayload, type SignedPayment, type X402Accept } from "@securelambda/schemas";
import { RELAYER_MIN_BALANCE_YOCTO, type NearChain } from "./near-chain";
import { FT_TRANSFER_DEPOSIT, decodeSignedDelegate, verifyDelegateSignature } from "./near-delegate";
import type { FacilitatorPort, SettleResult, VerifyResult } from "./types";

const NONCE_KEY = (prefix: string, nonce: string) => `${prefix}:nonce:${nonce}`;
const LOCK_KEY = (prefix: string, nonce: string) => `${prefix}:settle-lock:${nonce}`;

/** A delegate must stay valid at least this many blocks after verify, or it would likely expire before settle. */
const MIN_REMAINING_BLOCKS = 30;
const SETTLE_LOCK_SECONDS = 120;

/**
 * Real x402 "exact" facilitator for NEAR. It replaces the Redis sandbox ledger
 * with the chain itself: verify reads on-chain state, settle submits the
 * buyer's signed NEP-366 delegate action as a relayer-paid transaction.
 *
 * Payments are NEP-141 `ft_transfer` calls (wNEAR, USDC, ...), restricted to an
 * allow-list of token contracts. The token is debited from the buyer by the token
 * contract; the relayer only pays gas and the 1 yoctoNEAR the standard demands.
 *
 * Redis is still used, but only for two things the chain cannot tell us:
 * remembering which quote nonces we have accepted (replay protection across
 * the gateway and worker processes) and not submitting the same payment twice
 * at once.
 */
export class NearFacilitator implements FacilitatorPort {
  constructor(
    private readonly redis: Redis,
    private readonly chain: NearChain,
    private readonly allowedTokenContracts: string[],
    private readonly keyPrefix = "facilitator-near",
  ) {}

  async verify(payment: SignedPayment, quote: X402Accept): Promise<VerifyResult> {
    const token = quote.assetContract;
    if (!token || !this.allowedTokenContracts.includes(token)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "quote token contract is not one this facilitator settles" };
    }
    if (BigInt(payment.amount) < BigInt(quote.maxAmountRequired)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "amount is lower than the quoted price" };
    }
    if (payment.payTo !== quote.payTo) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "payTo does not match the quote" };
    }
    let delegate;
    try {
      delegate = decodeSignedDelegate(payment.signedDelegate);
    } catch {
      return { ok: false, code: "PAYMENT_INVALID", reason: "signedDelegate is not a valid NEP-366 signed delegate action" };
    }

    // What the buyer actually signed must be exactly what the quote asked for. Never trust the JSON fields alone.
    if (delegate.senderId !== payment.payerId) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "delegate sender does not match payerId" };
    }
    if (delegate.receiverId !== token) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "delegate does not call the quoted token contract" };
    }
    if (!delegate.call || delegate.call.methodName !== "ft_transfer") {
      return { ok: false, code: "PAYMENT_INVALID", reason: "delegate must contain exactly one ft_transfer call" };
    }
    if (delegate.call.deposit !== FT_TRANSFER_DEPOSIT) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "ft_transfer must attach exactly 1 yoctoNEAR" };
    }
    let args: { receiver_id?: unknown; amount?: unknown };
    try {
      args = JSON.parse(delegate.call.args.toString("utf8"));
    } catch {
      return { ok: false, code: "PAYMENT_INVALID", reason: "ft_transfer arguments are not valid JSON" };
    }
    if (args.receiver_id !== quote.payTo) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "ft_transfer receiver does not match the quote payTo" };
    }
    if (args.amount !== payment.amount || BigInt(payment.amount) < BigInt(quote.maxAmountRequired)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "ft_transfer amount does not match the payment" };
    }
    if (delegate.maxBlockHeight !== BigInt(payment.maxBlockHeight)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "delegate maxBlockHeight does not match the payment" };
    }
    if (Buffer.from(payment.payerPublicKey, "base64").compare(delegate.publicKey) !== 0) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "payerPublicKey does not match the delegate key" };
    }
    if (!verifyDelegateSignature(delegate)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "signature does not verify" };
    }

    // Nonce reuse: identical replay is a safe no-op; the same nonce with a different payment is rejected.
    // This runs before the expiry check on purpose: the worker re-verifies right before settling, and a
    // payment that was accepted while valid must stay settleable even if its quote expired in the meantime.
    const payloadHex = buildPaymentSigningPayload(payment).toString("hex");
    const existing = await this.redis.hget(NONCE_KEY(this.keyPrefix, payment.nonce), "payload");
    if (existing) {
      if (existing !== payloadHex) {
        return { ok: false, code: "PAYMENT_REUSED", reason: "nonce was already used with a different payment" };
      }
      return { ok: true };
    }
    if (new Date(payment.validUntil).getTime() <= Date.now()) {
      return { ok: false, code: "PAYMENT_EXPIRED", reason: "payment validUntil has passed" };
    }

    // On-chain checks: the signing key really belongs to the payer, the delegate is still usable, the payer can afford it.
    const publicKeyString = new PublicKey({ keyType: KeyType.ED25519, data: delegate.publicKey }).toString();
    const [accessKeyNonce, height, balance, sellerRegistered] = await Promise.all([
      this.chain.getAccessKeyNonce(payment.payerId, publicKeyString),
      this.chain.getBlockHeight(),
      this.chain.getTokenBalance(token, payment.payerId),
      this.chain.isRegisteredOnToken(token, payment.payTo),
    ]);
    if (accessKeyNonce === null) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "signer key is not an access key on the payer account" };
    }
    if (delegate.nonce <= accessKeyNonce) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "delegate nonce is not above the access key's current nonce" };
    }
    if (delegate.maxBlockHeight < BigInt(height + MIN_REMAINING_BLOCKS)) {
      return { ok: false, code: "PAYMENT_EXPIRED", reason: "delegate action expires too soon (maxBlockHeight)" };
    }
    if (balance < BigInt(payment.amount)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "insufficient balance" };
    }
    // Checked now so a misconfigured seller fails before any compute is spent, not after.
    if (!sellerRegistered) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "seller is not registered on the token contract (storage_deposit)" };
    }

    await this.redis.hset(NONCE_KEY(this.keyPrefix, payment.nonce), "payload", payloadHex, "settled", "0");
    return { ok: true };
  }

  async settle(payment: SignedPayment): Promise<SettleResult> {
    const nonceKey = NONCE_KEY(this.keyPrefix, payment.nonce);
    const alreadySettled = await this.redis.hget(nonceKey, "settleTxHash");
    if (alreadySettled) return { ok: true, settleTxHash: alreadySettled };

    if ((await this.chain.relayerBalance()) < RELAYER_MIN_BALANCE_YOCTO) {
      return { ok: false, reason: "relayer has no gas" };
    }

    // One submitter at a time per payment, so a retry can't race an attempt that is still in flight.
    const locked = await this.redis.set(LOCK_KEY(this.keyPrefix, payment.nonce), "1", "EX", SETTLE_LOCK_SECONDS, "NX");
    if (!locked) return { ok: false, reason: "settlement already in progress" };

    try {
      const result = await this.chain.submitDelegate(payment.signedDelegate, payment.payerId);
      if (!result.ok) return { ok: false, reason: result.reason };
      await this.redis.hset(nonceKey, "settled", "1", "settleTxHash", result.txHash);
      return { ok: true, settleTxHash: result.txHash };
    } finally {
      await this.redis.del(LOCK_KEY(this.keyPrefix, payment.nonce));
    }
  }
}
