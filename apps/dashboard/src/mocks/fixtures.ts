import type { EvaluatorMetadata, Listing } from "@securelambda/schemas";

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
