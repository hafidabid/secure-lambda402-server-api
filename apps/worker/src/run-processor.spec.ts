import { execSync } from "node:child_process";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { PrismaClient } from "@securelambda/db";
import { SandboxFacilitator } from "@securelambda/facilitator";
import Redis from "ioredis";
import { RunProcessor } from "./run-processor";
import { MockOutLayerClient } from "./mock-outlayer-client";
import { InMemoryStorageClient, createRunFixture, WASM_HASH } from "./test-fixtures";

describe("RunProcessor (component test against real Postgres + Redis)", () => {
  let pg: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let prisma: PrismaClient;
  let redis: Redis;
  let facilitatorRedis: Redis;
  let outlayer: MockOutLayerClient;
  let facilitator: SandboxFacilitator;
  let storage: InMemoryStorageClient;
  let processor: RunProcessor;

  beforeAll(async () => {
    pg = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "securelambda", POSTGRES_PASSWORD: "securelambda", POSTGRES_DB: "securelambda" })
      .withExposedPorts(5432)
      .start();
    const databaseUrl = `postgres://securelambda:securelambda@${pg.getHost()}:${pg.getMappedPort(5432)}/securelambda`;

    const dbPackageDir = path.resolve(__dirname, "../../../packages/db");
    execSync("npx prisma migrate deploy", { cwd: dbPackageDir, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    redisContainer = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    redis = new Redis({ host: redisContainer.getHost(), port: redisContainer.getMappedPort(6379) });
    facilitatorRedis = new Redis({ host: redisContainer.getHost(), port: redisContainer.getMappedPort(6379) });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
    await facilitatorRedis.quit();
    await pg.stop();
    await redisContainer.stop();
  }, 60_000);

  beforeEach(() => {
    outlayer = new MockOutLayerClient();
    facilitator = new SandboxFacilitator(facilitatorRedis);
    storage = new InMemoryStorageClient();
    processor = new RunProcessor({
      prisma,
      redis,
      outlayer,
      facilitator,
      storage,
      pollIntervalMs: 15,
      pollDeadlineMs: 80,
      backgroundPollDeadlineMs: 400,
    });
  });

  it("RN-01: happy path — states are recorded in order, result stored, settled", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "ok" });

    await processor.processRun(fixture.runId);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("SETTLED");
    expect(run.resultJson).toMatchObject({ metrics: { accuracy: 0.83 } });

    const events = await prisma.runEvent.findMany({ where: { runId: fixture.runId }, orderBy: { id: "asc" } });
    expect(events.map((e) => e.toState)).toEqual(["SUBMITTED", "RESULT_READY", "SETTLED"]);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { runId: fixture.runId } });
    expect(payment.status).toBe("settled");
    expect(await facilitator.getBalance(fixture.sellerId)).toBe(1_000n);
  });

  it("RN-02: an RPC timeout that eventually succeeds is never shown as a failure", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "timeout_then_success", pendingPollsBeforeDone: 2 });

    await processor.processRun(fixture.runId);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("SETTLED");
  });

  it("RN-03: a transient failure followed by success settles with exactly one settlement", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "transient_then_success" });

    await processor.processRun(fixture.runId);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("SETTLED");
    expect(run.attempt).toBe(1);
    expect(await facilitator.getBalance(fixture.sellerId)).toBe(1_000n);
  });

  it("RN-04: the tx hash is persisted while the run is SUBMITTED, before any polling", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "hang" }); // never completes within this test's short run

    // Run just the submit phase by racing a very short background deadline.
    const shortProcessor = new RunProcessor({ prisma, redis, outlayer, facilitator, storage, pollIntervalMs: 10, pollDeadlineMs: 20, backgroundPollDeadlineMs: 30 });
    await shortProcessor.processRun(fixture.runId);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.execTxHash).toBeTruthy();
  });

  it("RN-06: a transient failure that never recovers ends FAILED_NOT_CHARGED after exhausting retries, with no settlement", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "transient_always" });

    await processor.processRun(fixture.runId);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("FAILED_NOT_CHARGED");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { runId: fixture.runId } });
    expect(payment.status).toBe("verified"); // never settled
    expect(await facilitator.getBalance(fixture.sellerId)).toBe(0n);
  });

  it("RN-07: a deterministic evaluator failure is never retried and ends FAILED_NOT_CHARGED immediately", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "deterministic_failure", errorCode: "DATA_UNUSABLE" });

    await processor.processRun(fixture.runId);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("FAILED_NOT_CHARGED");
    expect(run.errorCode).toBe("DATA_UNUSABLE");
    expect(run.attempt).toBe(0); // no retry happened
  });

  it("RN-08: a wasm hash mismatch blocks settlement and pauses the listing", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "wrong_wasm_hash" });

    await processor.processRun(fixture.runId);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("FAILED_NOT_CHARGED");
    expect(run.errorCode).toBe("EVALUATOR_MISMATCH");

    const attestation = await prisma.attestation.findUniqueOrThrow({ where: { runId: fixture.runId } });
    expect(attestation.verified).toBe(false);

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: fixture.listingId } });
    expect(listing.status).toBe("paused");

    expect(await facilitator.getBalance(fixture.sellerId)).toBe(0n);
  });

  it("confirms the real wasm hash matches and settles normally when it does", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "ok", wasmHash: WASM_HASH });

    await processor.processRun(fixture.runId);

    const attestation = await prisma.attestation.findUniqueOrThrow({ where: { runId: fixture.runId } });
    expect(attestation.verified).toBe(true);
    expect(attestation.wasmHash).toBe(WASM_HASH);
  });

  it("RN-14: a duplicate concurrent call for the same run results in exactly one execution", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "ok" });

    await Promise.all([processor.processRun(fixture.runId), processor.processRun(fixture.runId)]);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("SETTLED");
    expect(await facilitator.getBalance(fixture.sellerId)).toBe(1_000n); // not double-paid
  });

  it("RN-15/RN-16: a run that never completes within the background deadline ends FAILED_NOT_CHARGED, not stuck forever", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    outlayer.setScript(fixture.runId, { script: "hang" });

    await processor.processRun(fixture.runId);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("FAILED_NOT_CHARGED");
    expect(run.errorCode).toBe("RUN_TIMEOUT_UNKNOWN");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { runId: fixture.runId } });
    expect(payment.status).toBe("verified");
  }, 15_000);

  it("retrySettlement moves a SETTLE_PENDING run to SETTLED once the relayer has gas again", async () => {
    const fixture = await createRunFixture(prisma, storage, facilitator);
    await facilitator.setRelayerHasGas(false);
    outlayer.setScript(fixture.runId, { script: "ok" });

    await processor.processRun(fixture.runId);
    let run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("SETTLE_PENDING");

    await facilitator.setRelayerHasGas(true);
    await processor.retrySettlement(fixture.runId);

    run = await prisma.run.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.state).toBe("SETTLED");
  });
});
