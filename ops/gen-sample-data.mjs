// Generates a deterministic sample dataset + matching model for trying the UI by hand.
// Usage: node ops/gen-sample-data.mjs   (writes samples/glucose/* and the dashboard's downloadable copy)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTS = [join(ROOT, "samples", "glucose"), join(ROOT, "apps", "dashboard", "public", "samples", "glucose")];
const N = 240;

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

const rows = [];
for (let i = 0; i < N; i++) {
  const age = 20 + Math.floor(rnd() * 60);
  const glucose = Math.round((70 + rnd() * 130) * 10) / 10;
  const score = (glucose - 120) / 25 + (age - 50) / 30 + (rnd() - 0.5) * 2.2;
  rows.push({ age, glucose, y: score > 0 ? 1 : 0 });
}

const csv = ["age,glucose,y", ...rows.map((r) => `${r.age},${r.glucose},${r.y}`)].join("\n") + "\n";
const model = { features: ["age", "glucose"], weights: [0.03, 0.04], bias: -6.2 };
const schema = {
  task: "binary_classification",
  features: [
    { name: "age", type: "int" },
    { name: "glucose", type: "float" },
  ],
  label: "y",
};

for (const out of OUTS) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "glucose.csv"), csv);
  writeFileSync(join(out, "glucose-model.json"), JSON.stringify(model, null, 2) + "\n");
  writeFileSync(join(out, "glucose-schema.json"), JSON.stringify(schema, null, 2) + "\n");
  console.log(`wrote ${N} rows to ${out}`);
}
