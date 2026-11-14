import { randomUUID } from "node:crypto";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import Redis from "ioredis";
import { KeyPair } from "@near-js/crypto";
import type { SignedPayment, X402Accept } from "@securelambda/schemas";
import { buildQuote } from "./test-helpers";
import { RELAYER_MIN_BALANCE_YOCTO, type NearChain } from "./near-chain";
import { NearFacilitator } from "./near-facilitator";
import { signDelegatePayment } from "./near-delegate";

const NEAR = 10n ** 24n;
const TOKEN = "wrap.testnet";

class FakeChain implements NearChain {
  keyNonce: bigint | null = 5n;
  balance = 10n * NEAR; // the payer's token balance
  sellerRegistered = true;
  height = 1_000;
  relayer = 5n * NEAR;
  submitResult: { ok: true; txHash: string } | { ok: false; reason: string } = { ok: true, txHash: "TX_HASH_1" };
  submits = 0;

  async getAccessKeyNonce() {
    return this.keyNonce;
  }
  async getBalance() {
    return this.relayer;
  }
  async getTokenBalance() {
    return this.balance;
  }
  async isRegisteredOnToken() {
    return this.sellerRegistered;
  }
  async getBlockHeight() {
    return this.height;
  }
  async relayerBalance() {
    return this.relayer;
  }
  async submitDelegate() {
    this.submits += 1;
    return this.submitResult;
  }
}

