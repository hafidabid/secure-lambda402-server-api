/**
 * One-shot, safe to re-run: applies database migrations, then records the evaluator build (its real hash and
 * public key) so the API can tell buyers who will score their run. Runs in the worker image.
 * Env: DATABASE_URL, EVALUATOR_PUBLIC_KEY_B64, and either
 *   - EVALUATOR_BIN (default /app/evaluator): the local evaluator's hash is read from the binary, or
 *   - EVALUATOR_MODE=outlayer with OUTLAYER_WASM_HASH (sha256 of the wasm deployed to OutLayer) and OUTLAYER_PROJECT.
 */
const { execSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

execSync("npm run prisma:migrate:deploy --workspace=@securelambda/db", { stdio: "inherit" });

const { PrismaClient } = require("@securelambda/db");
const prisma = new PrismaClient();

(async () => {
  const outlayer = process.env.EVALUATOR_MODE === "outlayer";
  const wasmHash = outlayer
    ? process.env.OUTLAYER_WASM_HASH || ""
    : createHash("sha256").update(readFileSync(process.env.EVALUATOR_BIN || "/app/evaluator")).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(wasmHash)) throw new Error("OUTLAYER_WASM_HASH must be the 64-hex sha256 of the deployed evaluator.wasm");
  const projectId = outlayer ? process.env.OUTLAYER_PROJECT : "securelambda/local-evaluator";
  if (!projectId) throw new Error("OUTLAYER_PROJECT is required when EVALUATOR_MODE=outlayer");
  const publicKey = Buffer.from(process.env.EVALUATOR_PUBLIC_KEY_B64 || "", "base64");
  if (publicKey.length !== 32) throw new Error("EVALUATOR_PUBLIC_KEY_B64 must be a base64 32-byte X25519 public key");

  await prisma.evaluatorVersion.upsert({
    where: { version: "1.0.0" },
    update: { wasmHash, publicKey, projectId, active: true },
    create: { version: "1.0.0", projectId, wasmHash, publicKey, trustTier: 1, active: true },
  });
  console.log(`evaluator 1.0.0 recorded, build hash ${wasmHash.slice(0, 16)}...`);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
