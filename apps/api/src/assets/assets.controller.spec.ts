import { Test, TestingModule } from "@nestjs/testing";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";
import { SellerAllowListGuard } from "../auth/seller-allow-list.guard";
import { ApiError } from "@securelambda/schemas";
import { randomUUID } from "crypto";

describe("AssetsController", () => {
  let controller: AssetsController;
  let service: AssetsService;

  // Mock Multer File
  const createMockFile = (buffer: Buffer, size: number): Express.Multer.File => ({
    buffer,
    size,
    fieldname: "ciphertext",
    originalname: "test.bin",
    encoding: "7bit",
    mimetype: "application/octet-stream",
    destination: "/tmp",
    filename: "test",
    path: "/tmp/test",
    stream: null as any, // Not used in tests
  });

  beforeEach(async () => {
    const mockAssetsService = {
      getEvaluatorMetadata: jest.fn(),
      uploadDataset: jest.fn(),
      uploadModel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssetsController],
      providers: [
        {
          provide: AssetsService,
          useValue: mockAssetsService,
        },
      ],
    })
      .overrideGuard(SellerAllowListGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AssetsController>(AssetsController);
    service = module.get<AssetsService>(AssetsService);
  });

  describe("GET /v1/evaluator", () => {
    it("AP-04: should return evaluator metadata with proper field names", async () => {
      const mockMetadata = {
        version: "v1.0.0",
        project_id: "proj_123",
        wasm_hash: "a".repeat(64),
        public_key: "aGVsbG8gd29ybGQ=", // base64 "hello world"
        trust_tier: 1,
      };

      (service.getEvaluatorMetadata as jest.Mock).mockResolvedValue(mockMetadata);

      const result = await controller.getEvaluator();

      expect(result).toEqual(mockMetadata);
      expect(result.public_key).toBe("aGVsbG8gd29ybGQ=");
      expect(typeof result.public_key).toBe("string");
      expect(service.getEvaluatorMetadata).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /v1/listings/:id/dataset", () => {
    it("should upload dataset with valid envelope", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const fileBuffer = Buffer.from("test ciphertext");
      const file = createMockFile(fileBuffer, fileBuffer.length);

      const wrappedKey = {
        v: 1,
        epk: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        nonce: "AAAAAAAAAAAAAAAAAAA=",
        ct: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
        aad_ctx: {
          listing: listingId,
          role: "dataset",
          ev: "v1",
          ct_sha256: "a".repeat(64),
        },
      };

      const mockResponse = { asset_id: `ast_${randomUUID()}` };
      (service.uploadDataset as jest.Mock).mockResolvedValue(mockResponse);

      const result = await controller.uploadDataset(
        listingId,
        accountId,
        file,
        JSON.stringify(wrappedKey),
      );

      expect(result).toEqual(mockResponse);
      expect(service.uploadDataset).toHaveBeenCalledWith(
        listingId,
        accountId,
        fileBuffer,
        wrappedKey,
      );
    });

    it("AP-08: should throw ENVELOPE_INVALID for invalid JSON wrapped_key", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const file = createMockFile(Buffer.from("test"), 4);

      await expect(
        controller.uploadDataset(listingId, accountId, file, "not valid json"),
      ).rejects.toThrow(ApiError);

      try {
        await controller.uploadDataset(listingId, accountId, file, "not valid json");
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("ENVELOPE_INVALID");
        }
      }
    });
  });

  describe("POST /v1/listings/:id/models", () => {
    it("should upload model with valid envelope", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const fileBuffer = Buffer.from("test model");
      const file = createMockFile(fileBuffer, fileBuffer.length);

      const wrappedKey = {
        v: 1,
        epk: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        nonce: "AAAAAAAAAAAAAAAAAAA=",
        ct: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
        aad_ctx: {
          listing: listingId,
          role: "model",
          ev: "v1",
          ct_sha256: "b".repeat(64),
        },
      };

      const mockResponse = { model_id: `mdl_${randomUUID()}` };
      (service.uploadModel as jest.Mock).mockResolvedValue(mockResponse);

      const result = await controller.uploadModel(
        listingId,
        accountId,
        file,
        JSON.stringify(wrappedKey),
      );

      expect(result).toEqual(mockResponse);
      expect(service.uploadModel).toHaveBeenCalledWith(
        listingId,
        accountId,
        fileBuffer,
        wrappedKey,
      );
    });

    it("AP-08: should throw ENVELOPE_INVALID for invalid JSON wrapped_key", async () => {
      const listingId = `lst_${randomUUID()}`;
      const accountId = `acc_${randomUUID()}`;
      const file = createMockFile(Buffer.from("test"), 4);

      await expect(
        controller.uploadModel(listingId, accountId, file, "invalid json"),
      ).rejects.toThrow(ApiError);

      try {
        await controller.uploadModel(listingId, accountId, file, "invalid json");
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("ENVELOPE_INVALID");
        }
      }
    });
  });
});
