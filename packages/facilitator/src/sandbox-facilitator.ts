import type Redis from "ioredis";
import { ed25519 } from "@noble/curves/ed25519";
import { buildPaymentSigningPayload, type SignedPayment, type X402Accept } from "@securelambda/schemas";
import type { FacilitatorPort, SettleResult, VerifyResult } from "./types";

const ACCOUNT_KEY = (prefix: string, accountId: string) => `${prefix}:account:${accountId}`;
const NONCE_KEY = (prefix: string, nonce: string) => `${prefix}:nonce:${nonce}`;
const RELAYER_GAS_KEY = (prefix: string) => `${prefix}:relayer_has_gas`;

/**
 * Facilitator standing in for `@x402/near` + a real NEAR RPC (docs/05
 * section 7.1 seams I3/I4: "Facilitator stub that signs and checks" before
 * the real thing, a "Sandbox" before testnet). Signatures are plain
 * ed25519 over `buildPaymentSigningPayload` — the "thin payment shim"
 * fallback docs/05 section 2 names for when native-NEAR support via
 * `@x402/near` isn't confirmed — not a parsed NEP-366 delegate action.
 *
 * All state lives in Redis, not local JS memory: the gateway (which
 * verifies) and the worker (which settles) run as separate processes, and
 * a real chain's state is shared by definition, so the sandbox must be too.
 *
 * Verify never spends anything (docs/03 B6 point 3). Settle is the only
 * place balances move, and is safe to call twice for the same nonce.
 */
export class SandboxFacilitator implements FacilitatorPort {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix = "facilitator",
  ) {}

  async registerAccountKey(accountId: string, publicKeyBase64: string): Promise<void> {
    await this.redis.hset(ACCOUNT_KEY(this.keyPrefix, accountId), "publicKey", publicKeyBase64);
  }

  async setBalance(accountId: string, amount: bigint): Promise<void> {
    await this.redis.hset(ACCOUNT_KEY(this.keyPrefix, accountId), "balance", amount.toString());
  }

  async getBalance(accountId: string): Promise<bigint> {
    const value = await this.redis.hget(ACCOUNT_KEY(this.keyPrefix, accountId), "balance");
    return value ? BigInt(value) : 0n;
  }

  async setRelayerHasGas(hasGas: boolean): Promise<void> {
    await this.redis.set(RELAYER_GAS_KEY(this.keyPrefix), hasGas ? "1" : "0");
  }

  private async relayerHasGas(): Promise<boolean> {
    const value = await this.redis.get(RELAYER_GAS_KEY(this.keyPrefix));
    return value !== "0"; // default: has gas
  }

  async verify(payment: SignedPayment, quote: X402Accept): Promise<VerifyResult> {
    // PY-06: amount must meet what was quoted.
    if (BigInt(payment.amount) < BigInt(quote.maxAmountRequired)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "amount is lower than the quoted price" };
    }
    // PY-07: payTo must match the quote (the seller who was actually quoted).
    if (payment.payTo !== quote.payTo) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "payTo does not match the quote" };
    }
    // PY-08: the signing key must be the one on record for the payer account.
    const knownKey = await this.redis.hget(ACCOUNT_KEY(this.keyPrefix, payment.payerId), "publicKey");
    if (!knownKey || knownKey !== payment.payerPublicKey) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "signer key is not on the payer account" };
    }
    // Signature check over the canonical payload (never trust the client's claim alone).
    if (!this.verifySignature(payment)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "signature does not verify" };
    }
    // PY-09: expiry, checked against absolute time (clock-skew safe, PY-20).
    if (new Date(payment.validUntil).getTime() <= Date.now()) {
      return { ok: false, code: "PAYMENT_EXPIRED", reason: "payment validUntil has passed" };
    }

    // PY-10 / PY-04: nonce reuse. Byte-identical replay of an already-seen
    // nonce is an idempotent no-op (safe retry); a nonce reused with a
    // different payload is rejected outright.
    const payloadHex = buildPaymentSigningPayload(payment).toString("hex");
    const existingPayload = await this.redis.hget(NONCE_KEY(this.keyPrefix, payment.nonce), "payload");
    if (existingPayload) {
      if (existingPayload !== payloadHex) {
        return { ok: false, code: "PAYMENT_REUSED", reason: "nonce was already used with a different payment" };
      }
      return { ok: true };
    }

    // PY-11: balance sufficient. Nothing is spent here.
    const balance = await this.getBalance(payment.payerId);
    if (balance < BigInt(payment.amount)) {
      return { ok: false, code: "PAYMENT_INVALID", reason: "insufficient balance" };
    }

    await this.redis.hset(NONCE_KEY(this.keyPrefix, payment.nonce), "payload", payloadHex, "settled", "0");
    return { ok: true };
  }

  async settle(payment: SignedPayment): Promise<SettleResult> {
    // PY-19: relayer out of gas blocks settlement (in-flight runs hold SETTLE_PENDING).
    if (!(await this.relayerHasGas())) {
      return { ok: false, reason: "relayer has no gas" };
    }

    const nonceKey = NONCE_KEY(this.keyPrefix, payment.nonce);
    const settled = await this.redis.hget(nonceKey, "settled");
    if (settled === "1") {
      // Already settled once: safe to report success again without moving funds twice.
      return { ok: true, settleTxHash: `sandbox_tx_${payment.nonce}` };
    }

    // PY-18: re-check balance immediately before moving funds, since time
    // has passed since verify() and the payer could have spent the funds.
    const amount = BigInt(payment.amount);
    const balance = await this.getBalance(payment.payerId);
    if (balance < amount) {
      return { ok: false, reason: "balance dropped below the payment amount since verify" };
    }

    await this.setBalance(payment.payerId, balance - amount);
    await this.setBalance(payment.payTo, (await this.getBalance(payment.payTo)) + amount);
    const payloadHex = buildPaymentSigningPayload(payment).toString("hex");
    await this.redis.hset(nonceKey, "payload", payloadHex, "settled", "1");

    return { ok: true, settleTxHash: `sandbox_tx_${payment.nonce}` };
  }

  private verifySignature(payment: SignedPayment): boolean {
    try {
      const payload = buildPaymentSigningPayload(payment);
      const publicKey = Buffer.from(payment.payerPublicKey, "base64");
      const signature = Buffer.from(payment.signedDelegate, "base64");
      if (publicKey.length !== 32 || signature.length !== 64) return false;
      return ed25519.verify(signature, payload, publicKey);
    } catch {
      return false;
    }
  }
}
