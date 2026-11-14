/**
 * Seed script for SecureLambda development environment.
 *
 * Populates the local PostgreSQL database with:
 * - Three Account rows (seller, buyer, relayer) with NEAR testnet account IDs
 * - One EvaluatorVersion row (version 1.0.0) with placeholder wasm hash and public key
 *
 * Uses upsert operations to ensure the script is idempotent (safe to re-run).
 *
 * Run from repo root via:
 *   npx ts-node ops/seed.ts
 *
 * Note: A real production deployment would also need to call NEAR's `storage_deposit`
 * on the asset/payment contract for each account (seller, buyer, relayer) to enable
 * them to hold and transfer token balances. This script only seeds the local Postgres
 * Account rows that this build's state machine depends on; storage deposit is omitted
 * because there is no live testnet connection in this dev environment.
 */

import { PrismaClient } from "@securelambda/db";

const prisma = new PrismaClient();

// Optional overrides, so the same script seeds a real testnet setup (see ops/live-e2e.sh):
//   SEED_SELLER_ID / SEED_BUYER_ID / SEED_RELAYER_ID   NEAR account ids
//   EVALUATOR_PUBLIC_KEY_B64   32-byte X25519 public key, base64
//   EVALUATOR_WASM_HASH        64-hex sha256 of the evaluator build
const SELLER_ID = process.env.SEED_SELLER_ID ?? "seller.testnet";
const BUYER_ID = process.env.SEED_BUYER_ID ?? "buyer.testnet";
const RELAYER_ID = process.env.SEED_RELAYER_ID ?? "relayer.testnet";

async function main() {
  console.log("🌱 Seeding SecureLambda development database...\n");

  // ========== Accounts ==========
  // Upsert seller account
  const seller = await prisma.account.upsert({
    where: { id: SELLER_ID },
    update: {}, // No-op if already exists
    create: {
      id: SELLER_ID,
      roleHint: "seller",
    },
  });
  console.log("✓ Account:", seller.id, `(role: ${seller.roleHint})`);

  // Upsert buyer account
  const buyer = await prisma.account.upsert({
    where: { id: BUYER_ID },
    update: {},
    create: {
      id: BUYER_ID,
      roleHint: "buyer",
    },
  });
  console.log("✓ Account:", buyer.id, `(role: ${buyer.roleHint})`);

  // Upsert relayer account (neutral, no role hint)
  const relayer = await prisma.account.upsert({
    where: { id: RELAYER_ID },
    update: {},
    create: {
      id: RELAYER_ID,
      roleHint: null,
    },
  });
  console.log("✓ Account:", relayer.id, "(role: neutral/relayer)\n");

  // ========== Evaluator Version ==========
  // Placeholder wasm hash: 64 lowercase hex chars (256 bits, as sha256 hash).
  // IMPORTANT: In a real deployment, this must be replaced with the actual sha256 hash
  // of a reproducible build of crates/evaluator (wasm32-wasip1 target).
  // See ops/runbook.md for the build process.
  const placeholderWasmHash = process.env.EVALUATOR_WASM_HASH ?? "0".repeat(64);

  // Placeholder public key: 32-byte zero buffer (X25519 public key size).
  // IMPORTANT: In a real deployment, this must be replaced with the actual X25519 public key
  // of the evaluator. The corresponding private key would be deployed as a secret to OutLayer.
  // See ops/runbook.md for key generation.
  const placeholderPublicKey = process.env.EVALUATOR_PUBLIC_KEY_B64
    ? Buffer.from(process.env.EVALUATOR_PUBLIC_KEY_B64, "base64")
    : Buffer.alloc(32, 0);

  const evaluator = await prisma.evaluatorVersion.upsert({
    where: { version: "1.0.0" },
    // Re-running only rewrites the evaluator when real values were supplied; defaults never clobber them.
    update: process.env.EVALUATOR_WASM_HASH || process.env.EVALUATOR_PUBLIC_KEY_B64
      ? { wasmHash: placeholderWasmHash, publicKey: placeholderPublicKey }
      : {},
    create: {
      version: "1.0.0",
      projectId: "hafidbuild.testnet/securelambda-evaluator",
      wasmHash: placeholderWasmHash,
      publicKey: placeholderPublicKey,
      trustTier: 1,
      active: true,
    },
  });
  console.log("✓ EvaluatorVersion:", evaluator.version);
  console.log(
    `  projectId: ${evaluator.projectId} (placeholder)`
  );
  console.log(
    `  wasmHash: ${evaluator.wasmHash.substring(0, 16)}... (placeholder)`
  );
  console.log(
    `  publicKey: ${evaluator.publicKey.toString("hex").substring(0, 16)}... (placeholder)`
  );
  console.log(`  trustTier: ${evaluator.trustTier}`);
  console.log(`  active: ${evaluator.active}\n`);

  console.log("✅ Seed completed successfully!");
  console.log("\nNext steps:");
  console.log("  1. Start the API:      npm run build && npm run start --workspace=@securelambda/api");
  console.log("  2. Start the worker:   npm run build && npm run start --workspace=@securelambda/worker");
  console.log("  3. Run preflight:      ops/preflight.sh");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
