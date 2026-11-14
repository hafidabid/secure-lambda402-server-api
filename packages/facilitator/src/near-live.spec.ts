import { randomUUID } from "node:crypto";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import Redis from "ioredis";
import { KeyPair, KeyType, PublicKey } from "@near-js/crypto";
import { buildQuote } from "./test-helpers";
import { NearRpcChain } from "./near-chain";
import { NearFacilitator } from "./near-facilitator";
import { signDelegatePayment } from "./near-delegate";
import { ensureRegisteredOnToken, wrapNear } from "./near-token";

/**
 * Live NEAR testnet test. Skipped unless NEAR_ACCOUNT_PRIVATE_KEY is set, because it
 * spends real (testnet) NEAR. Run it with:  set -a; . ./secret; set +a; npx jest near-live
 *
 * Accounts: the relayer is the key's own account; buyer and seller are sub-accounts that
 * share the same key. Override with NEAR_RELAYER_ACCOUNT / NEAR_BUYER_ACCOUNT / NEAR_SELLER_ACCOUNT.
 */
const privateKey = process.env.NEAR_ACCOUNT_PRIVATE_KEY;
const relayerId = process.env.NEAR_RELAYER_ACCOUNT ?? "irjenpro.testnet";
const buyerId = process.env.NEAR_BUYER_ACCOUNT ?? `buyer.${relayerId}`;
const sellerId = process.env.NEAR_SELLER_ACCOUNT ?? `seller.${relayerId}`;
const TOKEN = process.env.PAYMENT_TOKEN_CONTRACT ?? "wrap.testnet";
const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const PRICE = 10n ** 22n; // 0.01 wNEAR

const maybe = privateKey ? describe : describe.skip;

maybe("NearFacilitator on NEAR testnet (live)", () => {
  jest.setTimeout(120_000);
  let container: StartedTestContainer;
  let redis: Redis;
  let chain: NearRpcChain;
  let facilitator: NearFacilitator;

  beforeAll(async () => {
    container = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379) });
    chain = new NearRpcChain({
      rpcUrl: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
      networkId: "testnet",
      relayerAccountId: relayerId,
      relayerPrivateKey: privateKey!,
    });
    facilitator = new NearFacilitator(redis, chain, [TOKEN], `near-live-${randomUUID()}`);

    // One-time setup a real seller/buyer would do: seller registers, buyer holds some wNEAR.
    const access = (accountId: string) => ({ rpcUrl: RPC, networkId: "testnet", accountId, privateKey: privateKey! });
    await ensureRegisteredOnToken(access(sellerId), TOKEN);
    const have = await chain.getTokenBalance(TOKEN, buyerId);
    if (have < PRICE * 3n) await wrapNear(access(buyerId), TOKEN, PRICE * 3n - have);
  });
  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  async function signedPayment(quote = buildQuote({ maxAmountRequired: PRICE.toString(), payTo: sellerId, assetContract: TOKEN, nonce: `n_${randomUUID()}` })) {
    const kp = KeyPair.fromString(privateKey as `ed25519:${string}`);
    const key = new PublicKey({ keyType: KeyType.ED25519, data: kp.getPublicKey().ed25519Key!.data }).toString();
    const nonce = await chain.getAccessKeyNonce(buyerId, key);
    expect(nonce).not.toBeNull();
    return {
      quote,
      payment: signDelegatePayment({
        payerId: buyerId,
        privateKey: privateKey!,
        quote,
        accessKeyNonce: nonce!,
        currentBlockHeight: await chain.getBlockHeight(),
        ttlBlocks: 600,
      }),
    };
  }

  it("verifies against real chain state, then settles with a real transaction", async () => {
    const { quote, payment } = await signedPayment();
    expect(await facilitator.verify(payment, quote)).toEqual({ ok: true });

    const sellerBefore = await chain.getTokenBalance(TOKEN, sellerId);
    const buyerBefore = await chain.getTokenBalance(TOKEN, buyerId);
    const relayerBefore = await chain.getBalance(relayerId);
    const settled = await facilitator.settle(payment);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    // eslint-disable-next-line no-console
    console.log(`settled on testnet: https://explorer.testnet.near.org/transactions/${settled.settleTxHash}`);

    // "final" finality can trail the tx by a couple of blocks, so poll briefly.
    let sellerAfter = sellerBefore;
    for (let i = 0; i < 15 && sellerAfter === sellerBefore; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      sellerAfter = await chain.getTokenBalance(TOKEN, sellerId);
    }
    expect(sellerAfter - sellerBefore).toBe(PRICE);
    // The buyer's token balance paid, and the relayer only paid gas (this is what a native Transfer got wrong).
    expect(buyerBefore - (await chain.getTokenBalance(TOKEN, buyerId))).toBe(PRICE);
    expect(relayerBefore - (await chain.getBalance(relayerId))).toBeLessThan(PRICE / 2n);

    // Settling again is idempotent: same hash, no second transfer.
    expect(await facilitator.settle(payment)).toEqual(settled);
  });

  it("rejects a delegate signed for a key that is not on the payer account", async () => {
    const { quote, payment } = await signedPayment();
    const stranger = KeyPair.fromRandom("ed25519");
    const forged = signDelegatePayment({
      payerId: buyerId,
      privateKey: stranger.toString(),
      quote,
      accessKeyNonce: 0n,
      currentBlockHeight: await chain.getBlockHeight(),
      ttlBlocks: 600,
    });
    expect(payment.payerId).toBe(forged.payerId);
    expect(await facilitator.verify(forged, quote)).toMatchObject({ ok: false, reason: expect.stringContaining("access key") });
  });

  it("rejects a payer that cannot afford the price", async () => {
    const quote = buildQuote({ maxAmountRequired: (10n ** 30n).toString(), payTo: sellerId, assetContract: TOKEN, nonce: `n_${randomUUID()}` });
    const { payment } = await signedPayment(quote);
    expect(await facilitator.verify(payment, quote)).toMatchObject({ ok: false, reason: "insufficient balance" });
  });
});
