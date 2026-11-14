import type { SignedPayment, X402Accept } from "@securelambda/schemas";

export type VerifyFailureCode = "PAYMENT_INVALID" | "PAYMENT_EXPIRED" | "PAYMENT_REUSED";

export type VerifyResult = { ok: true } | { ok: false; code: VerifyFailureCode; reason: string };

export type SettleResult = { ok: true; settleTxHash: string } | { ok: false; reason: string };

/**
 * Ports the gateway and worker depend on (docs/03 B6, seams I3/I4 in docs/05
 * section 7.1). `verify` spends nothing. `settle` is only ever called once a
 * run's result is ready, and must be safe to retry. Both the gateway and
 * the worker run as separate processes, so any implementation here must
 * keep its state somewhere both processes can see (Redis for the sandbox
 * implementation) — never only in local JS memory.
 */
export interface FacilitatorPort {
  verify(payment: SignedPayment, quote: X402Accept): Promise<VerifyResult>;
  settle(payment: SignedPayment): Promise<SettleResult>;
}
