/**
 * Local paid run with no testnet account: real encryption, the real Rust evaluator and a real
 * ed25519-signed x402 payment, settled on the sandbox ledger in Redis instead of NEAR.
 * ops/demo.sh starts the stack this runs against.
 */
import { CreateBucketCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { BuyerAgentClient } from "@securelambda/agent-sdk";
import { SandboxFacilitator, generatePayerKeypair, signPayment } from "@securelambda/facilitator";
import { EvaluatorMetadataSchema, X402QuoteSchema, type SignedPayment, type X402Accept } from "@securelambda/schemas";
import Redis from "ioredis";
import { createChecks, expectedMetrics, fmtNear, makeApi, makeData, publishSealedListing, uploadSealedModel } from "./e2e-kit";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const API = env("API_URL");
const SELLER = env("SEED_SELLER_ID");
const BUYER = env("SEED_BUYER_ID");
const PRICE = 10n ** 22n;
const BUYER_FUNDS = 10n ** 24n;

const api = makeApi(API, async (account) => ({ "x-account-id": account }));
const { check, step, passed } = createChecks();

function payFor(quote: X402Accept, payerId: string, keys: ReturnType<typeof generatePayerKeypair>): SignedPayment {
  return signPayment(keys.privateKey, {
    nonce: quote.nonce,
    payerId,
    payerPublicKey: keys.publicKeyBase64,
    payTo: quote.payTo,
    asset: quote.asset,
    amount: quote.maxAmountRequired,
    validUntil: quote.validUntil,
    maxBlockHeight: 1,
  });
}

async function main() {
  console.log(`SecureLambda local demo  api=${API}  seller=${SELLER}  buyer=${BUYER}`);
  const redis = new Redis(env("REDIS_URL"));
  const ledger = new SandboxFacilitator(redis);
  const s3 = new S3Client({
    endpoint: env("STORAGE_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: env("STORAGE_ACCESS_KEY"), secretAccessKey: env("STORAGE_SECRET_KEY") },
  });
  await s3.send(new CreateBucketCommand({ Bucket: env("STORAGE_BUCKET") }));

  step("1. Service is up and exposes the evaluator");
  const evaluator = EvaluatorMetadataSchema.parse((await api("/evaluator")).body);
  check("GET /v1/evaluator returns version + public key", !!evaluator.public_key && evaluator.public_key !== Buffer.alloc(32).toString("base64"), `v${evaluator.version}`);

  step("2. The buyer gets a payment key and funds on the sandbox ledger");
  const buyerKeys = generatePayerKeypair();
  await ledger.registerAccountKey(BUYER, buyerKeys.publicKeyBase64);
  await ledger.setBalance(BUYER, BUYER_FUNDS);
  check("buyer key registered and funded", (await ledger.getBalance(BUYER)) === BUYER_FUNDS, fmtNear(BUYER_FUNDS));

  step("3. Seller encrypts the dataset in the client, uploads and publishes");
  const rows = makeData(240);
  const { listingId, sealedBlob } = await publishSealedListing(api, check, { seller: SELLER, evaluator, rows, price: PRICE, namePrefix: "demo" });

  step("4. Only ciphertext reaches storage");
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: env("STORAGE_BUCKET") }));
  const keys = (listed.Contents ?? []).map((o) => o.Key!);
  check("the dataset object is in MinIO", keys.length >= 1, `${keys.length} object(s)`);
  const obj = await s3.send(new GetObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: keys[0]! }));
  const stored = Buffer.from(await obj.Body!.transformToByteArray());
  check("stored bytes equal the sealed blob", stored.equals(sealedBlob));
  check("stored bytes do not contain the plaintext CSV header", !stored.includes(Buffer.from("age,glucose")));

  step("5. Buyer encrypts and uploads a model");
  const modelId = await uploadSealedModel(api, check, { buyer: BUYER, listingId, evaluator });

  step("6. Pay per run (x402)");
  const evaluate = (payment?: SignedPayment) =>
    api(`/listings/${listingId}/evaluate`, {
      method: "POST",
      account: BUYER,
      headers: { "content-type": "application/json", ...(payment && { "x-payment": Buffer.from(JSON.stringify(payment)).toString("base64") }) },
      body: JSON.stringify({ model_id: modelId }),
    });
  const first = await evaluate();
  check("unpaid request gets an x402 quote (HTTP 402)", first.status === 402, `HTTP ${first.status}`);
  const quote = X402QuoteSchema.parse(first.body).accepts[0]!;
  check("the quote asks for the listing price, paid to the seller", BigInt(quote.maxAmountRequired) === PRICE && quote.payTo === SELLER, `${fmtNear(PRICE)} to ${quote.payTo}`);

  const forged = await evaluate(payFor(quote, BUYER, generatePayerKeypair()));
  check("forged payment (a key not on the buyer account) is refused", forged.status === 402 && JSON.stringify(forged.body).includes("PAYMENT_INVALID"), `HTTP ${forged.status}`);

  const sellerBefore = await ledger.getBalance(SELLER);
  let sentPayment: SignedPayment | undefined;
  const agent = new BuyerAgentClient({
    baseUrl: API,
    signer: (q) => (sentPayment = payFor(q, BUYER, buyerKeys)),
    headers: { "x-account-id": BUYER },
    pollIntervalMs: 1000,
    pollTimeoutMs: 120_000,
  });
  const t0 = Date.now();
  const result = await agent.evaluate(listingId, modelId);
  console.log(`  paid run finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, run ${result.run_id}`);
  check("run returned a result", !!result.result?.metrics, JSON.stringify(result.result.metrics));
  check("run is honestly labelled local, not attested", result.mode === "local" && result.receipt.attested === false, `mode=${result.mode}`);

  step("7. Verify the result independently");
  const exp = expectedMetrics(rows);
  const got = result.result.metrics;
  for (const k of ["accuracy", "auc", "f1"] as const) {
    check(`${k} matches an independent TypeScript computation`, Math.abs((got[k] ?? NaN) - exp[k]) <= 0.0101, `evaluator ${got[k]} vs local ${exp[k].toFixed(4)}`);
  }
  check("row count is only revealed as a bucket", typeof result.result.n_bucket === "string", String(result.result.n_bucket));

  step("8. The payment settled to the seller, once");
  const sellerAfter = await ledger.getBalance(SELLER);
  check("seller received exactly the price", sellerAfter - sellerBefore === PRICE, `${fmtNear(sellerBefore)} -> ${fmtNear(sellerAfter)}`);
  check("buyer paid exactly the price", (await ledger.getBalance(BUYER)) === BUYER_FUNDS - PRICE);
  const replay = await evaluate(sentPayment);
  check("replaying the payment returns the same run", replay.body.run_id === result.run_id, `HTTP ${replay.status}`);
  check("seller balance did not change on replay", (await ledger.getBalance(SELLER)) === sellerAfter);

  await redis.quit();
  console.log(`\nALL ${passed()} CHECKS PASSED`);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
