import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { RunsController, SellerRunsController } from "./runs.controller";
import { RunsService } from "./runs.service";
import { PrismaService } from "../common/prisma.service";
import { RunSchema, ReceiptSchema } from "@securelambda/schemas";

describe("RunsController", () => {
  let controller: RunsController;
  let service: RunsService;

  // Mock PrismaService
  const mockPrisma = {
    run: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    listing: {
      findMany: jest.fn(),
    },
    attestation: {
      findUnique: jest.fn(),
    },
    payment: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RunsController],
      providers: [
        RunsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    controller = module.get<RunsController>(RunsController);
    service = module.get<RunsService>(RunsService);
  });

  const createBaseRun = (overrides?: any) => ({
    id: "run_123",
    listingId: "lst_456",
    buyerId: "buyer_789",
    modelId: "model_101",
    state: "EXECUTING",
    paymentNonce: "nonce_12345",
    attempt: 0,
    execTxHash: "0xabc123",
    resultJson: null,
    errorCode: null,
    mode: "enclave",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  });

  describe("GET /v1/runs/:id", () => {
    it("AUTH: a run is invisible (404) to any account other than the buyer who paid", async () => {
      mockPrisma.run.findUnique.mockResolvedValue(createBaseRun());

      await expect(controller.getRun("run_123", "someone_else")).rejects.toThrow(NotFoundException);
      await expect(controller.getReceipt("run_123", "someone_else")).rejects.toThrow(NotFoundException);
      await expect(controller.runEvents("run_123", "someone_else")).rejects.toThrow(NotFoundException);
    });

    it("RN-01 (positive): returns a run with null resultJson", async () => {
      const mockRun = createBaseRun();
      mockPrisma.run.findUnique.mockResolvedValue(mockRun);

      const result = await controller.getRun("run_123", "buyer_789");

      // Verify result is valid RunSchema
      expect(() => RunSchema.parse(result)).not.toThrow();

      // Verify field mapping
      expect(result.id).toBe("run_123");
      expect(result.listing_id).toBe("lst_456");
      expect(result.buyer_id).toBe("buyer_789");
      expect(result.model_id).toBe("model_101");
      expect(result.state).toBe("EXECUTING");
      expect(result.payment_nonce).toBe("nonce_12345");
      expect(result.attempt).toBe(0);
      expect(result.exec_tx_hash).toBe("0xabc123");
      expect(result.result).toBeNull();
      expect(result.error_code).toBeNull();
      expect(result.mode).toBe("enclave");
      expect(result.created_at).toBe("2024-01-01T00:00:00.000Z");
      expect(result.updated_at).toBe("2024-01-01T00:00:00.000Z");
    });

    it("RN-01 (positive): returns a run with populated resultJson", async () => {
      const mockRun = createBaseRun({
        state: "SETTLED",
        resultJson: {
          metrics: {
            accuracy: 0.92,
            auc: 0.88,
            f1: 0.90,
          },
          n_bucket: "500-999",
        },
      });
      mockPrisma.run.findUnique.mockResolvedValue(mockRun);

      const result = await controller.getRun("run_123", "buyer_789");

      // Verify result is valid RunSchema
      expect(() => RunSchema.parse(result)).not.toThrow();

      // Verify result field is populated
      expect(result.result).not.toBeNull();
      if (result.result) {
        expect(result.result.metrics.accuracy).toBe(0.92);
        expect(result.result.metrics.auc).toBe(0.88);
        expect(result.result.metrics.f1).toBe(0.90);
        expect(result.result.n_bucket).toBe("500-999");
      }
    });

    it("RN-01 (negative): non-existent run throws NotFoundException (404)", async () => {
      mockPrisma.run.findUnique.mockResolvedValue(null);

      await expect(controller.getRun("nonexistent", "buyer_789")).rejects.toThrow(NotFoundException);
    });
  });

  describe("GET /v1/runs/:id/receipt", () => {
    it("RN-* (positive): receipt with attestation and payment", async () => {
      const mockRun = createBaseRun({
        execTxHash: "0xexec123",
      });
      const mockAttestation = {
        runId: "run_123",
        wasmHash: "abc123def456abc123def456abc123def456abc123def456abc123def456ab",
        verified: true,
      };
      const mockPayment = {
        runId: "run_123",
        settleTxHash: "0xsettle456",
      };

      mockPrisma.run.findUnique.mockResolvedValue(mockRun);
      mockPrisma.attestation.findUnique.mockResolvedValue(mockAttestation);
      mockPrisma.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await controller.getReceipt("run_123", "buyer_789");

      // Verify result is valid ReceiptSchema
      expect(() => ReceiptSchema.parse(result)).not.toThrow();

      expect(result.exec_tx).toBe("0xexec123");
      expect(result.settle_tx).toBe("0xsettle456");
      expect(result.wasm_hash).toBe("abc123def456abc123def456abc123def456abc123def456abc123def456ab");
      expect(result.attested).toBe(true);
    });

    it("RN-* (positive): receipt with defaults when attestation doesn't exist yet (run in progress)", async () => {
      const mockRun = createBaseRun({
        execTxHash: "0xexec123",
      });
      mockPrisma.run.findUnique.mockResolvedValue(mockRun);
      mockPrisma.attestation.findUnique.mockResolvedValue(null);
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      const result = await controller.getReceipt("run_123", "buyer_789");

      // Verify result is valid ReceiptSchema
      expect(() => ReceiptSchema.parse(result)).not.toThrow();

      expect(result.exec_tx).toBe("0xexec123");
      expect(result.settle_tx).toBeNull();
      expect(result.wasm_hash).toBe("");
      expect(result.attested).toBe(false);
    });

    it("RN-* (positive): receipt with only exec_tx_hash when no attestation but payment exists", async () => {
      const mockRun = createBaseRun({
        execTxHash: null,
      });
      const mockPayment = {
        runId: "run_123",
        settleTxHash: null,
      };

      mockPrisma.run.findUnique.mockResolvedValue(mockRun);
      mockPrisma.attestation.findUnique.mockResolvedValue(null);
      mockPrisma.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await controller.getReceipt("run_123", "buyer_789");

      expect(result.exec_tx).toBe("");
      expect(result.settle_tx).toBeNull();
      expect(result.wasm_hash).toBe("");
      expect(result.attested).toBe(false);
    });

    it("RN-* (negative): non-existent run throws NotFoundException (404)", async () => {
      mockPrisma.run.findUnique.mockResolvedValue(null);

      await expect(controller.getReceipt("nonexistent", "buyer_789")).rejects.toThrow(NotFoundException);
    });
  });

  describe("GET /v1/runs/:id/events", () => {
    it("SSE (positive): emits run state updates and completes on terminal state", (done) => {
      // Set a short poll interval for testing
      controller.setSseInterval(10);

      let callCount = 0;
      const runStates = ["EXECUTING", "EXECUTING", "EXECUTING", "SETTLED"]; // the first read is the ownership check

      mockPrisma.run.findUnique.mockImplementation(() => {
        const state = runStates[Math.min(callCount, runStates.length - 1)];
        callCount++;
        return Promise.resolve(
          createBaseRun({
            state,
          }),
        );
      });

      controller.runEvents("run_123", "buyer_789").then((observable) => {
      const events: any[] = [];

      observable.subscribe({
        next: (event) => {
          events.push(event);
        },
        error: (err) => {
          done(err);
        },
        complete: () => {
          try {
            // Verify we got at least 3 events (two EXECUTING, one SETTLED)
            expect(events.length).toBeGreaterThanOrEqual(3);

            // Verify the last event is in terminal state
            const lastEvent = events[events.length - 1];
            expect(lastEvent.data.state).toBe("SETTLED");

            // Verify all events are valid RunSchema
            events.forEach((event) => {
              expect(() => RunSchema.parse(event.data)).not.toThrow();
            });

            done();
          } catch (err) {
            done(err);
          }
        },
      });
      }).catch(done);
    });

    it("SSE (positive): emits FAILED_NOT_CHARGED as terminal state", (done) => {
      controller.setSseInterval(10);

      let callCount = 0;
      const runStates = ["EXECUTING", "FAILED_NOT_CHARGED"];

      mockPrisma.run.findUnique.mockImplementation(() => {
        const state = runStates[Math.min(callCount, runStates.length - 1)];
        callCount++;
        return Promise.resolve(
          createBaseRun({
            state,
          }),
        );
      });

      controller.runEvents("run_123", "buyer_789").then((observable) => {
      const events: any[] = [];

      observable.subscribe({
        next: (event) => {
          events.push(event);
        },
        error: (err) => {
          done(err);
        },
        complete: () => {
          try {
            const lastEvent = events[events.length - 1];
            expect(lastEvent.data.state).toBe("FAILED_NOT_CHARGED");
            done();
          } catch (err) {
            done(err);
          }
        },
      });
      }).catch(done);
    });

    it("SSE (positive): emits PAYMENT_REJECTED as terminal state", (done) => {
      controller.setSseInterval(10);

      let callCount = 0;
      const runStates = ["REQUESTED", "PAYMENT_REJECTED"];

      mockPrisma.run.findUnique.mockImplementation(() => {
        const state = runStates[Math.min(callCount, runStates.length - 1)];
        callCount++;
        return Promise.resolve(
          createBaseRun({
            state,
          }),
        );
      });

      controller.runEvents("run_123", "buyer_789").then((observable) => {
      const events: any[] = [];

      observable.subscribe({
        next: (event) => {
          events.push(event);
        },
        error: (err) => {
          done(err);
        },
        complete: () => {
          try {
            const lastEvent = events[events.length - 1];
            expect(lastEvent.data.state).toBe("PAYMENT_REJECTED");
            done();
          } catch (err) {
            done(err);
          }
        },
      });
      }).catch(done);
    });
  });


  describe("GET /v1/runs/:id (field mapping)", () => {
    it("maps camelCase DB fields to snake_case JSON", async () => {
      const mockRun = createBaseRun();
      mockPrisma.run.findUnique.mockResolvedValue(mockRun);

      const result = await controller.getRun("run_123", "buyer_789");

      // Verify no camelCase fields exist
      expect(result).not.toHaveProperty("listingId");
      expect(result).not.toHaveProperty("buyerId");
      expect(result).not.toHaveProperty("modelId");
      expect(result).not.toHaveProperty("paymentNonce");
      expect(result).not.toHaveProperty("execTxHash");
      expect(result).not.toHaveProperty("resultJson");
      expect(result).not.toHaveProperty("errorCode");
      expect(result).not.toHaveProperty("createdAt");
      expect(result).not.toHaveProperty("updatedAt");

      // Verify snake_case fields exist
      expect(result).toHaveProperty("listing_id");
      expect(result).toHaveProperty("buyer_id");
      expect(result).toHaveProperty("model_id");
      expect(result).toHaveProperty("payment_nonce");
      expect(result).toHaveProperty("exec_tx_hash");
      expect(result).toHaveProperty("result");
      expect(result).toHaveProperty("error_code");
      expect(result).toHaveProperty("created_at");
      expect(result).toHaveProperty("updated_at");
    });
  });

  describe("GET /v1/runs/:id (null handling)", () => {
    it("converts null execTxHash to null in response", async () => {
      const mockRun = createBaseRun({
        execTxHash: null,
      });
      mockPrisma.run.findUnique.mockResolvedValue(mockRun);

      const result = await controller.getRun("run_123", "buyer_789");

      expect(result.exec_tx_hash).toBeNull();
    });

    it("converts null errorCode to null in response", async () => {
      const mockRun = createBaseRun({
        errorCode: null,
      });
      mockPrisma.run.findUnique.mockResolvedValue(mockRun);

      const result = await controller.getRun("run_123", "buyer_789");

      expect(result.error_code).toBeNull();
    });
  });
});

