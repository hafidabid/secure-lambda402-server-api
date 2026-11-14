import { Decimal } from "@prisma/client/runtime/library";
import { ApiError } from "@securelambda/schemas";
import { GatewayService } from "./gateway.service";
import { generatePayerKeypair, signPayment } from "@securelambda/facilitator";

function buildConfig(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    RATE_LIMIT_PER_IP_PER_MINUTE: 60,
    PAYMENT_VALID_MINUTES: 15,
    NEAR_NETWORK: "testnet",
  };
  return { get: jest.fn((key: string) => (key in overrides ? overrides[key] : defaults[key])) };
}

function buildRedis() {
  const store = new Map<string, string>();
  return {
    client: {
      incr: jest.fn(async (key: string) => {
        const next = Number(store.get(key) ?? "0") + 1;
        store.set(key, String(next));
        return next;
      }),
      expire: jest.fn(async () => 1),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
    },
  };
}

const LISTING = {
  id: "lst_1",
  sellerId: "seller.testnet",
  priceAmount: new Decimal("1000"), // a real Prisma Decimal, as the database returns it
  priceAsset: "near",
  status: "published",
  rulesJson: { runs_per_day: 20, lifetime_budget: 200 },
};

const MODEL = { id: "mdl_1", listingId: "lst_1" };

