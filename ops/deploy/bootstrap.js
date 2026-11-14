/**
 * One-shot, safe to re-run: applies database migrations, then records the evaluator build (its real hash and
 * public key) so the API can tell buyers who will score their run. Runs in the worker image.
 * Env: DATABASE_URL, EVALUATOR_PUBLIC_KEY_B64, EVALUATOR_BIN (default /app/evaluator).
 */
const { execSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

execSync("npm run prisma:migrate:deploy --workspace=@securelambda/db", { stdio: "inherit" });

const { PrismaClient } = require("@securelambda/db");
const prisma = new PrismaClient();

(async () => {
  const wasmHash = createHash("sha256").update(readFileSync(process.env.EVALUATOR_BIN || "/app/evaluator")).digest("hex");
  const publicKey = Buffer.from(process.env.EVALUATOR_PUBLIC_KEY_B64 || "", "base64");
  if (publicKey.length !== 32) throw new Error("EVALUATOR_PUBLIC_KEY_B64 must be a base64 32-byte X25519 public key");

  await prisma.evaluatorVersion.upsert({
    where: { version: "1.0.0" },
    update: { wasmHash, publicKey, active: true },
    create: { version: "1.0.0", projectId: "securelambda/local-evaluator", wasmHash, publicKey, trustTier: 1, active: true },
  });
  console.log(`evaluator 1.0.0 recorded, build hash ${wasmHash.slice(0, 16)}...`);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
