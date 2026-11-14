import type { EvaluatorMetadata, Listing, Receipt, Run } from "@securelambda/schemas";

export const EVALUATOR: EvaluatorMetadata = {
  version: "1.0.0",
  project_id: "securelambda.testnet/evaluator",
  wasm_hash: "a91f03c2e4b7d0185f6c3a9e2b4d7f10c8e5a3b6d9f2e1c4a7b0d3e67d44be19",
  public_key: "q7Yk0n4Jx1m2P3sT5vW8zA9cE1gH3jL5nQ7rU9wY0bE=",
  trust_tier: 1,
};

export const SELLER_ALLOW_LIST = ["hospital.testnet", "clinic.testnet"];

const now = "2026-11-14T09:00:00.000Z";
const TWO_NEAR = "2000000000000000000000000";

const RULES: Listing["rules"] = { min_rows: 500, min_class_count: 50, round: 2, metrics: ["accuracy", "auc", "f1"], runs_per_day: 10, lifetime_budget: 200 };

export const LISTINGS: Listing[] = [
  {
    id: "lst_diabetes_a",
    seller_id: "hospital.testnet",
    name: "Diabetes risk, Hospital A",
    schema: {
      task: "binary_classification",
      features: [
        { name: "age", type: "int" },
        { name: "glucose", type: "float" },
        { name: "hba1c", type: "float" },
        { name: "bmi", type: "float" },
      ],
      label: "diabetes",
    },
    sample_rows: [
      { age: 63, glucose: 148, hba1c: 7.1, bmi: 31.2, diabetes: 1 },
      { age: 41, glucose: 102.5, hba1c: 5.4, bmi: 24.8, diabetes: 0 },
      { age: 57, glucose: 131, hba1c: 6.6, bmi: 29.5, diabetes: 1 },
      { age: 29, glucose: 91.2, hba1c: 5.1, bmi: 22.1, diabetes: 0 },
      { age: 70, glucose: 156.4, hba1c: 7.8, bmi: 27.9, diabetes: 1 },
    ],
    price_amount: TWO_NEAR,
    price_asset: "near",
    rules: RULES,
    evaluator_version: "1.0.0",
    dataset_asset_id: "ast_ds_01",
    status: "published",
    created_at: now,
    published_at: now,
  },
  {
    id: "lst_heart_b",
    seller_id: "clinic.testnet",
    name: "Heart failure readmission",
    schema: {
      task: "binary_classification",
      features: [
        { name: "age", type: "int" },
        { name: "ejection_fraction", type: "int" },
        { name: "creatinine", type: "float" },
        { name: "sodium", type: "int" },
      ],
      label: "readmitted",
    },
    sample_rows: [
      { age: 72, ejection_fraction: 30, creatinine: 1.8, sodium: 134, readmitted: 1 },
      { age: 55, ejection_fraction: 55, creatinine: 0.9, sodium: 139, readmitted: 0 },
      { age: 68, ejection_fraction: 25, creatinine: 2.1, sodium: 131, readmitted: 1 },
      { age: 49, ejection_fraction: 60, creatinine: 1, sodium: 140, readmitted: 0 },
      { age: 80, ejection_fraction: 35, creatinine: 1.4, sodium: 136, readmitted: 1 },
    ],
    price_amount: "3500000000000000000000000",
    price_asset: "near",
    rules: RULES,
    evaluator_version: "1.0.0",
    dataset_asset_id: "ast_ds_02",
    status: "published",
    created_at: now,
    published_at: now,
  },
];

// --- more listings, so the catalogue looks like a marketplace and search/price/rules differ ----------------------

const MIN_ROWS = (min_rows: number): Listing["rules"] => ({ ...RULES, min_rows });