describe("NearFacilitator (real NEP-366 ft_transfer delegates, fake chain)", () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let chain: FakeChain;
  let facilitator: NearFacilitator;
  let keyPair: ReturnType<typeof KeyPair.fromRandom>;
  let quote: X402Accept;

  beforeAll(async () => {
    container = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379) });
  });
  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  beforeEach(() => {
    chain = new FakeChain();
    facilitator = new NearFacilitator(redis, chain, [TOKEN], `near-test-${randomUUID()}`);
    keyPair = KeyPair.fromRandom("ed25519");
    quote = buildQuote({ maxAmountRequired: (NEAR / 10n).toString(), payTo: "seller.testnet", assetContract: TOKEN, nonce: `n_${randomUUID()}` });
  });

  function pay(overrides: { quote?: X402Accept; blocks?: number } = {}): SignedPayment {
    return signDelegatePayment({
      payerId: "buyer.testnet",
      privateKey: keyPair.toString(),
      quote: overrides.quote ?? quote,
      accessKeyNonce: 5n,
      currentBlockHeight: chain.height,
      ttlBlocks: overrides.blocks ?? 600,
    });
  }

  it("verifies a correctly signed delegate without submitting anything", async () => {
    expect(await facilitator.verify(pay(), quote)).toEqual({ ok: true });
    expect(chain.submits).toBe(0);
  });

  it("rejects a quote for a token contract the facilitator does not settle", async () => {
    const other = { ...quote, assetContract: "evil-token.testnet" };
    expect(await facilitator.verify(pay({ quote: other }), other)).toMatchObject({ ok: false, reason: expect.stringContaining("token contract") });
    const none = { ...quote, assetContract: undefined };
    expect(await facilitator.verify(pay(), none)).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
  });

  it("rejects a delegate that calls a different token contract than the quote", async () => {
    const forgedForOtherToken = pay({ quote: { ...quote, assetContract: "other.testnet" } });
    expect(await facilitator.verify(forgedForOtherToken, quote)).toMatchObject({ ok: false, reason: expect.stringContaining("quoted token contract") });
  });

  it("rejects a payment when the seller has not registered on the token contract", async () => {
    chain.sellerRegistered = false;
    expect(await facilitator.verify(pay(), quote)).toMatchObject({ ok: false, reason: expect.stringContaining("storage_deposit") });
  });

  it("rejects a payment below the quoted price", async () => {
    const cheap = pay({ quote: { ...quote, maxAmountRequired: "1" } });
    expect(await facilitator.verify(cheap, quote)).toMatchObject({ ok: false, code: "PAYMENT_INVALID", reason: expect.stringContaining("lower") });
  });

  it("rejects when the signed ft_transfer pays someone other than the quoted seller", async () => {
    const wrongSeller = pay({ quote: { ...quote, payTo: "evil.testnet" } });
    // JSON claims seller.testnet, but the signed bytes pay evil.testnet.
    const result = await facilitator.verify({ ...wrongSeller, payTo: "seller.testnet" }, quote);
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_INVALID", reason: expect.stringContaining("receiver") });
  });

  it("rejects when the JSON amount is changed after signing", async () => {
    const tampered = { ...pay(), amount: (NEAR / 5n).toString() };
    expect(await facilitator.verify(tampered, quote)).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
  });

  it("rejects a signature made by a different key than payerPublicKey claims", async () => {
    const mine = pay();
    const other = KeyPair.fromRandom("ed25519");
    const theirs = signDelegatePayment({ payerId: "buyer.testnet", privateKey: other.toString(), quote, accessKeyNonce: 5n, currentBlockHeight: chain.height, ttlBlocks: 600 });
    const forged = { ...mine, signedDelegate: theirs.signedDelegate };
    expect(await facilitator.verify(forged, quote)).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
  });

  it("rejects garbage in signedDelegate", async () => {
    expect(await facilitator.verify({ ...pay(), signedDelegate: Buffer.from("nope").toString("base64") }, quote)).toMatchObject({
      ok: false,
      code: "PAYMENT_INVALID",
    });
  });

  it("rejects a key that is not an access key of the payer", async () => {
    chain.keyNonce = null;
    expect(await facilitator.verify(pay(), quote)).toMatchObject({ ok: false, reason: expect.stringContaining("access key") });
  });

  it("rejects a delegate whose nonce is not above the key's current nonce", async () => {
    chain.keyNonce = 6n; // pay() signed nonce 6
    expect(await facilitator.verify(pay(), quote)).toMatchObject({ ok: false, reason: expect.stringContaining("nonce") });
  });

  it("rejects a delegate that expires too soon", async () => {
    expect(await facilitator.verify(pay({ blocks: 5 }), quote)).toMatchObject({ ok: false, code: "PAYMENT_EXPIRED" });
  });

  it("rejects when the payer cannot afford it", async () => {
    chain.balance = 1n;
    expect(await facilitator.verify(pay(), quote)).toMatchObject({ ok: false, reason: "insufficient balance" });
  });

  it("rejects an expired validUntil", async () => {
    const expired = { ...quote, validUntil: new Date(Date.now() - 1000).toISOString() };
    expect(await facilitator.verify(pay({ quote: expired }), expired)).toMatchObject({ ok: false, code: "PAYMENT_EXPIRED" });
  });

  it("treats a byte-identical replay as a no-op but rejects the same nonce with a different payment", async () => {
    const first = pay();
    expect(await facilitator.verify(first, quote)).toEqual({ ok: true });
    expect(await facilitator.verify(first, quote)).toEqual({ ok: true });
    const different = pay({ blocks: 700 });
    expect(await facilitator.verify(different, quote)).toMatchObject({ ok: false, code: "PAYMENT_REUSED" });
  });

  it("keeps accepting an already-accepted payment after its quote expires, so a late settle retry still works", async () => {
    const shortLived = { ...quote, validUntil: new Date(Date.now() + 400).toISOString() };
    const payment = pay({ quote: shortLived });
    expect(await facilitator.verify(payment, shortLived)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 500));
    expect(await facilitator.verify(payment, shortLived)).toEqual({ ok: true });
    // ...while a payment that was never accepted is still refused once expired.
    const never = { ...quote, nonce: `n_${randomUUID()}`, validUntil: new Date(Date.now() - 1).toISOString() };
    expect(await facilitator.verify(pay({ quote: never }), never)).toMatchObject({ ok: false, code: "PAYMENT_EXPIRED" });
  });

  it("settles once and returns the same tx hash on a retry without resubmitting", async () => {
    const payment = pay();
    await facilitator.verify(payment, quote);
    expect(await facilitator.settle(payment)).toEqual({ ok: true, settleTxHash: "TX_HASH_1" });
    expect(await facilitator.settle(payment)).toEqual({ ok: true, settleTxHash: "TX_HASH_1" });
    expect(chain.submits).toBe(1);
  });

  it("does not settle when the relayer is out of gas, then succeeds once refilled", async () => {
    const payment = pay();
    await facilitator.verify(payment, quote);
    chain.relayer = RELAYER_MIN_BALANCE_YOCTO - 1n;
    expect(await facilitator.settle(payment)).toEqual({ ok: false, reason: "relayer has no gas" });
    chain.relayer = 5n * NEAR;
    expect(await facilitator.settle(payment)).toMatchObject({ ok: true });
  });

  it("reports a failed submit and allows a retry afterwards", async () => {
    const payment = pay();
    await facilitator.verify(payment, quote);
    chain.submitResult = { ok: false, reason: "delegated transfer failed" };
    expect(await facilitator.settle(payment)).toEqual({ ok: false, reason: "delegated transfer failed" });
    chain.submitResult = { ok: true, txHash: "TX_HASH_2" };
    expect(await facilitator.settle(payment)).toEqual({ ok: true, settleTxHash: "TX_HASH_2" });
  });
});