describe("SellerRunsController", () => {
  let controller: SellerRunsController;
  let service: RunsService;

  // Mock PrismaService
  const mockPrisma = {
    run: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    listing: {
      findMany: jest.fn(),
    },
    attestation: {
      findUnique: jest.fn(),
    },
    payment: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SellerRunsController],
      providers: [
        RunsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    controller = module.get<SellerRunsController>(SellerRunsController);
    service = module.get<RunsService>(RunsService);
  });

  const createBaseRun = (overrides?: any) => ({
    id: "run_123",
    listingId: "lst_456",
    buyerId: "buyer_789",
    modelId: "model_101",
    state: "EXECUTING",
    paymentNonce: "nonce_12345",
    attempt: 0,
    execTxHash: "0xabc123",
    resultJson: null,
    errorCode: null,
    mode: "enclave",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  });

  describe("GET /v1/seller/runs", () => {
    it("US-10 (positive): returns seller's runs without result field", async () => {
      const accountId = "seller_123";

      // Mock listing query
      mockPrisma.listing.findMany.mockResolvedValue([
        { id: "lst_1" },
        { id: "lst_2" },
      ]);

      // Mock runs query
      mockPrisma.run.findMany.mockResolvedValue([
        createBaseRun({
          id: "run_1",
          listingId: "lst_1",
          buyerId: "buyer_1",
          state: "SETTLED",
          resultJson: { metrics: { accuracy: 0.95, auc: 0.90, f1: 0.92 }, n_bucket: "500-999" },
        }),
        createBaseRun({
          id: "run_2",
          listingId: "lst_2",
          buyerId: "buyer_2",
          state: "EXECUTING",
          resultJson: null,
        }),
      ]);

      const result = await controller.getSellerRuns(accountId);

      // Verify returns array
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      // Verify no result field in any item
      result.forEach((item) => {
        expect(Object.keys(item)).not.toContain("result");
        expect(Object.keys(item)).not.toContain("resultJson");
        expect(Object.keys(item)).toContain("id");
        expect(Object.keys(item)).toContain("buyer_id");
        expect(Object.keys(item)).toContain("state");
        expect(Object.keys(item)).toContain("created_at");
      });

      // Verify first item
      expect(result[0].id).toBe("run_1");
      expect(result[0].buyer_id).toBe("buyer_1");
      expect(result[0].state).toBe("SETTLED");

      // Verify second item
      expect(result[1].id).toBe("run_2");
      expect(result[1].buyer_id).toBe("buyer_2");
      expect(result[1].state).toBe("EXECUTING");
    });

    it("US-10 (positive): no runs for seller with no listings", async () => {
      const accountId = "seller_empty";

      mockPrisma.listing.findMany.mockResolvedValue([]);

      const result = await controller.getSellerRuns(accountId);

      expect(result).toEqual([]);
    });

    it("US-10 (positive): seller runs are ordered by createdAt descending", async () => {
      const accountId = "seller_123";

      mockPrisma.listing.findMany.mockResolvedValue([{ id: "lst_1" }]);

      mockPrisma.run.findMany.mockResolvedValue([
        createBaseRun({
          id: "run_3",
          createdAt: new Date("2024-01-03T00:00:00Z"),
        }),
        createBaseRun({
          id: "run_1",
          createdAt: new Date("2024-01-01T00:00:00Z"),
        }),
        createBaseRun({
          id: "run_2",
          createdAt: new Date("2024-01-02T00:00:00Z"),
        }),
      ]);

      const result = await controller.getSellerRuns(accountId);

      // Verify findMany was called with correct orderBy
      expect(mockPrisma.run.findMany).toHaveBeenCalledWith({
        where: { listingId: { in: ["lst_1"] } },
        orderBy: { createdAt: "desc" },
      });

      // Verify the runs are in the order returned by Prisma (which should be desc)
      expect(result[0].id).toBe("run_3");
      expect(result[1].id).toBe("run_1");
      expect(result[2].id).toBe("run_2");
    });

    it("US-10 (privacy): never returns result/metrics even when present in DB", async () => {
      const accountId = "seller_123";

      mockPrisma.listing.findMany.mockResolvedValue([{ id: "lst_1" }]);

      mockPrisma.run.findMany.mockResolvedValue([
        createBaseRun({
          id: "run_1",
          state: "SETTLED",
          resultJson: {
            metrics: { accuracy: 0.99, auc: 0.98, f1: 0.98 },
            n_bucket: "1000+",
          },
        }),
      ]);

      const result = await controller.getSellerRuns(accountId);

      expect(result.length).toBe(1);
      expect(result[0]).not.toHaveProperty("result");
      expect(result[0]).not.toHaveProperty("resultJson");
      expect(result[0]).not.toHaveProperty("metrics");
      expect(result[0]).not.toHaveProperty("auc");
      expect(result[0]).not.toHaveProperty("f1");
      expect(result[0]).not.toHaveProperty("accuracy");
    });
  });
});
