import { Test, TestingModule } from "@nestjs/testing";
import { AssetsService } from "./assets.service";
import { PrismaService } from "../common/prisma.service";
import { StorageService } from "../common/storage.service";
import { ApiError, MAX_UPLOAD_BYTES_TONIGHT } from "@securelambda/schemas";
import { randomUUID } from "crypto";

describe("AssetsService", () => {
  let service: AssetsService;
  let prisma: any;
  let storage: any;

  const createValidWrappedKey = (listingId: string, role: string, sha256: string) => ({
    v: 1,
    epk: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    nonce: "AAAAAAAAAAAAAAAAAAA=",
    ct: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    aad_ctx: {
      listing: listingId,
      role,
      ev: "v1",
      ct_sha256: sha256,
    },
  });

  beforeEach(async () => {
    // Hand-written mock PrismaService
    prisma = {
      evaluatorVersion: {
        findFirst: jest.fn(),
      },
      listing: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      asset: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      model: {
        create: jest.fn(),
      },
    };

    // Hand-written mock StorageService
    storage = {
      putCiphertext: jest.fn().mockResolvedValue(undefined),
      getCiphertext: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: StorageService,
          useValue: storage,
        },
      ],
    }).compile();

    service = module.get<AssetsService>(AssetsService);
  });

  describe("getEvaluatorMetadata", () => {
    it("AP-04: should return evaluator metadata with base64 public_key", async () => {
      const mockEvaluator = {
        version: "v1.0.0",
        projectId: "proj_123",
        wasmHash: "a".repeat(64),
        publicKey: Buffer.from("hello world"),
        trustTier: 1,
        active: true,
        createdAt: new Date(),
      };

      prisma.evaluatorVersion.findFirst.mockResolvedValue(mockEvaluator);

      const result = await service.getEvaluatorMetadata();

      expect(result.version).toBe("v1.0.0");
      expect(result.project_id).toBe("proj_123");
      expect(result.wasm_hash).toBe("a".repeat(64));
      expect(result.public_key).toBe("aGVsbG8gd29ybGQ="); // base64
      expect(typeof result.public_key).toBe("string");
      expect(result.trust_tier).toBe(1);
    });

    it("should throw INTERNAL if no active evaluator found", async () => {
      prisma.evaluatorVersion.findFirst.mockResolvedValue(null);

      await expect(service.getEvaluatorMetadata()).rejects.toThrow(ApiError);

      try {
        await service.getEvaluatorMetadata();
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("INTERNAL");
        }
      }
    });
  });

  describe("uploadDataset", () => {
    it("AP-02: should handle idempotent asset creation - same bytes returns same asset_id", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const sha256 = "a".repeat(64);
      const fileBuffer = Buffer.from("same ciphertext bytes");
      const wrappedKey = createValidWrappedKey(listingId, "dataset", sha256);

      const existingAsset = {
        id: `ast_${randomUUID()}`,
        ownerId: accountId,
        kind: "dataset",
        sha256,
        sizeBytes: BigInt(fileBuffer.length),
        storageKey: `ast_${randomUUID()}`,
        createdAt: new Date(),
      };

      // First call succeeds
      const listing = {
        id: listingId,
        sellerId: accountId,
        evaluatorVersion: "v1",
      };

      prisma.listing.findUnique.mockResolvedValue(listing);
      prisma.asset.create.mockResolvedValueOnce({
        ...existingAsset,
        id: existingAsset.id,
      });
      prisma.listing.update.mockResolvedValue(listing);

      const result1 = await service.uploadDataset(listingId, accountId, fileBuffer, wrappedKey);

      expect(result1.asset_id).toBe(existingAsset.id);
      expect(storage.putCiphertext).toHaveBeenCalledTimes(1);
      expect(storage.putCiphertext).toHaveBeenCalledWith(
        expect.any(String),
        fileBuffer,
      );

      // Reset mocks for second call
      storage.putCiphertext.mockClear();

      // Second call with same bytes hits P2002 unique constraint, then finds existing
      prisma.asset.create.mockRejectedValueOnce({ code: "P2002" });
      prisma.asset.findUnique.mockResolvedValueOnce(existingAsset);

      const result2 = await service.uploadDataset(listingId, accountId, fileBuffer, wrappedKey);

      expect(result2.asset_id).toBe(existingAsset.id);
      expect(storage.putCiphertext).toHaveBeenCalledTimes(0); // Should NOT upload again
    });

    it("VA-26: should throw ASSET_TOO_LARGE if file exceeds size limit", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const sha256 = "b".repeat(64);
      const oversizeBuffer = Buffer.alloc(MAX_UPLOAD_BYTES_TONIGHT + 1);
      const wrappedKey = createValidWrappedKey(listingId, "dataset", sha256);

      const listing = {
        id: listingId,
        sellerId: accountId,
        evaluatorVersion: "v1",
      };

      prisma.listing.findUnique.mockResolvedValue(listing);

      await expect(
        service.uploadDataset(listingId, accountId, oversizeBuffer, wrappedKey),
      ).rejects.toThrow(ApiError);

      try {
        await service.uploadDataset(listingId, accountId, oversizeBuffer, wrappedKey);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("ASSET_TOO_LARGE");
        }
      }

      // Storage should never be called
      expect(storage.putCiphertext).not.toHaveBeenCalled();
    });

    it("AP-08: should throw ENVELOPE_INVALID for missing aad_ctx", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const fileBuffer = Buffer.from("test");

      const invalidEnvelope = {
        v: 1,
        epk: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        nonce: "AAAAAAAAAAAAAAAAAAA=",
        ct: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
        // missing aad_ctx
      };

      const listing = {
        id: listingId,
        sellerId: accountId,
        evaluatorVersion: "v1",
      };

      prisma.listing.findUnique.mockResolvedValue(listing);

      await expect(
        service.uploadDataset(listingId, accountId, fileBuffer, invalidEnvelope),
      ).rejects.toThrow(ApiError);

      try {
        await service.uploadDataset(listingId, accountId, fileBuffer, invalidEnvelope);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("ENVELOPE_INVALID");
        }
      }
    });

    it("should throw FORBIDDEN if listing not owned by uploader", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const otherAccountId = `acc_${randomUUID()}`;
      const sha256 = "c".repeat(64);
      const fileBuffer = Buffer.from("test");
      const wrappedKey = createValidWrappedKey(listingId, "dataset", sha256);

      const listing = {
        id: listingId,
        sellerId: otherAccountId, // Different owner
        evaluatorVersion: "v1",
      };

      prisma.listing.findUnique.mockResolvedValue(listing);

      await expect(
        service.uploadDataset(listingId, accountId, fileBuffer, wrappedKey),
      ).rejects.toThrow(ApiError);

      try {
        await service.uploadDataset(listingId, accountId, fileBuffer, wrappedKey);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("FORBIDDEN");
        }
      }
    });

    it("should throw LISTING_NOT_FOUND if listing does not exist", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const sha256 = "d".repeat(64);
      const fileBuffer = Buffer.from("test");
      const wrappedKey = createValidWrappedKey(listingId, "dataset", sha256);

      prisma.listing.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadDataset(listingId, accountId, fileBuffer, wrappedKey),
      ).rejects.toThrow(ApiError);

      try {
        await service.uploadDataset(listingId, accountId, fileBuffer, wrappedKey);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("LISTING_NOT_FOUND");
        }
      }
    });
  });

  describe("uploadModel", () => {
    it("should upload model with valid envelope and create Model record", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const sha256 = "e".repeat(64);
      const fileBuffer = Buffer.from("model ciphertext");
      const wrappedKey = createValidWrappedKey(listingId, "model", sha256);

      const listing = {
        id: listingId,
        sellerId: "seller_id",
        evaluatorVersion: "v1.0.0",
      };

      const asset = {
        id: `ast_${randomUUID()}`,
        ownerId: accountId,
        kind: "model",
        sha256,
        sizeBytes: BigInt(fileBuffer.length),
        storageKey: `ast_${randomUUID()}`,
        createdAt: new Date(),
      };

      const modelId = `mdl_${randomUUID()}`;

      prisma.listing.findUnique.mockResolvedValue(listing);
      prisma.asset.create.mockResolvedValue(asset);
      prisma.model.create.mockResolvedValue({
        id: modelId,
        buyerId: accountId,
        listingId,
        assetId: asset.id,
        wrappedKey,
        evaluatorVersion: "v1.0.0",
        createdAt: new Date(),
      });

      const result = await service.uploadModel(listingId, accountId, fileBuffer, wrappedKey);

      expect(result.model_id).toBe(modelId);
      expect(prisma.model.create).toHaveBeenCalledWith({
        data: {
          id: expect.stringMatching(/^mdl_/),
          buyerId: accountId,
          listingId,
          assetId: asset.id,
          wrappedKey,
          evaluatorVersion: "v1.0.0",
        },
      });
    });

    it("VA-26: should throw ASSET_TOO_LARGE for models too", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const sha256 = "f".repeat(64);
      const oversizeBuffer = Buffer.alloc(MAX_UPLOAD_BYTES_TONIGHT + 1);
      const wrappedKey = createValidWrappedKey(listingId, "model", sha256);

      const listing = {
        id: listingId,
        sellerId: "seller_id",
        evaluatorVersion: "v1",
      };

      prisma.listing.findUnique.mockResolvedValue(listing);

      await expect(
        service.uploadModel(listingId, accountId, oversizeBuffer, wrappedKey),
      ).rejects.toThrow(ApiError);

      try {
        await service.uploadModel(listingId, accountId, oversizeBuffer, wrappedKey);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("ASSET_TOO_LARGE");
        }
      }

      expect(storage.putCiphertext).not.toHaveBeenCalled();
    });

    it("should throw LISTING_NOT_FOUND if listing does not exist", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const sha256 = "g".repeat(64);
      const fileBuffer = Buffer.from("test");
      const wrappedKey = createValidWrappedKey(listingId, "model", sha256);

      prisma.listing.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadModel(listingId, accountId, fileBuffer, wrappedKey),
      ).rejects.toThrow(ApiError);

      try {
        await service.uploadModel(listingId, accountId, fileBuffer, wrappedKey);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("LISTING_NOT_FOUND");
        }
      }
    });

    it("AP-08: should throw ENVELOPE_INVALID for invalid model envelope", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const fileBuffer = Buffer.from("test");

      const invalidEnvelope = {
        v: 1,
        epk: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        // missing required fields
      };

      const listing = {
        id: listingId,
        sellerId: "seller_id",
        evaluatorVersion: "v1",
      };

      prisma.listing.findUnique.mockResolvedValue(listing);

      await expect(
        service.uploadModel(listingId, accountId, fileBuffer, invalidEnvelope),
      ).rejects.toThrow(ApiError);

      try {
        await service.uploadModel(listingId, accountId, fileBuffer, invalidEnvelope);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("ENVELOPE_INVALID");
        }
      }
    });
  });
});
