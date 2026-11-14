import { PrismaClient } from "@securelambda/db";
import { SandboxFacilitator } from "@securelambda/facilitator";
import { RUN_QUEUE_NAME, type RunJobData } from "@securelambda/schemas";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { MockOutLayerClient } from "./mock-outlayer-client";
import { RunProcessor } from "./run-processor";
import { S3StorageClient } from "./storage-client";

const SETTLE_RETRY_INTERVAL_MS = 30_000;

/**
 * This build has no live OutLayer/NEAR credentials (docs/01: "Still to
 * confirm... Appendix A" was a real experiment run by the original team,
 * not something reproducible here). The worker therefore runs against
 * MockOutLayerClient by default — the orchestration logic (state machine,
 * retries, settlement) is real and tested; only the TEE call itself is a
 * stand-in, per docs/05 section 7.1 seam I5's own "mock first" design.
 */
async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const prisma = new PrismaClient();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const facilitatorRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const processor = new RunProcessor({
    prisma,
    redis,
    outlayer: new MockOutLayerClient(),
    facilitator: new SandboxFacilitator(facilitatorRedis),
    storage: new S3StorageClient({
      endpoint: process.env.STORAGE_ENDPOINT ?? "http://localhost:9000",
      region: process.env.STORAGE_REGION ?? "us-east-1",
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? "securelambda",
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? "securelambda123",
      bucket: process.env.STORAGE_BUCKET ?? "securelambda-assets",
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
