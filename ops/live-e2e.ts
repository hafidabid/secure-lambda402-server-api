/**
 * Live end-to-end run against the real services, driven only through the public HTTP API.
 *
 * Needs a running API + worker (ops/live-e2e.sh starts everything), then does a full paid run:
 *   seller creates a listing and uploads a sealed dataset  ->  buyer uploads a sealed model
 *   -> buyer pays with a real NEP-366 delegate on NEAR testnet -> worker scores it with the real
 *   Rust evaluator -> relayer settles on-chain -> receipt.
 *
 * It then checks the results independently instead of trusting the API's own word:
 *   - metrics recomputed here in TypeScript match the evaluator's,
 *   - the seller's real on-chain balance went up by exactly the price (once, not twice),
 *   - the object stored in R2 is ciphertext, not the CSV,
 *   - a forged payment is refused and a replayed payment does not charge twice.
 *
 * Prints only account ids, hashes and balances. Never keys.
 */
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { BuyerAgentClient, createNearLogin, createNearPaymentSigner } from "@securelambda/agent-sdk";
import { NearRpcReader, ensureRegisteredOnToken, randomNearPrivateKey, signDelegatePayment, signNep413, unwrapNear } from "@securelambda/facilitator";
import { EvaluatorMetadataSchema, type SignedPayment } from "@securelambda/schemas";
import { createChecks, expectedMetrics, fmtNear as fmt, makeApi, makeData, publishSealedListing, uploadSealedModel } from "./e2e-kit";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const API = process.env.API_URL ?? "http://localhost:3000";
const NEAR_KEY = env("NEAR_ACCOUNT_PRIVATE_KEY");
const SELLER = env("SEED_SELLER_ID");
const BUYER = env("SEED_BUYER_ID");
const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const TOKEN = env("PAYMENT_TOKEN_CONTRACT"); // wNEAR: native NEAR cannot be pulled from a buyer by a relayer
const RELAYER = env("RELAYER_ACCOUNT");
const PRICE = 10n ** 22n; // 0.01 NEAR (wNEAR has the same 24 decimals)
const near = new NearRpcReader(RPC);

// One real NEP-413 login per account, reused. All three accounts accept the same full-access key.
const logins = new Map<string, () => Promise<Record<string, string>>>();
const loginFor = (account: string) => {
  if (!logins.has(account)) logins.set(account, createNearLogin({ baseUrl: API, accountId: account, privateKey: NEAR_KEY }));
  return logins.get(account)!;
};
const api = makeApi(API, (account) => loginFor(account)());
const { check, step, passed } = createChecks();

async function sellerTokenAfterSettle(before: bigint, expectedDelta: bigint): Promise<bigint> {
  // "final" finality can trail the transaction by a couple of blocks.
  let now = before;
  for (let i = 0; i < 30 && now - before !== expectedDelta; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    now = await near.getTokenBalance(TOKEN, SELLER);
  }
  return now;
}