export const MORE_LISTINGS: Listing[] = [
  {
    id: "lst_sepsis_c",
    seller_id: "hospital.testnet",
    name: "Sepsis early warning, ICU cohort",
    schema: {
      task: "binary_classification",
      features: [
        { name: "heart_rate", type: "int" },
        { name: "temperature", type: "float" },
        { name: "wbc", type: "float" },
        { name: "lactate", type: "float" },
      ],
      label: "sepsis",
    },
    sample_rows: [
      { heart_rate: 118, temperature: 38.9, wbc: 17.2, lactate: 4.1, sepsis: 1 },
      { heart_rate: 76, temperature: 36.8, wbc: 7.4, lactate: 1.0, sepsis: 0 },
      { heart_rate: 104, temperature: 38.2, wbc: 13.8, lactate: 2.9, sepsis: 1 },
      { heart_rate: 82, temperature: 37.1, wbc: 8.9, lactate: 1.3, sepsis: 0 },
      { heart_rate: 126, temperature: 39.4, wbc: 19.6, lactate: 5.2, sepsis: 1 },
    ],
    price_amount: "5000000000000000000000000",
    price_asset: "near",
    rules: { ...MIN_ROWS(300), min_class_count: 40, runs_per_day: 5, lifetime_budget: 50 },
    evaluator_version: "1.0.0",
    dataset_asset_id: "ast_ds_03",
    status: "published",
    created_at: now,
    published_at: now,
  },
  {
    id: "lst_copd_d",
    seller_id: "clinic.testnet",
    name: "COPD 30-day readmission",
    schema: {
      task: "binary_classification",
      features: [
        { name: "age", type: "int" },
        { name: "fev1_percent", type: "float" },
        { name: "prior_admissions", type: "int" },
        { name: "oxygen_use", type: "int" },
      ],
      label: "readmitted_30d",
    },
    sample_rows: [
      { age: 71, fev1_percent: 38.5, prior_admissions: 3, oxygen_use: 1, readmitted_30d: 1 },
      { age: 64, fev1_percent: 62.0, prior_admissions: 0, oxygen_use: 0, readmitted_30d: 0 },
      { age: 77, fev1_percent: 31.2, prior_admissions: 4, oxygen_use: 1, readmitted_30d: 1 },
      { age: 59, fev1_percent: 71.8, prior_admissions: 1, oxygen_use: 0, readmitted_30d: 0 },
      { age: 68, fev1_percent: 44.1, prior_admissions: 2, oxygen_use: 1, readmitted_30d: 1 },
    ],
    price_amount: "1500000000000000000000000",
    price_asset: "near",
    rules: { ...MIN_ROWS(200), min_class_count: 30, runs_per_day: 20, lifetime_budget: 400 },
    evaluator_version: "1.0.0",
    dataset_asset_id: "ast_ds_04",
    status: "published",
    created_at: now,
    published_at: now,
  },
  {
    id: "lst_retina_e",
    seller_id: "hospital.testnet",
    name: "Diabetic retinopathy screening",
    schema: {
      task: "binary_classification",
      features: [
        { name: "age", type: "int" },
        { name: "diabetes_years", type: "int" },
        { name: "hba1c", type: "float" },
        { name: "systolic_bp", type: "int" },
      ],
      label: "retinopathy",
    },
    sample_rows: [
      { age: 58, diabetes_years: 14, hba1c: 8.4, systolic_bp: 152, retinopathy: 1 },
      { age: 46, diabetes_years: 3, hba1c: 6.2, systolic_bp: 124, retinopathy: 0 },
      { age: 67, diabetes_years: 19, hba1c: 9.1, systolic_bp: 161, retinopathy: 1 },
      { age: 39, diabetes_years: 2, hba1c: 6.0, systolic_bp: 118, retinopathy: 0 },
      { age: 61, diabetes_years: 11, hba1c: 7.9, systolic_bp: 146, retinopathy: 1 },
    ],
    price_amount: "2500000000000000000000000",
    price_asset: "near",
    rules: { ...MIN_ROWS(400), min_class_count: 60, runs_per_day: 8, lifetime_budget: 120 },
    evaluator_version: "1.0.0",
    dataset_asset_id: "ast_ds_05",
    status: "published",
    created_at: now,
    published_at: now,
  },
];

