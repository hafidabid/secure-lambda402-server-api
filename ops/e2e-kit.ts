import { randomUUID } from "node:crypto";
import { sealFile } from "@securelambda/crypto";
import { UploadModelResponseSchema, type EvaluatorMetadata } from "@securelambda/schemas";

export type ApiInit = RequestInit & { account?: string; spoofAccountHeader?: string };
export type Api = (path: string, init?: ApiInit) => Promise<{ status: number; body: any }>;

export function makeApi(baseUrl: string, authHeaders: (account: string) => Promise<Record<string, string>>): Api {
  return async (path, init = {}) => {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (init.account) Object.assign(headers, await authHeaders(init.account));
    if (init.spoofAccountHeader) headers["x-account-id"] = init.spoofAccountHeader;
    const res = await fetch(`${baseUrl}/v1${path}`, { ...init, headers });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };
}

export function createChecks() {
  let passed = 0;
  return {
    check(label: string, ok: boolean, detail = ""): void {
      if (!ok) throw new Error(`FAILED: ${label} ${detail}`);
      passed += 1;
      console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
    },
    step: (title: string) => console.log(`\n== ${title}`),
    passed: () => passed,
  };
}
export type Check = ReturnType<typeof createChecks>["check"];

export const fmtNear = (yocto: bigint) => `${Number(yocto / 10n ** 20n) / 1e4} NEAR`;

export type Row = { age: number; glucose: number; y: 0 | 1 };

export function makeData(n: number): Row[] {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const age = 20 + Math.floor(rnd() * 60);
    const glucose = Math.round((70 + rnd() * 130) * 10) / 10;
    const score = (glucose - 120) / 25 + (age - 50) / 30 + (rnd() - 0.5) * 2.2;
    rows.push({ age, glucose, y: score > 0 ? 1 : 0 });
  }
  return rows;
}

export const MODEL = { features: ["age", "glucose"], weights: [0.03, 0.04], bias: -6.2 };
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function expectedMetrics(rows: Row[]) {
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

export async function publishSealedListing(
  api: Api,
  check: Check,
  opts: { seller: string; evaluator: EvaluatorMetadata; rows: Row[]; price: bigint; namePrefix: string },
): Promise<{ listingId: string; sealedBlob: Uint8Array }> {
  const { seller, evaluator, rows } = opts;
  const csv = ["age,glucose,y", ...rows.map((r) => `${r.age},${r.glucose},${r.y}`)].join("\n") + "\n";
  const created = await api("/listings", {
    method: "POST",
    account: seller,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `${opts.namePrefix}-${randomUUID().slice(0, 8)}`,
      schema: { task: "binary_classification", features: [{ name: "age", type: "int" }, { name: "glucose", type: "float" }], label: "y" },
      sample_rows: rows.slice(0, 5).map((r) => ({ age: r.age, glucose: r.glucose, y: r.y })),
      price_amount: opts.price.toString(),
      price_asset: "near",
      rules: { min_rows: 100, min_class_count: 20, round: 2, metrics: ["accuracy", "auc", "f1"], runs_per_day: 20, lifetime_budget: 100 },
      evaluator_version: evaluator.version,
    }),
  });
  check("listing created as draft", created.status === 201, `HTTP ${created.status} ${created.status !== 201 ? JSON.stringify(created.body) : ""}`);
  const listingId: string = created.body.id;

  const sealedData = sealFile(Buffer.from(csv), Buffer.from(evaluator.public_key, "base64"), { listing: listingId, role: "dataset", ev: evaluator.version });
  const dsForm = new FormData();
  dsForm.set("ciphertext", new Blob([sealedData.blob]), "dataset.bin");
  dsForm.set("wrapped_key", JSON.stringify(sealedData.envelope));
  const dsUp = await api(`/listings/${listingId}/dataset`, { method: "POST", account: seller, body: dsForm });
  check("sealed dataset uploaded", dsUp.status === 201 || dsUp.status === 200, `HTTP ${dsUp.status} ${dsUp.status >= 300 ? JSON.stringify(dsUp.body) : ""}`);
  const published = await api(`/listings/${listingId}/publish`, { method: "POST", account: seller });
  check("listing published", published.status === 200 && published.body.status === "published", `HTTP ${published.status}`);
  return { listingId, sealedBlob: sealedData.blob };
}

export async function uploadSealedModel(api: Api, check: Check, opts: { buyer: string; listingId: string; evaluator: EvaluatorMetadata }): Promise<string> {
  const { evaluator, listingId } = opts;
  const sealedModel = sealFile(Buffer.from(JSON.stringify(MODEL)), Buffer.from(evaluator.public_key, "base64"), { listing: listingId, role: "model", ev: evaluator.version });
  const mForm = new FormData();
  mForm.set("ciphertext", new Blob([sealedModel.blob]), "model.bin");
  mForm.set("wrapped_key", JSON.stringify(sealedModel.envelope));
  const mUp = await api(`/listings/${listingId}/models`, { method: "POST", account: opts.buyer, body: mForm });
  check("sealed model uploaded", mUp.status < 300, `HTTP ${mUp.status} ${mUp.status >= 300 ? JSON.stringify(mUp.body) : ""}`);
  return UploadModelResponseSchema.parse(mUp.body).model_id;
}
