import { z } from "zod";

export const X402_VERSION = 1;
export const DEFAULT_PAYMENT_VALID_MINUTES = 15;

export const PaymentAssetSchema = z.enum(["near", "usdc"]);
export type PaymentAsset = z.infer<typeof PaymentAssetSchema>;

/** One `accepts` entry in a 402 response (docs/03 B4 "402 response body"). */
export const X402AcceptSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string(), // e.g. "near:testnet"
  asset: PaymentAssetSchema,
  maxAmountRequired: z.string().regex(/^\d+$/),
  payTo: z.string().min(1),
  resource: z.string().min(1),
  validUntil: z.string().datetime(),
  nonce: z.string().min(1),
});
export type X402Accept = z.infer<typeof X402AcceptSchema>;

export const X402QuoteSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  accepts: z.array(X402AcceptSchema).min(1),
});
export type X402Quote = z.infer<typeof X402QuoteSchema>;

/**
 * Signed payment retried by the agent after the first 402 (docs/03 section
 * 5, B6). `signedDelegate` is the base64-encoded NEP-366 signed delegate
 * action naming the transfer; `maxBlockHeight` bounds its validity window.
 */
export const SignedPaymentSchema = z.object({
  nonce: z.string().min(1),
  payerId: z.string().min(1),
  payerPublicKey: z.string().min(1),
  payTo: z.string().min(1),
  asset: PaymentAssetSchema,
  amount: z.string().regex(/^\d+$/),
  validUntil: z.string().datetime(),
  maxBlockHeight: z.number().int().positive(),
  signedDelegate: z.string().min(1), // base64
});
export type SignedPayment = z.infer<typeof SignedPaymentSchema>;

/**
 * Canonical bytes a payer signs and a facilitator re-derives to verify
 * (docs/03 B6). This is the "thin payment shim that signs and verifies the
 * same payload" fallback named in docs/05 section 2's fallback ladder for
 * when `@x402/near` native-NEAR support can't be confirmed — the signature
 * itself is a plain ed25519 signature over this payload, not a parsed NEAR
 * transaction, so both the agent-sdk signer and the facilitator must build
 * this identically.
 */
export function buildPaymentSigningPayload(
  payment: Pick<SignedPayment, "nonce" | "payerId" | "payTo" | "asset" | "amount" | "validUntil" | "maxBlockHeight">,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      nonce: payment.nonce,
      payerId: payment.payerId,
      payTo: payment.payTo,
      asset: payment.asset,
      amount: payment.amount,
      validUntil: payment.validUntil,
      maxBlockHeight: payment.maxBlockHeight,
    }),
    "utf8",
  );
}

export const PaymentStatusSchema = z.enum(["verified", "settled", "expired", "failed"]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentSchema = z.object({
  run_id: z.string(),
  nonce: z.string(),
  payer_id: z.string(),
  pay_to: z.string(),
  asset: PaymentAssetSchema,
  amount: z.string(),
  valid_until: z.string(),
  status: PaymentStatusSchema,
  settle_tx_hash: z.string().nullable(),
});
export type Payment = z.infer<typeof PaymentSchema>;