// --- a pre-filled run history, one run in every state the UI can show -----------------------------------------------
// Buyer-side runs belong to the demo account (medai.testnet), so they open from /runs/:id. The rest only appear in the
// seller's "Runs on your data" table. Times are relative to page load so "2 minutes ago" is always true.

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DEMO_BUYER = "medai.testnet";
const TX = {
  exec: "9bR2cT7wXk4mJp8sNq1vLd6fHz3yGa5eLq3vM8eKqRtW",
  settle: "67fYJJ4Gk9xQ2mVt7bRw3nPy6cJs8dLh1aHf7sP1aZkC",
};

interface HistoryRun {
  run: Run;
  receipt: Receipt;
}

function history(
  id: string,
  listing_id: string,
  buyer_id: string,
  state: Run["state"],
  createdAgo: number,
  extra: Partial<Run> = {},
): HistoryRun {
  const created_at = ago(createdAgo);
  const hasResult = state === "RESULT_READY" || state === "SETTLE_PENDING" || state === "SETTLED";
  const mode = extra.mode ?? "enclave";
  const run: Run = {
    id,
    listing_id,
    buyer_id,
    model_id: `mdl_${id.slice(-6)}`,
    state,
    payment_nonce: `nonce_${id.slice(-8)}`,
    attempt: 0,
    exec_tx_hash: ["PAYMENT_REJECTED", "PAYMENT_VERIFIED", "QUEUED"].includes(state) ? null : TX.exec,
    result: null,
    error_code: null,
    mode,
    created_at,
    updated_at: created_at,
    ...extra,
  };
  return {
    run,
    receipt: {
      exec_tx: run.exec_tx_hash ?? "",
      settle_tx: state === "SETTLED" ? TX.settle : null,
      wasm_hash: EVALUATOR.wasm_hash,
      attested: hasResult && mode === "enclave",
    },
  };
}

export const HISTORY: HistoryRun[] = [
  // The demo buyer's own runs (open them from the Runs page).
  history("run_demo_settled_enclave", "lst_diabetes_a", DEMO_BUYER, "SETTLED", 26 * HOUR, {
    result: { metrics: { accuracy: 0.86, auc: 0.93, f1: 0.84 }, n_bucket: "500-999" },
  }),
  history("run_demo_settled_local", "lst_heart_b", DEMO_BUYER, "SETTLED", 5 * HOUR, {
    mode: "local",
    result: { metrics: { accuracy: 0.79, auc: 0.84, f1: 0.77 }, n_bucket: "200-499" },
  }),
  history("run_demo_failed", "lst_sepsis_c", DEMO_BUYER, "FAILED_NOT_CHARGED", 3 * HOUR, { error_code: "MODEL_UNUSABLE" }),
  history("run_demo_running", "lst_diabetes_a", DEMO_BUYER, "EXECUTING", 2 * MIN),
  history("run_demo_slow", "lst_copd_d", DEMO_BUYER, "POLLING", 4 * MIN, { attempt: 1 }),
  history("run_demo_rejected", "lst_retina_e", DEMO_BUYER, "PAYMENT_REJECTED", 40 * MIN, { error_code: "PAYMENT_INVALID" }),
  // Other buyers, visible to the seller only.
  history("run_pharmalab_01", "lst_diabetes_a", "pharmalab.testnet", "SETTLED", 52 * HOUR, {
    result: { metrics: { accuracy: 0.91, auc: 0.96, f1: 0.9 }, n_bucket: "500-999" },
  }),
  history("run_pharmalab_02", "lst_diabetes_a", "pharmalab.testnet", "SETTLED", 30 * HOUR, {
    result: { metrics: { accuracy: 0.88, auc: 0.94, f1: 0.87 }, n_bucket: "500-999" },
  }),
  history("run_bioscore_01", "lst_retina_e", "bioscore.testnet", "SETTLED", 9 * HOUR, {
    result: { metrics: { accuracy: 0.82, auc: 0.89, f1: 0.8 }, n_bucket: "500-999" },
  }),
  history("run_cardiocode_01", "lst_heart_b", "cardiocode.testnet", "SETTLE_PENDING", 70 * MIN, {
    result: { metrics: { accuracy: 0.81, auc: 0.87, f1: 0.79 }, n_bucket: "200-499" },
  }),
  history("run_bioscore_02", "lst_sepsis_c", "bioscore.testnet", "QUEUED", 25_000),
];
