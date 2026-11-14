/**
 * Deterministic synthetic datasets, models and listing definitions for the demo (ops/seed-demo.ts).
 * Nothing here is real patient data: every row is generated from a seeded random number generator, so the same
 * seed always produces the same CSV, the same sample rows and the same metrics.
 */

export type Row = Record<string, number>;

export interface FeatureSpec {
  name: string;
  type: "int" | "float";
  mean: number;
  sd: number;
  min: number;
  max: number;
  /** Effect on the label, in standard deviations of the hidden risk score. Negative = protective. */
  weight: number;
  /** Decimals kept for floats. */
  dp?: number;
  /** Count-like feature: drawn from the normal, then floored at 0 and rounded. */
  count?: boolean;
  /** 0/1 feature that is 1 with this probability (mean/sd/min/max are ignored). */
  bernoulli?: number;
}

export interface DemoListing {
  key: string;
  seller: "hospital" | "clinic";
  name: string;
  /** Price per run, in NEAR. */
  priceNear: string;
  label: string;
  rows: number;
  /** Share of rows with label 1. */
  positiveRate: number;
  features: FeatureSpec[];
  rules: { min_rows: number; min_class_count: number; runs_per_day: number; lifetime_budget: number };
  seed: number;
}

export const DEMO_LISTINGS: DemoListing[] = [
  {
    key: "diabetes",
    seller: "hospital",
    name: "Diabetes risk, Hospital A",
    priceNear: "0.02",
    label: "diabetes",
    rows: 600,
    positiveRate: 0.35,
    seed: 101,
    rules: { min_rows: 300, min_class_count: 50, runs_per_day: 10, lifetime_budget: 200 },
    features: [
      { name: "age", type: "int", mean: 52, sd: 14, min: 20, max: 90, weight: 0.6 },
      { name: "glucose", type: "float", mean: 118, sd: 28, min: 60, max: 260, weight: 1.0, dp: 1 },
      { name: "hba1c", type: "float", mean: 6.1, sd: 1.1, min: 4, max: 12, weight: 1.4, dp: 1 },
      { name: "bmi", type: "float", mean: 28, sd: 5, min: 16, max: 50, weight: 0.5, dp: 1 },
    ],
  },
  {
    key: "sepsis",
    seller: "hospital",
    name: "Sepsis early warning, ICU cohort",
    priceNear: "0.05",
    label: "sepsis",
    rows: 800,
    positiveRate: 0.2,
    seed: 202,
    rules: { min_rows: 400, min_class_count: 80, runs_per_day: 5, lifetime_budget: 50 },
    features: [
      { name: "heart_rate", type: "int", mean: 92, sd: 18, min: 45, max: 170, weight: 0.8 },
      { name: "temperature", type: "float", mean: 37.4, sd: 0.9, min: 34.5, max: 41.5, weight: 0.7, dp: 1 },
      { name: "wbc", type: "float", mean: 10, sd: 4, min: 2, max: 35, weight: 0.6, dp: 1 },
      { name: "lactate", type: "float", mean: 1.8, sd: 1.2, min: 0.4, max: 9, weight: 1.5, dp: 1 },
    ],
  },
  {
    key: "retinopathy",
    seller: "hospital",
    name: "Diabetic retinopathy screening",
    priceNear: "0.03",
    label: "retinopathy",
    rows: 500,
    positiveRate: 0.3,
    seed: 303,
    rules: { min_rows: 300, min_class_count: 60, runs_per_day: 8, lifetime_budget: 120 },
    features: [
      { name: "age", type: "int", mean: 56, sd: 11, min: 25, max: 88, weight: 0.4 },
      { name: "diabetes_years", type: "int", mean: 9, sd: 5, min: 0, max: 35, weight: 1.1 },
      { name: "hba1c", type: "float", mean: 7.4, sd: 1.3, min: 5, max: 13, weight: 0.9, dp: 1 },
      { name: "systolic_bp", type: "int", mean: 132, sd: 16, min: 90, max: 200, weight: 0.5 },
    ],
  },
  {
    key: "heart",
    seller: "clinic",
    name: "Heart failure readmission",
    priceNear: "0.03",
    label: "readmitted",
    rows: 520,
    positiveRate: 0.3,
    seed: 404,
    rules: { min_rows: 300, min_class_count: 50, runs_per_day: 10, lifetime_budget: 200 },
    features: [
      { name: "age", type: "int", mean: 66, sd: 12, min: 30, max: 95, weight: 0.5 },
      { name: "ejection_fraction", type: "int", mean: 40, sd: 12, min: 15, max: 75, weight: -1.2 },
      { name: "creatinine", type: "float", mean: 1.3, sd: 0.5, min: 0.5, max: 4, weight: 0.9, dp: 2 },
      { name: "sodium", type: "int", mean: 137, sd: 4, min: 120, max: 150, weight: -0.6 },
    ],
  },
  {
    key: "copd",
    seller: "clinic",
    name: "COPD 30-day readmission",
    priceNear: "0.015",
    label: "readmitted_30d",
    rows: 450,
    positiveRate: 0.35,
    seed: 505,
    rules: { min_rows: 200, min_class_count: 30, runs_per_day: 20, lifetime_budget: 400 },
    features: [
      { name: "age", type: "int", mean: 68, sd: 9, min: 40, max: 95, weight: 0.4 },
      { name: "fev1_percent", type: "float", mean: 52, sd: 16, min: 15, max: 100, weight: -1.3, dp: 1 },
      { name: "prior_admissions", type: "int", mean: 1.2, sd: 1.3, min: 0, max: 8, weight: 1.0, count: true },
      { name: "oxygen_use", type: "int", mean: 0, sd: 1, min: 0, max: 1, weight: 0.7, bernoulli: 0.35 },
    ],
  },
];