describe("GatewayService.evaluate", () => {
  let prisma: any;
  let redis: ReturnType<typeof buildRedis>;
  let config: ReturnType<typeof buildConfig>;
  let facilitator: { verify: jest.Mock; settle: jest.Mock };
  let queue: { add: jest.Mock };
  let service: GatewayService;
  let payer: ReturnType<typeof generatePayerKeypair>;

  beforeEach(() => {
    prisma = {
      listing: { findUnique: jest.fn(async () => LISTING) },
      model: { findUnique: jest.fn(async () => MODEL) },
      run: { count: jest.fn(async () => 0), findUnique: jest.fn(async () => null), create: jest.fn() },
      payment: { create: jest.fn(), findUnique: jest.fn(async () => null) },
      attestation: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    redis = buildRedis();
    config = buildConfig();
    facilitator = { verify: jest.fn(async () => ({ ok: true })), settle: jest.fn() };
    queue = { add: jest.fn(async () => undefined) };
    payer = generatePayerKeypair();
    service = new GatewayService(prisma, redis as any, config as any, facilitator, queue as any);
  });

  function signedPaymentFor(nonce: string, overrides: Record<string, unknown> = {}) {
    const unsigned = {
      nonce,
      payerId: "buyer.testnet",
      payerPublicKey: payer.publicKeyBase64,
      payTo: "seller.testnet",
      asset: "near" as const,
      amount: "1000",
      validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      maxBlockHeight: 10,
      ...overrides,
    };
    return signPayment(payer.privateKey, unsigned);
  }

  it("LISTING_NOT_FOUND when the listing does not exist", async () => {
    prisma.listing.findUnique.mockResolvedValueOnce(null);
    await expect(service.evaluate("lst_x", "buyer.testnet", "mdl_1", "1.2.3.4", undefined)).rejects.toMatchObject({
      code: "LISTING_NOT_FOUND",
    });
  });

  it("LISTING_NOT_PUBLISHED when the listing is a draft", async () => {
    prisma.listing.findUnique.mockResolvedValueOnce({ ...LISTING, status: "draft" });
    await expect(service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined)).rejects.toMatchObject({
      code: "LISTING_NOT_PUBLISHED",
    });
  });

  it("MODEL_BOUND_TO_OTHER_LISTING when the model belongs to a different listing", async () => {
    prisma.model.findUnique.mockResolvedValueOnce({ id: "mdl_1", listingId: "lst_other" });
    await expect(service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined)).rejects.toMatchObject({
      code: "MODEL_BOUND_TO_OTHER_LISTING",
    });
  });

  it("AP-14: more than the per-IP rate limit in one window is rejected as RATE_LIMITED", async () => {
    config = buildConfig({ RATE_LIMIT_PER_IP_PER_MINUTE: 2 });
    service = new GatewayService(prisma, redis as any, config as any, facilitator, queue as any);
    await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined);
    await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined);
    await expect(service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("AP-15 (runs-per-day): exceeding runs_per_day is rejected as RATE_LIMITED before any 402", async () => {
    prisma.run.count.mockImplementationOnce(async () => 20); // today's count
    await expect(service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(redis.client.set).not.toHaveBeenCalled(); // no quote was issued
  });

  it("AP-15 (lifetime budget): exceeding lifetime_budget is rejected as BUDGET_EXHAUSTED before any 402", async () => {
    prisma.run.count.mockImplementationOnce(async () => 0); // today
    prisma.run.count.mockImplementationOnce(async () => 200); // lifetime
    await expect(service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined)).rejects.toMatchObject({
      code: "BUDGET_EXHAUSTED",
    });
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it("PY-01: without a payment header, returns a 402 quote with price, asset, payTo, nonce and validUntil", async () => {
    const result = await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined);
    expect(result.kind).toBe("quote");
    if (result.kind === "quote") {
      const accept = result.quote.accepts[0]!;
      expect(accept.maxAmountRequired).toBe("1000");
      expect(accept.payTo).toBe("seller.testnet");
      expect(accept.nonce).toBeDefined();
      expect(accept.validUntil).toBeDefined();
    }
  });

  it("PY-01b: a realistic NEAR price (0.01 NEAR = 10^22 yocto) is quoted as a plain integer, not \"1e+22\"", async () => {
    // Regression: Decimal.toString() switches to exponent notation for large values, which is not a valid amount.
    prisma.listing.findUnique.mockResolvedValue({ ...LISTING, priceAmount: new Decimal("10000000000000000000000") });
    const result = await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined);
    expect(result.kind === "quote" && result.quote.accepts[0]!.maxAmountRequired).toBe("10000000000000000000000");
  });

  it("PAYMENT_INVALID when the X-Payment nonce does not match any cached quote", async () => {
    const payment = signedPaymentFor("n_unknown");
    const header = Buffer.from(JSON.stringify(payment)).toString("base64");
    await expect(service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", header)).rejects.toMatchObject({
      code: "PAYMENT_INVALID",
    });
  });

  it("PY-12: a payment quoted for a different resource (listing) is rejected as PAYMENT_INVALID", async () => {
    const quoteResult = await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined);
    const nonce = quoteResult.kind === "quote" ? quoteResult.quote.accepts[0]!.nonce : "";
    // Tamper the cached quote's resource to simulate it having been issued for a different listing.
    const raw = await redis.client.get(`quote:${nonce}`);
    const tampered = { ...JSON.parse(raw!), resource: "/v1/listings/lst_other/evaluate" };
    await redis.client.set(`quote:${nonce}`, JSON.stringify(tampered));

    const payment = signedPaymentFor(nonce);
    const header = Buffer.from(JSON.stringify(payment)).toString("base64");
    await expect(service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", header)).rejects.toMatchObject({
      code: "PAYMENT_INVALID",
    });
  });

  it("happy path: valid payment creates a run, enqueues it, and (with no worker running) falls back to 202 pending", async () => {
    const quoteResult = await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined);
    const nonce = quoteResult.kind === "quote" ? quoteResult.quote.accepts[0]!.nonce : "";
    const payment = signedPaymentFor(nonce);
    const header = Buffer.from(JSON.stringify(payment)).toString("base64");

    const result = await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", header);

    expect(facilitator.verify).toHaveBeenCalledWith(payment, expect.objectContaining({ nonce }));
    expect(prisma.run.create).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith("run", expect.objectContaining({ runId: expect.any(String) }), expect.anything());
    expect(result.kind).toBe("pending");
  }, 10_000);

  it("maps a facilitator PAYMENT_EXPIRED verify failure straight through", async () => {
    facilitator.verify.mockResolvedValueOnce({ ok: false, code: "PAYMENT_EXPIRED", reason: "too late" });
    const quoteResult = await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", undefined);
    const nonce = quoteResult.kind === "quote" ? quoteResult.quote.accepts[0]!.nonce : "";
    const payment = signedPaymentFor(nonce);
    const header = Buffer.from(JSON.stringify(payment)).toString("base64");
    await expect(service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", header)).rejects.toMatchObject({
      code: "PAYMENT_EXPIRED",
    });
  });

  it("PY-04: resubmitting the same nonce after a run already exists returns the existing run, never creating a second one", async () => {
    const existingRun = {
      id: "run_existing",
      state: "SETTLED",
      mode: "enclave",
      resultJson: { metrics: { accuracy: 0.9, auc: 0.9, f1: 0.9 }, n_bucket: "100-199" },
      execTxHash: "tx_1",
      errorCode: null,
      paymentNonce: "n_reused",
    };
    prisma.run.findUnique.mockImplementation(async ({ where }: { where: { id?: string; paymentNonce?: string } }) => {
      if (where.id === existingRun.id || where.paymentNonce === existingRun.paymentNonce) return existingRun;
      return null;
    });
    const payment = signedPaymentFor("n_reused");
    const header = Buffer.from(JSON.stringify(payment)).toString("base64");

    const result = await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", header);

    expect(prisma.run.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(result.kind).toBe("success");
  });

  describe("receipt on a settled run", () => {
    const settledRun = (mode: "enclave" | "local") => ({
      id: "run_receipt",
      state: "SETTLED",
      mode,
      resultJson: { metrics: { accuracy: 0.9, auc: 0.9, f1: 0.9 }, n_bucket: "100-199" },
      execTxHash: "tx_exec",
      errorCode: null,
      paymentNonce: "n_receipt",
    });
    const evaluateSettled = async (mode: "enclave" | "local") => {
      prisma.run.findUnique.mockImplementation(async () => settledRun(mode));
      prisma.payment.findUnique.mockResolvedValue({ settleTxHash: "SETTLE_HASH" });
      prisma.attestation.findUnique.mockResolvedValue({ wasmHash: "a".repeat(64), verified: true });
      const header = Buffer.from(JSON.stringify(signedPaymentFor("n_receipt"))).toString("base64");
      const result = await service.evaluate("lst_1", "buyer.testnet", "mdl_1", "1.2.3.4", header);
      if (result.kind !== "success") throw new Error("expected success");
      return result.body.receipt;
    };

    it("carries the real settle tx and wasm hash, and is attested only for a verified enclave run", async () => {
      expect(await evaluateSettled("enclave")).toEqual({ exec_tx: "tx_exec", settle_tx: "SETTLE_HASH", wasm_hash: "a".repeat(64), attested: true });
    });

    it("never reports a local (non-TEE) run as attested, even when the wasm hash matched", async () => {
      expect((await evaluateSettled("local")).attested).toBe(false);
    });
  });
});