async function main() {
  console.log(`SecureLambda live E2E  api=${API}  seller=${SELLER}  buyer=${BUYER}`);

  step("0. Onboarding: the seller registers on the token contract (NEP-145, one time)");
  await ensureRegisteredOnToken({ rpcUrl: RPC, networkId: "testnet", accountId: SELLER, privateKey: NEAR_KEY }, TOKEN);
  check(`${SELLER} can receive ${TOKEN}`, await near.isRegisteredOnToken(TOKEN, SELLER));

  step("1. Service is up and exposes the evaluator");
  const evaluator = EvaluatorMetadataSchema.parse((await api("/evaluator")).body);
  check("GET /v1/evaluator returns version + public key", !!evaluator.public_key && !!evaluator.wasm_hash, `v${evaluator.version}`);

  step("2. Seller creates, seals and publishes a listing");
  const rows = makeData(240);
  const { listingId, sealedBlob } = await publishSealedListing(api, check, { seller: SELLER, evaluator, rows, price: PRICE, namePrefix: "live-e2e" });

  step("3. Ciphertext really is ciphertext in Cloudflare R2");
  const s3 = new S3Client({
    endpoint: env("STORAGE_ENDPOINT"),
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: env("STORAGE_ACCESS_KEY"), secretAccessKey: env("STORAGE_SECRET_KEY") },
  });
  const prefix = process.env.STORAGE_KEY_PREFIX ? `${process.env.STORAGE_KEY_PREFIX.replace(/\/+$/, "")}/` : "";
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: env("STORAGE_BUCKET"), Prefix: prefix }));
  const keys = (listed.Contents ?? []).map((o) => o.Key!);
  check("objects were written under the configured prefix", keys.length >= 1, `${keys.length} object(s) under "${prefix}"`);
  const obj = await s3.send(new GetObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: keys[0]! }));
  const stored = Buffer.from(await obj.Body!.transformToByteArray());
  check("stored bytes equal the sealed blob", stored.equals(sealedBlob));
  check("stored bytes do not contain the plaintext CSV header", !stored.includes(Buffer.from("age,glucose")));

  step("4. Buyer uploads a sealed model");
  const modelId = await uploadSealedModel(api, check, { buyer: BUYER, listingId, evaluator });

  step("5. Pay-per-run with a real NEAR payment");
  const first = await api(`/listings/${listingId}/evaluate`, {
    method: "POST",
    account: BUYER,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model_id: modelId }),
  });
  check("unpaid request gets an x402 quote (HTTP 402)", first.status === 402, `${first.body?.accepts?.[0]?.network}, ${fmt(BigInt(first.body?.accepts?.[0]?.maxAmountRequired ?? 0))}`);

  // Forged payment: signed by a key that is NOT on the buyer account.
  const quote = first.body.accepts[0];
  const forged = signDelegatePayment({
    payerId: BUYER,
    privateKey: randomNearPrivateKey(),
    quote,
    accessKeyNonce: 0n,
    currentBlockHeight: await near.getBlockHeight(),
    ttlBlocks: 600,
  });
  const forgedRes = await api(`/listings/${listingId}/evaluate`, {
    method: "POST",
    account: BUYER,
    headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(forged)).toString("base64") },
    body: JSON.stringify({ model_id: modelId }),
  });
  check("forged payment (stranger's key) is refused", forgedRes.status === 402 && JSON.stringify(forgedRes.body).includes("PAYMENT_INVALID"), `HTTP ${forgedRes.status}`);

  // Start the buyer with no wNEAR so the SDK's automatic NEAR -> wNEAR wrap really runs.
  const leftover = await near.getTokenBalance(TOKEN, BUYER);
  if (leftover > 0n) await unwrapNear({ rpcUrl: RPC, networkId: "testnet", accountId: BUYER, privateKey: NEAR_KEY }, TOKEN, leftover);
  check("buyer starts with zero wNEAR (only native NEAR)", (await near.getTokenBalance(TOKEN, BUYER)) === 0n);

  const sellerBefore = await near.getTokenBalance(TOKEN, SELLER);
  await new Promise((r) => setTimeout(r, 8000)); // let "final" finality catch up with the unwrap before taking baselines
  const buyerTokenBefore = await near.getTokenBalance(TOKEN, BUYER);
  const buyerNativeBefore = await near.getBalance(BUYER);
  const relayerNativeBefore = await near.getBalance(RELAYER);
  let sentPayment: SignedPayment | undefined;
  const realSigner = createNearPaymentSigner({ accountId: BUYER, privateKey: NEAR_KEY, rpcUrl: RPC, autoWrapNear: true });
  const agent = new BuyerAgentClient({
    baseUrl: API,
    signer: async (q) => (sentPayment = await realSigner(q)),
    headers: loginFor(BUYER),
    pollIntervalMs: 1500,
    // A run inside OutLayer's TEE takes about 2 minutes and may be retried once after a transient failure.
    pollTimeoutMs: process.env.EVALUATOR_MODE === "outlayer" ? 720_000 : 240_000,
  });
  const t0 = Date.now();
  const result = await agent.evaluate(listingId, modelId);
  console.log(`  paid run finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, run ${result.run_id}`);
  check("run returned a result", !!result.result?.metrics, JSON.stringify(result.result.metrics));
  if (process.env.EVALUATOR_MODE === "outlayer") {
    check("run executed in the OutLayer enclave and the wasm hash matched", result.mode === "enclave" && result.receipt.attested === true, `mode=${result.mode} wasm_hash=${String(result.receipt.wasm_hash).slice(0, 12)}…`);
  } else {
    check("run is honestly labelled local, not attested", result.mode === "local" && result.receipt.attested === false, `mode=${result.mode}`);
  }

  step("6. Verify the result independently");
  const exp = expectedMetrics(rows);
  const got = result.result.metrics as Record<string, number>;
  for (const k of ["accuracy", "auc", "f1"] as const) {
    check(`${k} matches an independent TypeScript computation`, Math.abs(got[k]! - exp[k]) <= 0.0101, `evaluator ${got[k]} vs local ${exp[k].toFixed(4)}`);
  }
  check("row count is only revealed as a bucket", typeof result.result.n_bucket === "string", String(result.result.n_bucket));

  step("7. The payment really moved on NEAR testnet");
  const receipt = (await api(`/runs/${result.run_id}/receipt`, { account: BUYER })).body;
  check("receipt carries a settle transaction hash", !!receipt.settle_tx && !receipt.settle_tx.startsWith("sandbox_"), receipt.settle_tx);
  console.log(`  explorer: https://explorer.testnet.near.org/transactions/${receipt.settle_tx}`);
  const sellerAfter = await sellerTokenAfterSettle(sellerBefore, PRICE);
  check("seller received exactly the price in wNEAR", sellerAfter - sellerBefore === PRICE, `${fmt(sellerBefore)} -> ${fmt(sellerAfter)}`);
  const buyerTokenAfter = await near.getTokenBalance(TOKEN, BUYER);
  const expectedLeft = buyerTokenBefore >= PRICE ? buyerTokenBefore - PRICE : 0n;
  check("the buyer's wNEAR paid for it (nothing left over)", buyerTokenAfter === expectedLeft, `wNEAR ${fmt(buyerTokenBefore)} -> auto-wrapped -> ${fmt(buyerTokenAfter)}`);
  const buyerNativeAfter = await near.getBalance(BUYER);
  const buyerNativeSpent = buyerNativeBefore - buyerNativeAfter;
  check("the buyer's own NEAR funded it, via the automatic wrap", buyerNativeSpent >= PRICE && buyerNativeSpent < PRICE + 5n * 10n ** 21n, `native ${fmt(buyerNativeBefore)} -> ${fmt(buyerNativeAfter)}`);
  const relayerNativeAfter = await near.getBalance(RELAYER);
  const relayerSpent = relayerNativeBefore - relayerNativeAfter;
  check("the relayer did NOT fund the payment (gas only)", relayerSpent >= 0n && relayerSpent < PRICE / 2n, `relayer spent ${fmt(relayerSpent)} of NEAR on gas`);

  step("8. Replaying the same payment does not charge twice");
  const replay = await api(`/listings/${listingId}/evaluate`, {
    method: "POST",
    account: BUYER,
    headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(sentPayment)).toString("base64") },
    body: JSON.stringify({ model_id: modelId }),
  });
  check("replay returns the same run", replay.body.run_id === result.run_id, `HTTP ${replay.status}`);
  await new Promise((r) => setTimeout(r, 6000));
  const sellerFinal = await near.getTokenBalance(TOKEN, SELLER);
  check("seller balance did not change on replay", sellerFinal === sellerAfter);

  step("9. Login is real: identity cannot be typed in");
  const evalUrl = `/listings/${listingId}/evaluate`;
  const evalBody = JSON.stringify({ model_id: modelId });
  const jsonHeader = { "content-type": "application/json" };
  const spoofedBuyer = await api(evalUrl, { method: "POST", headers: jsonHeader, body: evalBody, spoofAccountHeader: BUYER });
  check("evaluate with only an x-account-id header is refused (401)", spoofedBuyer.status === 401, spoofedBuyer.body?.error?.code);
  const spoofedSeller = await api("/listings", { method: "POST", headers: jsonHeader, body: "{}", spoofAccountHeader: SELLER });
  check("a seller route with only an x-account-id header is refused (401)", spoofedSeller.status === 401, spoofedSeller.body?.error?.code);
  const anon = await api(`/runs/${result.run_id}`);
  check("reading a run with no login is refused (401)", anon.status === 401);
  const forgedToken = await api(`/runs/${result.run_id}`, { headers: { authorization: "Bearer not-a-real-session" } });
  check("a made-up bearer token is refused (401)", forgedToken.status === 401, forgedToken.body?.error?.code);
  const otherReader = await api(`/runs/${result.run_id}`, { account: SELLER });
  check("another logged-in account cannot read the buyer's run (404)", otherReader.status === 404);
  const owner = await api(`/runs/${result.run_id}`, { account: BUYER });
  check("the buyer can read their own run", owner.status === 200 && owner.body.id === result.run_id);
  const ch = await api("/auth/challenge", { method: "POST", headers: jsonHeader, body: JSON.stringify({ account_id: BUYER }) });
  const wrongKey = signNep413(randomNearPrivateKey(), { message: ch.body.message, nonce: Buffer.from(ch.body.nonce, "base64"), recipient: ch.body.recipient });
  const badLogin = await api("/auth/login", {
    method: "POST",
    headers: jsonHeader,
    body: JSON.stringify({ account_id: BUYER, public_key: wrongKey.publicKey, signature: wrongKey.signature, nonce: ch.body.nonce }),
  });
  check("login with a key that is not on the account is refused (401)", badLogin.status === 401, badLogin.body?.error?.message);

  if (!process.env.KEEP_OBJECTS) {
    // The prefix is unique to this run, so this only removes what this run uploaded.
    const mine = await s3.send(new ListObjectsV2Command({ Bucket: env("STORAGE_BUCKET"), Prefix: prefix }));
    const toDelete = (mine.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (prefix && toDelete.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: env("STORAGE_BUCKET"), Delete: { Objects: toDelete } }));
      console.log(`  cleaned up ${toDelete.length} R2 object(s) under "${prefix}"`);
    }
  }

  console.log(`\nALL ${passed()} CHECKS PASSED`);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