// ---- seeded randomness -------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

const round = (value: number, dp: number) => Math.round(value * 10 ** dp) / 10 ** dp;

function draw(f: FeatureSpec, rnd: () => number): number {
  if (f.bernoulli !== undefined) return rnd() < f.bernoulli ? 1 : 0;
  let v = f.mean + f.sd * normal(rnd);
  v = Math.min(f.max, Math.max(f.min, v));
  if (f.count || f.type === "int") return Math.round(v);
  return round(v, f.dp ?? 1);
}

/** Moments of the generated column, so the model is fitted to the data and not to the textbook parameters. */
function moments(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
  return { mean, sd };
}

export interface Dataset {
  rows: Row[];
  csv: string;
  /** The hidden risk-score cut-off that gives the requested positive rate, in standardised units. */
  threshold: number;
}

export function generateDataset(spec: DemoListing): Dataset {
  const rnd = mulberry32(spec.seed);
  const feats: Row[] = [];
  for (let i = 0; i < spec.rows; i++) feats.push(Object.fromEntries(spec.features.map((f) => [f.name, draw(f, rnd)])));

  const stats = Object.fromEntries(spec.features.map((f) => [f.name, moments(feats.map((r) => r[f.name]!))]));
  const risk = feats.map((r) => {
    const signal = spec.features.reduce((sum, f) => sum + f.weight * ((r[f.name]! - stats[f.name]!.mean) / stats[f.name]!.sd), 0);
    return signal + 0.9 * normal(rnd);
  });
  // Cut at the quantile, so the positive rate is exact and the class balance never depends on luck.
  const sorted = [...risk].sort((a, b) => a - b);
  const threshold = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - spec.positiveRate)))]!;
  const rows = feats.map((r, i) => ({ ...r, [spec.label]: risk[i]! >= threshold ? 1 : 0 }));

  const header = [...spec.features.map((f) => f.name), spec.label].join(",");
  const csv = [header, ...rows.map((r) => [...spec.features.map((f) => r[f.name]), r[spec.label]].join(","))].join("\n") + "\n";
  return { rows, csv, threshold };
}

// ---- models ----------------------------------------------------------------------------------------------------

export interface ModelJson {
  features: string[];
  weights: number[];
  bias: number;
}

/**
 * "good": uses every feature with the weights that generated the labels, converted from standardised units to raw
 * units, so it scores well. "weak": a model built on the first feature alone, a plausible but poor attempt.
 */
export function buildModel(spec: DemoListing, data: Dataset, kind: "good" | "weak"): ModelJson {
  const stats = Object.fromEntries(spec.features.map((f) => [f.name, moments(data.rows.map((r) => r[f.name]!))]));
  const weights = spec.features.map((f, i) => {
    if (kind === "weak" && i > 0) return 0;
    return f.weight / stats[f.name]!.sd;
  });
  const bias = -spec.features.reduce((sum, f, i) => sum + weights[i]! * stats[f.name]!.mean, 0) - (kind === "good" ? data.threshold : 0);
  return {
    features: spec.features.map((f) => f.name),
    weights: weights.map((w) => round(w, 6)),
    bias: round(bias, 6),
  };
}

// ---- the metrics a correct evaluator must report, computed independently in TypeScript -------------------

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function expectedMetrics(spec: DemoListing, data: Dataset, model: ModelJson): { accuracy: number; auc: number; f1: number } {
  const p = data.rows.map((r) => sigmoid(model.features.reduce((s, name, i) => s + model.weights[i]! * r[name]!, model.bias)));
  const y = data.rows.map((r) => r[spec.label]!);
  const pred = p.map((x) => (x >= 0.5 ? 1 : 0));
  const tp = y.filter((v, i) => v === 1 && pred[i] === 1).length;
  const fp = y.filter((v, i) => v === 0 && pred[i] === 1).length;
  const fn = y.filter((v, i) => v === 1 && pred[i] === 0).length;
  const accuracy = y.filter((v, i) => v === pred[i]).length / y.length;
  const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  const pos = p.filter((_, i) => y[i] === 1);
  const neg = p.filter((_, i) => y[i] === 0);
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return { accuracy, auc: wins / (pos.length * neg.length), f1 };
}

/** 0.02 NEAR -> "20000000000000000000000" yoctoNEAR (24 decimals), without floating point. */
export function nearToYocto(near: string): string {
  const [whole = "0", frac = ""] = near.split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt(frac.padEnd(24, "0").slice(0, 24))).toString();
}

/** The runs to make against the real backend: [listing key, buyer, model quality]. */
export const DEMO_RUNS: { listing: string; buyer: "medai" | "pharmalab"; model: "good" | "weak"; why: string }[] = [
  { listing: "diabetes", buyer: "medai", model: "good", why: "happy path: a strong model, a high score, paid and attested" },
  { listing: "diabetes", buyer: "pharmalab", model: "weak", why: "same data, a poor model: the score tells the buyer the model is not ready" },
  { listing: "heart", buyer: "medai", model: "good", why: "a second seller and dataset, so the buyer's history has two sources" },
  { listing: "sepsis", buyer: "pharmalab", model: "good", why: "the most expensive listing, with a rare positive class (20%)" },
];
