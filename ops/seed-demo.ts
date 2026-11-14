/**
 * Seeds a running SecureLambda API with a demo marketplace, through the public HTTP API only (so every row is
 * created exactly the way a real user would create it):
 *
 *   1. five sealed listings from two sellers (a hospital and a clinic), published,
 *   2. a few real paid runs from two buyers, each scored in the real evaluator and checked here against metrics
 *      computed independently in TypeScript.
 *
 * Safe to re-run: a listing whose name already exists is reused, and runs are only made for listings this
 * invocation created (or with FORCE_RUNS=1). Nothing is ever deleted.
 *
 *   API_URL=https://secure-lambda-api.projectdeadwood.my.id npx ts-node ops/seed-demo.ts
 *   DRY_RUN=1 npx ts-node ops/seed-demo.ts       # generate everything, print the plan, touch no network
 *   SEED_RUNS=0 ...                              # listings only, no paid runs
 *
 * Accounts (each needs a full-access key; the two sellers must be on the API's SELLER_ALLOW_LIST):
 *   DEMO_HOSPITAL / DEMO_CLINIC / DEMO_MEDAI / DEMO_PHARMALAB   default <name>.hafidbuild.testnet
 *   keys are read from DEMO_KEYS_DIR/<account>.json (default ~/.near-credentials/testnet, field "private_key"),
 *   or from NEAR_ACCOUNT_PRIVATE_KEY when one key controls all four.
 *
 * Prints only account ids, listing ids, hashes and metrics. Never keys.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BuyerAgentClient, createNearLogin, createNearPaymentSigner } from "@securelambda/agent-sdk";
import { sealFile } from "@securelambda/crypto";
import { NearRpcReader, ensureRegisteredOnToken } from "@securelambda/facilitator";
import { DEMO_LISTINGS, DEMO_RUNS, buildModel, expectedMetrics, generateDataset, nearToYocto } from "./demo-data";

const API = process.env.API_URL ?? "http://localhost:3000";
const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const TOKEN = process.env.PAYMENT_TOKEN_CONTRACT ?? "wrap.testnet";
const DRY_RUN = process.env.DRY_RUN === "1";
const MAKE_RUNS = process.env.SEED_RUNS !== "0";
const FORCE_RUNS = process.env.FORCE_RUNS === "1";
const KEYS_DIR = process.env.DEMO_KEYS_DIR ?? join(homedir(), ".near-credentials", "testnet");

const ACCOUNTS = {
  hospital: process.env.DEMO_HOSPITAL ?? "hospital.hafidbuild.testnet",
  clinic: process.env.DEMO_CLINIC ?? "clinic.hafidbuild.testnet",
  medai: process.env.DEMO_MEDAI ?? "medai.hafidbuild.testnet",
  pharmalab: process.env.DEMO_PHARMALAB ?? "pharmalab.hafidbuild.testnet",
} as const;
type Persona = keyof typeof ACCOUNTS;

function keyFor(account: string): string {
  const file = join(KEYS_DIR, `${account}.json`);
  if (existsSync(file)) {
    const key = (JSON.parse(readFileSync(file, "utf8")) as { private_key?: string }).private_key;
    if (key) return key;
  }
  const shared = process.env.NEAR_ACCOUNT_PRIVATE_KEY;
  if (shared) return shared;
  throw new Error(`no key for ${account}: expected ${file} or NEAR_ACCOUNT_PRIVATE_KEY`);
}

const near = new NearRpcReader(RPC);
const logins = new Map<string, () => Promise<Record<string, string>>>();
const loginFor = (account: string) => {
  if (!logins.has(account)) logins.set(account, createNearLogin({ baseUrl: API, accountId: account, privateKey: keyFor(account) }));
  return logins.get(account)!;
};

async function api(path: string, init: RequestInit & { account?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.account) Object.assign(headers, await loginFor(init.account)());
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

function fail(message: string): never {
  throw new Error(message);
}
const step = (title: string) => console.log(`\n== ${title}`);
const near4 = (yocto: bigint) => `${Number(yocto / 10n ** 20n) / 1e4} NEAR`;

interface Created {
  id: string;
  fresh: boolean;
}

async function main() {
  console.log(`SecureLambda demo seed  api=${API}${DRY_RUN ? "  (DRY RUN: nothing is sent)" : ""}`);
  const datasets = Object.fromEntries(DEMO_LISTINGS.map((s) => [s.key, generateDataset(s)]));

  if (DRY_RUN) {
    step("Plan");
    for (const s of DEMO_LISTINGS) {
      const d = datasets[s.key]!;
      console.log(`  listing  ${s.name.padEnd(36)} ${ACCOUNTS[s.seller]}  ${s.priceNear} NEAR  ${d.rows.length} rows, ${d.csv.length} bytes`);
    }
    for (const r of DEMO_RUNS) {
      const s = DEMO_LISTINGS.find((l) => l.key === r.listing)!;
      const m = expectedMetrics(s, datasets[s.key]!, buildModel(s, datasets[s.key]!, r.model));
      console.log(`  run      ${ACCOUNTS[r.buyer]} -> ${s.name}  (${r.model} model, expect accuracy ${m.accuracy.toFixed(2)}, auc ${m.auc.toFixed(2)})`);
    }
    return;
  }

  step("1. The service and its evaluator");
  const health = (await fetch(`${API}/healthz`).then((r) => r.json()).catch(() => null)) as { ok?: boolean } | null;
  if (!health?.ok) fail(`${API}/healthz did not answer ok`);
  const evaluator = (await api("/evaluator")).body;
  if (!evaluator?.public_key) fail("GET /v1/evaluator returned no public key");
  const evPub = Buffer.from(evaluator.public_key, "base64");
  console.log(`  evaluator v${evaluator.version}  project ${evaluator.project_id}  wasm ${String(evaluator.wasm_hash).slice(0, 16)}…`);

  step("2. Listings");
  const listings = new Map<string, Created>();
  for (const s of DEMO_LISTINGS) {
    const seller = ACCOUNTS[s.seller];
    const data = datasets[s.key]!;

    const existing = await api(`/listings?q=${encodeURIComponent(s.name)}&limit=100`, { account: seller });
    const match = (existing.body?.items ?? []).find((l: { name: string }) => l.name === s.name);
    if (match) {
      listings.set(s.key, { id: match.id, fresh: false });
      console.log(`  = ${s.name}  already listed (${match.id}), reused`);
      continue;
    }

    await ensureRegisteredOnToken({ rpcUrl: RPC, networkId: "testnet", accountId: seller, privateKey: keyFor(seller) }, TOKEN);
    const created = await api("/listings", {
      method: "POST",
      account: seller,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: s.name,
        schema: { task: "binary_classification", features: s.features.map((f) => ({ name: f.name, type: f.type })), label: s.label },
        sample_rows: data.rows.slice(0, 5),
        price_amount: nearToYocto(s.priceNear),
        price_asset: "near",
        rules: { ...s.rules, round: 2, metrics: ["accuracy", "auc", "f1"] },
        evaluator_version: evaluator.version,
      }),
    });
    if (created.status !== 201) fail(`create "${s.name}" as ${seller}: HTTP ${created.status} ${JSON.stringify(created.body)}`);
    const id: string = created.body.id;

    const sealed = sealFile(Buffer.from(data.csv), evPub, { listing: id, role: "dataset", ev: evaluator.version });
    const form = new FormData();
    form.set("ciphertext", new Blob([sealed.blob]), "dataset.bin");
    form.set("wrapped_key", JSON.stringify(sealed.envelope));
    const up = await api(`/listings/${id}/dataset`, { method: "POST", account: seller, body: form });
    if (up.status !== 200 && up.status !== 201) fail(`dataset upload for ${id}: HTTP ${up.status} ${JSON.stringify(up.body)}`);

    const pub = await api(`/listings/${id}/publish`, { method: "POST", account: seller });
    if (pub.status !== 200 || pub.body.status !== "published") fail(`publish ${id}: HTTP ${pub.status} ${JSON.stringify(pub.body)}`);
    listings.set(s.key, { id, fresh: true });
    console.log(`  + ${s.name}  ${id}  ${s.priceNear} NEAR  by ${seller}`);
  }

  const failures: string[] = [];
  if (MAKE_RUNS) {
    step("3. Paid runs (each takes about 1-2 minutes in the enclave, one after another)");
    for (const r of DEMO_RUNS) {
      const s = DEMO_LISTINGS.find((l) => l.key === r.listing)!;
      const listing = listings.get(s.key)!;
      if (!listing.fresh && !FORCE_RUNS) {
        console.log(`  - skip ${ACCOUNTS[r.buyer]} -> ${s.name}: listing already existed (FORCE_RUNS=1 to run anyway)`);
        continue;
      }
      const buyer = ACCOUNTS[r.buyer];
      const data = datasets[s.key]!;
      const model = buildModel(s, data, r.model);
      const expected = expectedMetrics(s, data, model);
      console.log(`  > ${buyer} -> ${s.name}  (${r.model} model)  ${r.why}`);

      try {
        const sealed = sealFile(Buffer.from(JSON.stringify(model)), evPub, { listing: listing.id, role: "model", ev: evaluator.version });
        const form = new FormData();
        form.set("ciphertext", new Blob([sealed.blob]), "model.bin");
        form.set("wrapped_key", JSON.stringify(sealed.envelope));
        const up = await api(`/listings/${listing.id}/models`, { method: "POST", account: buyer, body: form });
        if (up.status >= 300) fail(`model upload: HTTP ${up.status} ${JSON.stringify(up.body)}`);
        const modelId: string = up.body.id ?? up.body.model_id;

        const before = await near.getBalance(buyer);
        const agent = new BuyerAgentClient({
          baseUrl: API,
          signer: createNearPaymentSigner({ accountId: buyer, privateKey: keyFor(buyer), rpcUrl: RPC, autoWrapNear: true }),
          headers: loginFor(buyer),
          pollIntervalMs: 2000,
          pollTimeoutMs: 720_000,
        });
        const t0 = Date.now();
        // Testnet "final" finality sometimes lags a few seconds behind the wrap of the buyer's NEAR. That error is raised
        // before any payment is signed, so retrying is safe; any other failure is reported as it is.
        let result: Awaited<ReturnType<typeof agent.evaluate>> | undefined;
        for (let attempt = 1; !result; attempt++) {
          try {
            result = await agent.evaluate(listing.id, modelId);
          } catch (err) {
            if (attempt >= 3 || !/wrapped NEAR/i.test((err as Error).message)) throw err;
            console.log(`    wrap not final yet (attempt ${attempt}), waiting 20s and retrying`);
            await new Promise((resolve) => setTimeout(resolve, 20_000));
          }
        }
        const metrics = result.result?.metrics ?? fail("the run returned no metrics");
        const m = metrics;
        const ok = (["accuracy", "auc", "f1"] as const).every((k) => Math.abs((m[k] ?? Number.NaN) - expected[k]) <= 0.0101);
        console.log(
          `    run ${result.run_id}  ${((Date.now() - t0) / 1000).toFixed(0)}s  mode=${result.mode} attested=${result.receipt.attested}  ` +
            `accuracy ${m.accuracy} auc ${m.auc} f1 ${m.f1}  ${ok ? "matches" : "DIFFERS FROM"} the independent computation (${expected.accuracy.toFixed(2)}/${expected.auc.toFixed(2)}/${expected.f1.toFixed(2)})`,
        );
        console.log(`    buyer native balance ${near4(before)} -> ${near4(await near.getBalance(buyer))}`);
        if (!ok) failures.push(`${s.name}: metrics differ from the independent computation`);
      } catch (err) {
        const message = (err as Error).message;
        failures.push(`${buyer} -> ${s.name}: ${message}`);
        console.log(`    FAILED: ${message}`);
      }
    }
  } else {
    console.log("\n(SEED_RUNS=0: no paid runs)");
  }

  step("Done");
  for (const s of DEMO_LISTINGS) console.log(`  ${listings.get(s.key)!.id}  ${s.name}`);
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nseed failed: ${(err as Error).message}`);
  process.exit(1);
});
