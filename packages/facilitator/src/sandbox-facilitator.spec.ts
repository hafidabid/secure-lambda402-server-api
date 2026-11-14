import { randomUUID } from "node:crypto";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import Redis from "ioredis";
import type { SignedPayment } from "@securelambda/schemas";
import { SandboxFacilitator } from "./sandbox-facilitator";
import { buildQuote, generatePayerKeypair, signPayment } from "./test-helpers";

describe("SandboxFacilitator (Redis-backed, component test)", () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let facilitator: SandboxFacilitator;
  let payer: ReturnType<typeof generatePayerKeypair>;

  beforeAll(async () => {
    container = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379) });
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  beforeEach(() => {
    // A fresh key prefix per test isolates state without needing FLUSHALL.
    facilitator = new SandboxFacilitator(redis, `facilitator-test-${randomUUID()}`);
    payer = generatePayerKeypair();
  });

  async function registerPayer(balance = 10_000n): Promise<void> {
    await facilitator.registerAccountKey("buyer.testnet", payer.publicKeyBase64);
    await facilitator.setBalance("buyer.testnet", balance);
  }

  function validPayment(overrides: Partial<Omit<SignedPayment, "signedDelegate">> = {}): SignedPayment {
    const unsigned = {
      nonce: "n_1",
      payerId: "buyer.testnet",
      payerPublicKey: payer.publicKeyBase64,
      payTo: "seller.testnet",
      asset: "near" as const,
      amount: "1000",
      validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      maxBlockHeight: 100,
      ...overrides,
    };
    return signPayment(payer.privateKey, unsigned);
  }

  it("PY-02: a valid signed payment verifies and spends nothing", async () => {
    await registerPayer();
    const payment = validPayment();
    const result = await facilitator.verify(payment, buildQuote());
    expect(result.ok).toBe(true);
    expect(await facilitator.getBalance("buyer.testnet")).toBe(10_000n);
  });

  it("PY-03: settling after verify moves the exact price from buyer to seller exactly once", async () => {
    await registerPayer();
    const payment = validPayment();
    await facilitator.verify(payment, buildQuote());
    const settled = await facilitator.settle(payment);
    expect(settled.ok).toBe(true);
    expect(await facilitator.getBalance("buyer.testnet")).toBe(9_000n);
    expect(await facilitator.getBalance("seller.testnet")).toBe(1_000n);
  });

  it("PY-04: settling the same payment twice does not double-charge", async () => {
    await registerPayer();
    const payment = validPayment();
    await facilitator.verify(payment, buildQuote());
    await facilitator.settle(payment);
    const second = await facilitator.settle(payment);
    expect(second.ok).toBe(true);
    expect(await facilitator.getBalance("buyer.testnet")).toBe(9_000n);
    expect(await facilitator.getBalance("seller.testnet")).toBe(1_000n);
  });

  it("simulates two separate processes: one instance verifies, a different instance (same Redis) settles", async () => {
    const sharedPrefix = `shared-process-test-${randomUUID()}`;
    const gatewaySide = new SandboxFacilitator(redis, sharedPrefix);
    const workerSide = new SandboxFacilitator(redis, sharedPrefix);
    await workerSide.registerAccountKey("buyer.testnet", payer.publicKeyBase64);
    await workerSide.setBalance("buyer.testnet", 10_000n);

    const payment = validPayment();
    const verifyResult = await gatewaySide.verify(payment, buildQuote());
    expect(verifyResult.ok).toBe(true);

    const settleResult = await workerSide.settle(payment);
    expect(settleResult.ok).toBe(true);
    expect(await workerSide.getBalance("seller.testnet")).toBe(1_000n);
  });

  it("PY-06: an amount lower than the quote is rejected as PAYMENT_INVALID", async () => {
    await registerPayer();
    const payment = validPayment({ amount: "500" });
    const result = await facilitator.verify(payment, buildQuote({ maxAmountRequired: "1000" }));
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
  });

  it("PY-07: a payTo that does not match the quote is rejected as PAYMENT_INVALID", async () => {
    await registerPayer();
    const payment = validPayment({ payTo: "attacker.testnet" });
    const result = await facilitator.verify(payment, buildQuote({ payTo: "seller.testnet" }));
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
  });

  it("PY-08: a signer key not on record for the payer account is rejected as PAYMENT_INVALID", async () => {
    await registerPayer();
    const otherKeypair = generatePayerKeypair();
    const unsigned = {
      nonce: "n_1",
      payerId: "buyer.testnet",
      payerPublicKey: otherKeypair.publicKeyBase64,
      payTo: "seller.testnet",
      asset: "near" as const,
      amount: "1000",
      validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      maxBlockHeight: 100,
    };
    const payment = signPayment(otherKeypair.privateKey, unsigned);
    const result = await facilitator.verify(payment, buildQuote());
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
  });

  it("rejects a payment whose signature does not match its payload (tampered after signing)", async () => {
    await registerPayer();
    const payment = validPayment();
    const tampered = { ...payment, amount: "9999" };
    const result = await facilitator.verify(tampered, buildQuote({ maxAmountRequired: "1000" }));
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
  });

  it("PY-09: an expired payment is rejected as PAYMENT_EXPIRED", async () => {
    await registerPayer();
    const payment = validPayment({ validUntil: new Date(Date.now() - 1000).toISOString() });
    const result = await facilitator.verify(payment, buildQuote());
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_EXPIRED" });
  });

  it("PY-10: reusing a nonce with a different payload is rejected as PAYMENT_REUSED", async () => {
    await registerPayer();
    const first = validPayment({ nonce: "n_shared", amount: "1000" });
    await facilitator.verify(first, buildQuote({ nonce: "n_shared", maxAmountRequired: "1000" }));

    const second = validPayment({ nonce: "n_shared", amount: "2000" });
    const result = await facilitator.verify(second, buildQuote({ nonce: "n_shared", maxAmountRequired: "2000" }));
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_REUSED" });
  });

  it("PY-11: insufficient balance is rejected as PAYMENT_INVALID and nothing is spent", async () => {
    await registerPayer(100n);
    const payment = validPayment({ amount: "1000" });
    const result = await facilitator.verify(payment, buildQuote({ maxAmountRequired: "1000" }));
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
    expect(await facilitator.getBalance("buyer.testnet")).toBe(100n);
  });

  it("PY-18: if the balance drops below the amount between verify and settle, settle fails distinctly (no silent loss)", async () => {
    await registerPayer();
    const payment = validPayment({ amount: "1000" });
    await facilitator.verify(payment, buildQuote({ maxAmountRequired: "1000" }));
    await facilitator.setBalance("buyer.testnet", 0n);
    const result = await facilitator.settle(payment);
    expect(result.ok).toBe(false);
    expect(await facilitator.getBalance("seller.testnet")).toBe(0n);
  });

  it("PY-19: settlement is blocked while the relayer has no gas", async () => {
    await registerPayer();
    const payment = validPayment();
    await facilitator.verify(payment, buildQuote());
    await facilitator.setRelayerHasGas(false);
    const result = await facilitator.settle(payment);
    expect(result.ok).toBe(false);
    expect(await facilitator.getBalance("seller.testnet")).toBe(0n);
  });

  it("PY-20: verification compares against an absolute validUntil timestamp, unaffected by a couple minutes of clock skew", async () => {
    await registerPayer();
    const payment = validPayment({ validUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    const result = await facilitator.verify(payment, buildQuote());
    expect(result.ok).toBe(true);
  });
});
