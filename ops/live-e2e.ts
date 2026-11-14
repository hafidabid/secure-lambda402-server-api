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
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { BuyerAgentClient, createNearPaymentSigner } from "@securelambda/agent-sdk";
import { sealFile } from "@securelambda/crypto";
import { NearRpcReader, ensureRegisteredOnToken, randomNearPrivateKey, signDelegatePayment, unwrapNear } from "@securelambda/facilitator";
import type { SignedPayment } from "@securelambda/schemas";

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

let passed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) throw new Error(`FAILED: ${label} ${detail}`);
  passed += 1;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}
const step = (title: string) => console.log(`\n== ${title}`);
const fmt = (yocto: bigint) => `${Number(yocto / 10n ** 20n) / 1e4} NEAR`;

async function api(path: string, init: RequestInit & { account?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.account) headers["x-account-id"] = init.account;
  const res = await fetch(`${API}/v1${path}`, { ...init, headers });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ---- tiny deterministic dataset + the model we will score it with ----
function makeData(n: number) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const rows: { age: number; glucose: number; y: 0 | 1 }[] = [];
  for (let i = 0; i < n; i++) {
    const age = 20 + Math.floor(rnd() * 60);
    const glucose = Math.round((70 + rnd() * 130) * 10) / 10;
    const score = (glucose - 120) / 25 + (age - 50) / 30 + (rnd() - 0.5) * 2.2;
    rows.push({ age, glucose, y: score > 0 ? 1 : 0 });
  }
  return rows;
}
const MODEL = { features: ["age", "glucose"], weights: [0.03, 0.04], bias: -6.2 };
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function expectedMetrics(rows: ReturnType<typeof makeData>) {
  const p = rows.map((r) => sigmoid(MODEL.weights[0]! * r.age + MODEL.weights[1]! * r.glucose + MODEL.bias));
  const pred = p.map((x) => (x >= 0.5 ? 1 : 0));
  const tp = rows.filter((r, i) => r.y === 1 && pred[i] === 1).length;
  const fp = rows.filter((r, i) => r.y === 0 && pred[i] === 1).length;
  const fn = rows.filter((r, i) => r.y === 1 && pred[i] === 0).length;
  const accuracy = rows.filter((r, i) => r.y === pred[i]).length / rows.length;
  const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  // AUC = P(score_pos > score_neg), ties count half.
  const pos = p.filter((_, i) => rows[i]!.y === 1);
  const neg = p.filter((_, i) => rows[i]!.y === 0);
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return { accuracy, auc: wins / (pos.length * neg.length), f1 };
}

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
  const evaluator = (await api("/evaluator")).body;
  check("GET /v1/evaluator returns version + public key", !!evaluator.public_key && !!evaluator.wasm_hash, `v${evaluator.version}`);
  const evPub = Buffer.from(evaluator.public_key, "base64");

  step("2. Seller creates, seals and publishes a listing");
  const rows = makeData(240);
  const csv = ["age,glucose,y", ...rows.map((r) => `${r.age},${r.glucose},${r.y}`)].join("\n") + "\n";
  const created = await api("/listings", {
    method: "POST",
    account: SELLER,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `live-e2e-${randomUUID().slice(0, 8)}`,
      schema: { task: "binary_classification", features: [{ name: "age", type: "int" }, { name: "glucose", type: "float" }], label: "y" },
      sample_rows: rows.slice(0, 5).map((r) => ({ age: r.age, glucose: r.glucose, y: r.y })),
      price_amount: PRICE.toString(),
      price_asset: "near",
      rules: { min_rows: 100, min_class_count: 20, round: 2, metrics: ["accuracy", "auc", "f1"], runs_per_day: 20, lifetime_budget: 100 },
      evaluator_version: evaluator.version,
    }),
  });
  check("listing created as draft", created.status === 201, `HTTP ${created.status} ${created.status !== 201 ? JSON.stringify(created.body) : ""}`);
  const listingId: string = created.body.id;

  const sealedData = sealFile(Buffer.from(csv), evPub, { listing: listingId, role: "dataset", ev: evaluator.version });
  const dsForm = new FormData();
  dsForm.set("ciphertext", new Blob([sealedData.blob]), "dataset.bin");
  dsForm.set("wrapped_key", JSON.stringify(sealedData.envelope));
  const dsUp = await api(`/listings/${listingId}/dataset`, { method: "POST", account: SELLER, body: dsForm });
  check("sealed dataset uploaded", dsUp.status === 201 || dsUp.status === 200, `HTTP ${dsUp.status} ${dsUp.status >= 300 ? JSON.stringify(dsUp.body) : ""}`);
  const published = await api(`/listings/${listingId}/publish`, { method: "POST", account: SELLER });
  check("listing published", published.status === 200 && published.body.status === "published", `HTTP ${published.status}`);

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
  check("stored bytes equal the sealed blob", stored.equals(sealedData.blob));
  check("stored bytes do not contain the plaintext CSV header", !stored.includes(Buffer.from("age,glucose")));

  step("4. Buyer uploads a sealed model");
  const sealedModel = sealFile(Buffer.from(JSON.stringify(MODEL)), evPub, { listing: listingId, role: "model", ev: evaluator.version });
  const mForm = new FormData();
  mForm.set("ciphertext", new Blob([sealedModel.blob]), "model.bin");
  mForm.set("wrapped_key", JSON.stringify(sealedModel.envelope));
  const mUp = await api(`/listings/${listingId}/models`, { method: "POST", account: BUYER, body: mForm });
  check("sealed model uploaded", mUp.status < 300, `HTTP ${mUp.status} ${mUp.status >= 300 ? JSON.stringify(mUp.body) : ""}`);
  const modelId: string = mUp.body.id ?? mUp.body.model_id;

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
    headers: { "x-account-id": BUYER },
    pollIntervalMs: 1500,
    pollTimeoutMs: 240_000,
  });
  const t0 = Date.now();
  const result = await agent.evaluate(listingId, modelId);
  console.log(`  paid run finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, run ${result.run_id}`);
  check("run returned a result", !!result.result?.metrics, JSON.stringify(result.result.metrics));
  check("run is honestly labelled local, not attested", result.mode === "local" && result.receipt.attested === false, `mode=${result.mode}`);

  step("6. Verify the result independently");
  const exp = expectedMetrics(rows);
  const got = result.result.metrics as Record<string, number>;
  for (const k of ["accuracy", "auc", "f1"] as const) {
    check(`${k} matches an independent TypeScript computation`, Math.abs(got[k]! - exp[k]) <= 0.0101, `evaluator ${got[k]} vs local ${exp[k].toFixed(4)}`);
  }
  check("row count is only revealed as a bucket", typeof result.result.n_bucket === "string", String(result.result.n_bucket));

  step("7. The payment really moved on NEAR testnet");
  const receipt = (await api(`/runs/${result.run_id}/receipt`)).body;
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

  if (!process.env.KEEP_OBJECTS) {
    // The prefix is unique to this run, so this only removes what this run uploaded.
    const mine = await s3.send(new ListObjectsV2Command({ Bucket: env("STORAGE_BUCKET"), Prefix: prefix }));
    const toDelete = (mine.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (prefix && toDelete.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: env("STORAGE_BUCKET"), Delete: { Objects: toDelete } }));
      console.log(`  cleaned up ${toDelete.length} R2 object(s) under "${prefix}"`);
    }
  }

  console.log(`\nALL ${passed} CHECKS PASSED`);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
