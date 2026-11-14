import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@securelambda/db";
import { generatePayerKeypair, signPayment, type SandboxFacilitator } from "@securelambda/facilitator";
import type { StorageClient } from "./storage-client";

export class InMemoryStorageClient implements StorageClient {
  private readonly blobs = new Map<string, Buffer>();

  put(key: string, data: Buffer): void {
    this.blobs.set(key, data);
  }

  async getCiphertext(key: string): Promise<Buffer> {
    const blob = this.blobs.get(key);
    if (!blob) throw new Error(`no blob stored for key ${key}`);
    return blob;
  }
}

export const WASM_HASH = "d".repeat(64);
export const EVALUATOR_VERSION = "1.0.0";

export interface RunFixture {
  runId: string;
  listingId: string;
  paymentNonce: string;
  buyerId: string;
  sellerId: string;
}

/**
 * Builds a complete, self-contained set of rows (accounts, evaluator
 * version, listing, dataset/model assets, model, run, payment) for one
 * test, all under randomised ids so tests never collide in the shared
 * Postgres container.
 */
export async function createRunFixture(
  prisma: PrismaClient,
  storage: InMemoryStorageClient,
  facilitator: SandboxFacilitator,
  overrides: { rulesJson?: Record<string, unknown>; balance?: bigint } = {},
): Promise<RunFixture> {
  const suffix = randomUUID();
  const sellerId = `seller-${suffix}.testnet`;
  const buyerId = `buyer-${suffix}.testnet`;
  const listingId = `lst_${suffix}`;
  const datasetAssetId = `ast_ds_${suffix}`;
  const modelAssetId = `ast_mdl_${suffix}`;
  const modelId = `mdl_${suffix}`;
  const runId = `run_${suffix}`;
  const paymentNonce = `n_${suffix}`;

  await prisma.account.createMany({ data: [{ id: sellerId }, { id: buyerId }] });
  await prisma.evaluatorVersion.upsert({
    where: { version: EVALUATOR_VERSION },
    create: {
      version: EVALUATOR_VERSION,
      projectId: "test.testnet/evaluator",
      wasmHash: WASM_HASH,
      publicKey: Buffer.alloc(32, 1),
      trustTier: 1,
      active: true,
    },
    update: {},
  });

  storage.put(datasetAssetId, Buffer.from("dataset ciphertext"));
  storage.put(modelAssetId, Buffer.from("model ciphertext"));
  await prisma.asset.createMany({
    data: [
      { id: datasetAssetId, ownerId: sellerId, kind: "dataset", sha256: "a".repeat(64), sizeBytes: 100, storageKey: datasetAssetId },
      { id: modelAssetId, ownerId: buyerId, kind: "model", sha256: "b".repeat(64), sizeBytes: 50, storageKey: modelAssetId },
    ],
  });

  await prisma.listing.create({
    data: {
      id: listingId,
      sellerId,
      name: "fixture listing",
      schemaJson: { task: "binary_classification", features: [{ name: "age", type: "int" }], label: "y" },
      sampleRows: [],
      priceAmount: "1000",
      priceAsset: "near",
      rulesJson: { min_rows: 50, min_class_count: 10, round: 2, metrics: ["accuracy", "auc", "f1"], runs_per_day: 20, lifetime_budget: 200, ...overrides.rulesJson },
      evaluatorVersion: EVALUATOR_VERSION,
      datasetAssetId,
      datasetWrappedKey: { v: 1, epk: "x", nonce: "x", ct: "x", aad_ctx: { listing: listingId, role: "dataset", ev: EVALUATOR_VERSION, ct_sha256: "a".repeat(64) } },
      status: "published",
    },
  });

  await prisma.model.create({
    data: {
      id: modelId,
      buyerId,
      listingId,
      assetId: modelAssetId,
      wrappedKey: { v: 1, epk: "x", nonce: "x", ct: "x", aad_ctx: { listing: listingId, role: "model", ev: EVALUATOR_VERSION, ct_sha256: "b".repeat(64) } },
      evaluatorVersion: EVALUATOR_VERSION,
    },
  });

  await prisma.run.create({
    data: { id: runId, listingId, buyerId, modelId, state: "QUEUED", paymentNonce, mode: "enclave" },
  });

  const payer = generatePayerKeypair();
  await facilitator.registerAccountKey(buyerId, payer.publicKeyBase64);
  await facilitator.setBalance(buyerId, overrides.balance ?? 10_000n);

  const validUntil = new Date(Date.now() + 15 * 60 * 1000);
  const signed = signPayment(payer.privateKey, {
    nonce: paymentNonce,
    payerId: buyerId,
    payerPublicKey: payer.publicKeyBase64,
    payTo: sellerId,
    asset: "near",
    amount: "1000",
    validUntil: validUntil.toISOString(),
    maxBlockHeight: 100,
  });
  // Consume the nonce through verify() the same way the gateway would have, so settle() isn't the first thing touching it.
  await facilitator.verify(signed, {
    scheme: "exact",
    network: "near:testnet",
    asset: "near",
    maxAmountRequired: "1000",
    payTo: sellerId,
    resource: `/v1/listings/${listingId}/evaluate`,
    validUntil: validUntil.toISOString(),
    nonce: paymentNonce,
  });

  await prisma.payment.create({
    data: {
      runId,
      nonce: paymentNonce,
      payerId: buyerId,
      payerPublicKey: payer.publicKeyBase64,
      payTo: sellerId,
      asset: "near",
      amount: "1000",
      validUntil,
      maxBlockHeight: 100,
      status: "verified",
      signedPayload: Buffer.from(signed.signedDelegate, "base64"),
    },
  });

  return { runId, listingId, paymentNonce, buyerId, sellerId };
}
