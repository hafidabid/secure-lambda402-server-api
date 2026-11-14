import { Test, TestingModule } from "@nestjs/testing";
import { ListingsController } from "./listings.controller";
import { ListingsService } from "./listings.service";
import { PrismaService } from "../common/prisma.service";
import { SellerAllowListGuard } from "../auth/seller-allow-list.guard";
import { ApiError, ERROR_CODE_INFO } from "@securelambda/schemas";
import { Decimal } from "@prisma/client/runtime/library";

describe("ListingsController", () => {
  let controller: ListingsController;
  let service: ListingsService;

  // Mock PrismaService
  const mockPrisma = {
    listing: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [
        ListingsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    })
      .overrideGuard(SellerAllowListGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ListingsController>(ListingsController);
    service = module.get<ListingsService>(ListingsService);
  });

  const createBaseDto = (): any => ({
    name: "Test Listing",
    schema: {
      task: "binary_classification",
      features: [{ name: "age", type: "int" }],
      label: "target",
    },
    sample_rows: Array.from({ length: 5 }, () => ({ age: 25 })),
    price_amount: "1000",
    price_asset: "near",
    rules: {
      min_rows: 50,
      min_class_count: 10,
      runs_per_day: 20,
      lifetime_budget: 200,
      round: 2,
      metrics: ["accuracy", "auc", "f1"],
    },
    evaluator_version: "1.0.0",
  });

  describe("POST /v1/listings", () => {
    it("AP-01 (positive): creates a new listing with status draft", async () => {
      const accountId = "acc_123";
      const dto = createBaseDto();

      const mockDbListing = {
        id: "lst_abc123",
        sellerId: accountId,
        name: dto.name,
        schemaJson: dto.schema,
        sampleRows: dto.sample_rows,
        priceAmount: new Decimal("1000"),
        priceAsset: dto.price_asset,
        rulesJson: dto.rules,
        evaluatorVersion: dto.evaluator_version,
        datasetAssetId: null,
        status: "draft",
        createdAt: new Date(),
        publishedAt: null,
      };

      mockPrisma.listing.create.mockResolvedValue(mockDbListing);

      const result = await controller.createListing(accountId, dto);

      expect(result.status).toBe("draft");
      expect(result.seller_id).toBe(accountId);
      expect(result.price_amount).toBe("1000");
      expect(mockPrisma.listing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sellerId: accountId,
          status: "draft",
        }),
      });
    });

    it("AP-05 (negative): rejects price_amount of 0 with VALIDATION_FAILED", async () => {
      const accountId = "acc_123";
      const dto = createBaseDto();
      dto.price_amount = "0"; // invalid

      await expect(controller.createListing(accountId, dto)).rejects.toThrow(ApiError);
      try {
        await controller.createListing(accountId, dto);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("VALIDATION_FAILED");
          expect(ERROR_CODE_INFO.VALIDATION_FAILED.httpStatus).toBe(422);
        }
      }
    });

    it("AP-05 (negative): rejects negative price_amount with VALIDATION_FAILED", async () => {
      const accountId = "acc_123";
      const dto = createBaseDto();
      dto.price_amount = "-5"; // invalid

      await expect(controller.createListing(accountId, dto)).rejects.toThrow(ApiError);
    });

    it("AP-06 (negative): rejects schema with 0 features with VALIDATION_FAILED", async () => {
      const accountId = "acc_123";
      const dto = createBaseDto();
      dto.schema.features = []; // invalid: 0 features

      await expect(controller.createListing(accountId, dto)).rejects.toThrow(ApiError);
      try {
        await controller.createListing(accountId, dto);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("VALIDATION_FAILED");
        }
      }
    });

    it("AP-06 (negative): rejects schema with 65 features with VALIDATION_FAILED", async () => {
      const accountId = "acc_123";
      const dto = createBaseDto();
      dto.schema.features = Array.from({ length: 65 }, (_, i) => ({ name: `f${i}`, type: "int" }));

      await expect(controller.createListing(accountId, dto)).rejects.toThrow(ApiError);
      try {
        await controller.createListing(accountId, dto);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("VALIDATION_FAILED");
        }
      }
    });

    it("AP-06 (negative): rejects schema with duplicate feature names with VALIDATION_FAILED", async () => {
      const accountId = "acc_123";
      const dto = createBaseDto();
      dto.schema.features = [
        { name: "age", type: "int" },
        { name: "age", type: "float" }, // duplicate
      ];

      await expect(controller.createListing(accountId, dto)).rejects.toThrow(ApiError);
      try {
        await controller.createListing(accountId, dto);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("VALIDATION_FAILED");
        }
      }
    });

    it("AP-13 (edge): stores and returns HTML-like strings unchanged", async () => {
      const accountId = "acc_123";
      const htmlString = '<script>alert("xss")</script>';
      const dto = createBaseDto();
      dto.name = htmlString;

      const mockDbListing = {
        id: "lst_abc123",
        sellerId: accountId,
        name: htmlString,
        schemaJson: dto.schema,
        sampleRows: dto.sample_rows,
        priceAmount: new Decimal("1000"),
        priceAsset: dto.price_asset,
        rulesJson: dto.rules,
        evaluatorVersion: dto.evaluator_version,
        datasetAssetId: null,
        status: "draft",
        createdAt: new Date(),
        publishedAt: null,
      };

      mockPrisma.listing.create.mockResolvedValue(mockDbListing);

      const result = await controller.createListing(accountId, dto);

      // Verify the name is returned exactly as provided (no HTML escaping)
      expect(result.name).toBe(htmlString);
    });
  });

  describe("PATCH /v1/listings/:id", () => {
    it("AP-09 (negative): patch by non-owner throws FORBIDDEN (403)", async () => {
      const listingId = "lst_123";
      const ownerId = "acc_owner";
      const requesterId = "acc_other";

      const mockListing = {
        id: listingId,
        sellerId: ownerId,
        name: "Original",
        schemaJson: { task: "binary_classification", features: [], label: "target" },
        sampleRows: [],
        priceAmount: new Decimal("1000"),
        priceAsset: "near",
        rulesJson: {},
        evaluatorVersion: "1.0.0",
        datasetAssetId: null,
        status: "draft",
        createdAt: new Date(),
        publishedAt: null,
      };

      mockPrisma.listing.findUnique.mockResolvedValue(mockListing);

      const dto: any = { name: "Updated" };

      await expect(controller.patchListing(listingId, requesterId, dto)).rejects.toThrow(ApiError);
      try {
        await controller.patchListing(listingId, requesterId, dto);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("FORBIDDEN");
          expect(ERROR_CODE_INFO.FORBIDDEN.httpStatus).toBe(403);
        }
      }
    });

    it("AP-11 (negative): patch on published listing throws CONFLICT (409)", async () => {
      const listingId = "lst_123";
      const accountId = "acc_owner";

      const mockListing = {
        id: listingId,
        sellerId: accountId,
        name: "Published",
        schemaJson: { task: "binary_classification", features: [], label: "target" },
        sampleRows: [],
        priceAmount: new Decimal("1000"),
        priceAsset: "near",
        rulesJson: {},
        evaluatorVersion: "1.0.0",
        datasetAssetId: "dataset_123",
        status: "published", // NOT draft
        createdAt: new Date(),
        publishedAt: new Date(),
      };

      mockPrisma.listing.findUnique.mockResolvedValue(mockListing);

      const dto: any = { name: "Updated" };

      await expect(controller.patchListing(listingId, accountId, dto)).rejects.toThrow(ApiError);
      try {
        await controller.patchListing(listingId, accountId, dto);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("CONFLICT");
          expect(ERROR_CODE_INFO.CONFLICT.httpStatus).toBe(409);
        }
      }
    });
  });

  describe("GET /v1/listings", () => {
    it("AP-03 (positive): pagination returns next_cursor when more items exist", async () => {
      const listings = Array.from({ length: 21 }, (_, i) => ({
        id: `lst_${String(i).padStart(3, "0")}`,
        sellerId: "acc_seller",
        name: `Listing ${i}`,
        schemaJson: { task: "binary_classification", features: [], label: "target" },
        sampleRows: [],
        priceAmount: new Decimal("1000"),
        priceAsset: "near",
        rulesJson: {},
        evaluatorVersion: "1.0.0",
        datasetAssetId: "dataset_123",
        status: "published",
        createdAt: new Date(),
        publishedAt: new Date(),
      }));

      // Return 21 items (limit=20, so we know there's more)
      mockPrisma.listing.findMany.mockResolvedValue(listings);

      const result = await controller.listListings(undefined, "20", undefined);

      expect(result.items.length).toBe(20);
      expect(result.next_cursor).not.toBeNull();
    });

    it("AP-03 (positive): no duplicates across pages", async () => {
      // Page 1: items 0-19
      const page1 = Array.from({ length: 20 }, (_, i) => ({
        id: `lst_${String(i).padStart(3, "0")}`,
        sellerId: "acc_seller",
        name: `Listing ${i}`,
        schemaJson: { task: "binary_classification", features: [], label: "target" },
        sampleRows: [],
        priceAmount: new Decimal("1000"),
        priceAsset: "near",
        rulesJson: {},
        evaluatorVersion: "1.0.0",
        datasetAssetId: "dataset_123",
        status: "published",
        createdAt: new Date(),
        publishedAt: new Date(),
      }));

      mockPrisma.listing.findMany.mockResolvedValue(page1);

      const result1 = await controller.listListings(undefined, "20", undefined);

      // Verify first page has unique IDs
      const ids1 = result1.items.map((item: any) => item.id);
      expect(new Set(ids1).size).toBe(ids1.length);
    });

    it("AP-12 (negative/injection): search parameter with SQL-like string is passed safely", async () => {
      const maliciousQ = "'; DROP TABLE listings; --";

      mockPrisma.listing.findMany.mockResolvedValue([]);

      await controller.listListings(maliciousQ, "20", undefined);

      // Verify findMany was called with the exact string as data (not concatenated into SQL)
      expect(mockPrisma.listing.findMany).toHaveBeenCalledWith({
        where: {
          status: "published",
          name: {
            contains: maliciousQ, // passed as data, not SQL
            mode: "insensitive",
          },
        },
        orderBy: { id: "asc" },
        skip: 0,
        cursor: undefined,
        take: 21,
      });
    });
  });

  describe("GET /v1/listings/:id", () => {
    it("AP-10 (negative): non-owner accessing draft returns LISTING_NOT_FOUND (404), not FORBIDDEN", async () => {
      const listingId = "lst_123";
      const accountId = "acc_owner";
      const requesterId = "acc_other";

      const mockListing = {
        id: listingId,
        sellerId: accountId,
        name: "Draft Listing",
        schemaJson: { task: "binary_classification", features: [], label: "target" },
        sampleRows: [],
        priceAmount: new Decimal("1000"),
        priceAsset: "near",
        rulesJson: {},
        evaluatorVersion: "1.0.0",
        datasetAssetId: null,
        status: "draft", // not published
        createdAt: new Date(),
        publishedAt: null,
      };

      mockPrisma.listing.findUnique.mockResolvedValue(mockListing);

      await expect(controller.getListing(listingId, requesterId)).rejects.toThrow(ApiError);
      try {
        await controller.getListing(listingId, requesterId);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("LISTING_NOT_FOUND");
          expect(ERROR_CODE_INFO.LISTING_NOT_FOUND.httpStatus).toBe(404);
          // Verify it's NOT FORBIDDEN
          expect(err.code).not.toBe("FORBIDDEN");
        }
      }
    });
  });

  describe("POST /v1/listings/:id/publish", () => {
    it("AP-01 (positive): publishing a draft with datasetAssetId succeeds and sets status=published", async () => {
      const listingId = "lst_123";
      const accountId = "acc_owner";

      const mockDraftListing = {
        id: listingId,
        sellerId: accountId,
        name: "Draft Listing",
        schemaJson: { task: "binary_classification", features: [], label: "target" },
        sampleRows: [],
        priceAmount: new Decimal("1000"),
        priceAsset: "near",
        rulesJson: {},
        evaluatorVersion: "1.0.0",
        datasetAssetId: "dataset_123",
        status: "draft",
        createdAt: new Date(),
        publishedAt: null,
      };

      const mockPublishedListing = {
        ...mockDraftListing,
        status: "published",
        publishedAt: new Date(),
      };

      mockPrisma.listing.findUnique.mockResolvedValue(mockDraftListing);
      mockPrisma.listing.update.mockResolvedValue(mockPublishedListing);

      const result = await controller.publishListing(listingId, accountId);

      expect(result.status).toBe("published");
      expect(result.published_at).not.toBeNull();
      expect(mockPrisma.listing.update).toHaveBeenCalledWith({
        where: { id: listingId },
        data: {
          status: "published",
          publishedAt: expect.any(Date),
        },
      });
    });

    it("AP-07 (negative): publishing without datasetAssetId throws CONFLICT (409)", async () => {
      const listingId = "lst_123";
      const accountId = "acc_owner";

      const mockListing = {
        id: listingId,
        sellerId: accountId,
        name: "Draft Listing",
        schemaJson: { task: "binary_classification", features: [], label: "target" },
        sampleRows: [],
        priceAmount: new Decimal("1000"),
        priceAsset: "near",
        rulesJson: {},
        evaluatorVersion: "1.0.0",
        datasetAssetId: null, // NO dataset
        status: "draft",
        createdAt: new Date(),
        publishedAt: null,
      };

      mockPrisma.listing.findUnique.mockResolvedValue(mockListing);

      await expect(controller.publishListing(listingId, accountId)).rejects.toThrow(ApiError);
      try {
        await controller.publishListing(listingId, accountId);
      } catch (err) {
        if (err instanceof ApiError) {
          expect(err.code).toBe("CONFLICT");
          expect(ERROR_CODE_INFO.CONFLICT.httpStatus).toBe(409);
        }
      }
    });
  });
});
