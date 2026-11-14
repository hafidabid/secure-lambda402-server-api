import { buildPaymentSigningPayload, type SignedPayment } from "./payment";

const base: Pick<SignedPayment, "nonce" | "payerId" | "payTo" | "asset" | "amount" | "validUntil" | "maxBlockHeight"> = {
  nonce: "n_1",
  payerId: "buyer.testnet",
  payTo: "seller.testnet",
  asset: "near",
  amount: "1000",
  validUntil: "2026-11-14T22:15:00.000Z",
  maxBlockHeight: 12345,
};

describe("buildPaymentSigningPayload", () => {
  it("is deterministic for the same inputs", () => {
    expect(buildPaymentSigningPayload(base)).toEqual(buildPaymentSigningPayload({ ...base }));
  });

  it("changes when the amount changes (PY-06 depends on this)", () => {
    const a = buildPaymentSigningPayload(base);
    const b = buildPaymentSigningPayload({ ...base, amount: "999" });
    expect(a.equals(b)).toBe(false);
  });

  it("changes when payTo changes (PY-07 depends on this)", () => {
    const a = buildPaymentSigningPayload(base);
    const b = buildPaymentSigningPayload({ ...base, payTo: "attacker.testnet" });
    expect(a.equals(b)).toBe(false);
  });
});
