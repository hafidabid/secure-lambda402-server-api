import type { z } from "zod";
import type { ListingRules, ModelJson, SampleRowSchema, SchemaContract } from "@securelambda/schemas";

export type SampleRow = z.infer<typeof SampleRowSchema>;

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

// ponytail: comma split without quoting; datasets are numeric-only per the schema contract
export function parseCsv(text: string): ParsedCsv {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const [first = "", ...rest] = lines;
  return { header: first.split(",").map((h) => h.trim()), rows: rest.map((l) => l.split(",").map((c) => c.trim())) };
}

export function inferSchema(csv: ParsedCsv, label: string): SchemaContract {
  const features = csv.header
    .filter((name) => name !== label)
    .map((name) => {
      const i = csv.header.indexOf(name);
      const allInts = csv.rows.every((r) => /^-?\d+$/.test(r[i] ?? ""));
      return { name, type: allInts ? ("int" as const) : ("float" as const) };
    });
  return { task: "binary_classification", features, label };
}

export interface CsvIssue {
  kind: "header" | "types" | "rows";
  message: string;
}

export function validateCsv(csv: ParsedCsv, schema: SchemaContract, rules: Pick<ListingRules, "min_rows" | "min_class_count">): CsvIssue[] {
  const errors: CsvIssue[] = [];
  const expected = [...schema.features.map((f) => f.name), schema.label];

  const dupes = csv.header.filter((h, i) => csv.header.indexOf(h) !== i);
  if (dupes.length) errors.push({ kind: "header", message: `Duplicate columns: ${dupes.join(", ")}` });
  const extra = csv.header.filter((h) => !expected.includes(h));
  if (extra.length) errors.push({ kind: "header", message: `Unexpected columns: ${extra.join(", ")}` });
  const missingCols = expected.filter((h) => !csv.header.includes(h));
  if (missingCols.length) errors.push({ kind: "header", message: `Missing columns: ${missingCols.join(", ")}` });
  if (errors.length) return errors;

  for (const f of schema.features) {
    const i = csv.header.indexOf(f.name);
    const empty = csv.rows.filter((r) => (r[i] ?? "") === "").length;
    if (empty) errors.push({ kind: "types", message: `${f.name}: ${empty} missing values` });
    const bad = csv.rows.filter((r) => {
      const v = r[i] ?? "";
      if (v === "") return false;
      return f.type === "int" ? !/^-?\d+$/.test(v) : !Number.isFinite(Number(v));
    }).length;
    if (bad) errors.push({ kind: "types", message: `${f.name}: ${bad} values are not ${f.type}` });
  }

  const li = csv.header.indexOf(schema.label);
  const notBinary = csv.rows.filter((r) => r[li] !== "0" && r[li] !== "1").length;
  if (notBinary) errors.push({ kind: "types", message: `${schema.label}: ${notBinary} labels are not 0 or 1` });

  if (csv.rows.length < rules.min_rows) errors.push({ kind: "rows", message: `Need at least ${rules.min_rows} rows, found ${csv.rows.length}` });
  const ones = csv.rows.filter((r) => r[li] === "1").length;
  const zeros = csv.rows.length - ones;
  if (Math.min(ones, zeros) < rules.min_class_count) {
    errors.push({ kind: "rows", message: `Each class needs ${rules.min_class_count} rows: class 0 has ${zeros}, class 1 has ${ones}` });
  }
  return errors;
}

export function classCounts(csv: ParsedCsv, label: string): { zeros: number; ones: number } {
  const li = csv.header.indexOf(label);
  const ones = csv.rows.filter((r) => r[li] === "1").length;
  return { zeros: csv.rows.length - ones, ones };
}

// Synthetic: each value is drawn from that column's observed range, so no real row is ever shown.
export function synthRows(csv: ParsedCsv, schema: SchemaContract, count = 5): SampleRow[] {
  const ranges = schema.features.map((f) => {
    const i = csv.header.indexOf(f.name);
    const values = csv.rows.map((r) => Number(r[i])).filter(Number.isFinite);
    return { f, min: Math.min(...values), max: Math.max(...values) };
  });
  return Array.from({ length: count }, (_, n) => {
    const row: SampleRow = {};
    for (const { f, min, max } of ranges) {
      const v = min + Math.random() * (max - min);
      row[f.name] = f.type === "int" ? Math.round(v) : Math.round(v * 10) / 10;
    }
    row[schema.label] = n % 2;
    return row;
  });
}

export interface LocalPrediction {
  probability: number;
  predicted: 0 | 1;
  actual: number;
}

export function localScore(model: ModelJson, rows: SampleRow[], label: string): LocalPrediction[] {
  return rows.map((row) => {
    const z = model.features.reduce((acc, name, i) => acc + (model.weights[i] ?? 0) * Number(row[name]), model.bias);
    const probability = 1 / (1 + Math.exp(-z));
    return { probability, predicted: probability >= 0.5 ? 1 : 0, actual: Number(row[label]) };
  });
}
