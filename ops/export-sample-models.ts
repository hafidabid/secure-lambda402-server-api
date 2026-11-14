// Writes a well-scoring model.json for every demo listing, for reviewers to test against the live catalogue.
// Usage: npx ts-node ops/export-sample-models.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_LISTINGS, buildModel, expectedMetrics, generateDataset } from "./demo-data";

const ROOT = join(__dirname, "..");
const OUTS = [join(ROOT, "samples", "models"), join(ROOT, "apps", "dashboard", "public", "samples", "models")];

for (const out of OUTS) mkdirSync(out, { recursive: true });

for (const spec of DEMO_LISTINGS) {
  const data = generateDataset(spec);
  const model = buildModel(spec, data, "good");
  const m = expectedMetrics(spec, data, model);
  for (const out of OUTS) writeFileSync(join(out, `${spec.key}-model.json`), JSON.stringify(model, null, 2) + "\n");
  console.log(`${spec.key.padEnd(12)} ${spec.name.padEnd(36)} accuracy ${m.accuracy.toFixed(2)}  auc ${m.auc.toFixed(2)}  f1 ${m.f1.toFixed(2)}`);
}
