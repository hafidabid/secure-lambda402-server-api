import { PrismaClient } from "@securelambda/db";
import { NearFacilitator, NearRpcChain, SandboxFacilitator, type FacilitatorPort } from "@securelambda/facilitator";
import { RUN_QUEUE_NAME, type RunJobData } from "@securelambda/schemas";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { LocalEvaluatorClient } from "./local-evaluator-client";
import { MockOutLayerClient } from "./mock-outlayer-client";
import type { OutLayerClient } from "./outlayer-client";
import { RunProcessor } from "./run-processor";
import { S3StorageClient } from "./storage-client";

const SETTLE_RETRY_INTERVAL_MS = 30_000;

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this configuration`);
  return value;
}

/** FACILITATOR_MODE=near settles real NEP-366 payments on NEAR; anything else uses the Redis sandbox ledger. */
function buildFacilitator(redis: Redis): FacilitatorPort {
  if (process.env.FACILITATOR_MODE !== "near") return new SandboxFacilitator(redis);
  const chain = new NearRpcChain({
    rpcUrl: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
    networkId: process.env.NEAR_NETWORK ?? "testnet",
    relayerAccountId: need("RELAYER_ACCOUNT"),
    relayerPrivateKey: need("RELAYER_KEY"),
  });
  return new NearFacilitator(redis, chain, [need("PAYMENT_TOKEN_CONTRACT")]);
}

/**
 * EVALUATOR_MODE picks who scores the run:
 *  - "mock" (default): canned metrics, used by the state-machine tests.
 *  - "local": the real Rust evaluator binary on this machine. Real decryption and scoring,
 *    but no hardware enclave, so runs are labelled mode="local" and never "attested".
 * There is no OutLayer TEE client yet; see docs/ and the README "What is real".
 */
function buildEvaluator(): OutLayerClient {
  if (process.env.EVALUATOR_MODE !== "local") return new MockOutLayerClient();
  return new LocalEvaluatorClient({
    binaryPath: need("EVALUATOR_BIN"),
    privateKeyBase64: need("EVALUATOR_PRIVATE_KEY"),
    wasmHash: need("EVALUATOR_WASM_HASH"),
  });
}

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const prisma = new PrismaClient();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const facilitatorRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const processor = new RunProcessor({
    prisma,
    redis,
    outlayer: buildEvaluator(),
    facilitator: buildFacilitator(facilitatorRedis),
    storage: new S3StorageClient({
      endpoint: process.env.STORAGE_ENDPOINT ?? "http://localhost:9000",
      region: process.env.STORAGE_REGION ?? "us-east-1",
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? "securelambda",
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? "securelambda123",
      bucket: process.env.STORAGE_BUCKET ?? "securelambda-assets",
      keyPrefix: process.env.STORAGE_KEY_PREFIX,
    }),
  });

  const worker = new Worker<RunJobData>(
    RUN_QUEUE_NAME,
    async (job) => {
      await processor.processRun(job.data.runId);
    },
    { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) },
  );

  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`run job ${job?.id} failed`, err);
  });

  const settleRetryTimer = setInterval(async () => {
    const pending = await prisma.run.findMany({ where: { state: "SETTLE_PENDING" }, select: { id: true } });
    for (const run of pending) {
      await processor.retrySettlement(run.id);
    }
  }, SETTLE_RETRY_INTERVAL_MS);

  // eslint-disable-next-line no-console
  console.log(`worker listening on queue "${RUN_QUEUE_NAME}"`);

  const shutdown = async () => {
    clearInterval(settleRetryTimer);
    await worker.close();
    await redis.quit();
    await facilitatorRedis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("worker failed to start", err);
  process.exit(1);
});
