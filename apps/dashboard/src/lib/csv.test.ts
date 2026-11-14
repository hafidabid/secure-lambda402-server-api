import { test } from "node:test";
import assert from "node:assert/strict";
import { inferSchema, localScore, parseCsv, synthRows, validateCsv } from "./csv.ts";

const RULES = { min_rows: 4, min_class_count: 2 };

test("infers int vs float and keeps the label out of features", () => {
  const csv = parseCsv("﻿age,bmi,diabetes\r\n40,22.5,0\n51,30.1,1\n");
  assert.deepEqual(inferSchema(csv, "diabetes"), {
    task: "binary_classification",
    features: [{ name: "age", type: "int" }, { name: "bmi", type: "float" }],
    label: "diabetes",
  });
});

test("a clean file has no issues", () => {
  const csv = parseCsv("age,bmi,y\n40,22.5,0\n51,30.1,1\n33,25,0\n60,31.2,1\n");
  assert.deepEqual(validateCsv(csv, inferSchema(csv, "y"), RULES), []);
});

test("reports bad labels, missing values and short files by column and count", () => {
  const csv = parseCsv("age,bmi,y\n40,,0\n51,30.1,2\n");
  const schema = { task: "binary_classification" as const, features: [{ name: "age", type: "int" as const }, { name: "bmi", type: "float" as const }], label: "y" };
  const issues = validateCsv(csv, schema, RULES).map((i) => `${i.kind}:${i.message}`);
  assert.ok(issues.includes("types:bmi: 1 missing values"));
  assert.ok(issues.includes("types:y: 1 labels are not 0 or 1"));
  assert.ok(issues.some((i) => i.startsWith("rows:Need at least 4 rows")));
});

test("rejects extra columns before anything else", () => {
  const csv = parseCsv("age,ssn,y\n40,123,0\n");
  const schema = { task: "binary_classification" as const, features: [{ name: "age", type: "int" as const }], label: "y" };
  assert.deepEqual(validateCsv(csv, schema, RULES), [{ kind: "header", message: "Unexpected columns: ssn" }]);
});

test("synthetic rows stay inside each column's observed range", () => {
  const csv = parseCsv("age,y\n20,0\n80,1\n");
  const rows = synthRows(csv, inferSchema(csv, "y"), 50);
  assert.equal(rows.length, 50);
  for (const r of rows) {
    assert.ok(Number(r.age) >= 20 && Number(r.age) <= 80);
    assert.ok(r.y === 0 || r.y === 1);
  }
});

test("local score applies sigmoid(w·x + b)", () => {
  const [p] = localScore({ features: ["x"], weights: [2], bias: -2 }, [{ x: 1, y: 1 }], "y");
  assert.equal(p?.probability, 0.5);
  assert.equal(p?.predicted, 1);
});
