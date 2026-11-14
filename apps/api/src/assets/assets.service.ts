import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../common/prisma.service";
import { StorageService } from "../common/storage.service";
import {
  ApiError,
  EnvelopeSchema,
  MAX_UPLOAD_BYTES_TONIGHT,
  EvaluatorMetadataSchema,
  Envelope,
} from "@securelambda/schemas";

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Get the active evaluator version metadata.
   * AP-04: Returns version, project_id, wasm_hash, public_key (base64), trust_tier.
   */
  async getEvaluatorMetadata() {
    const evaluator = await this.prisma.evaluatorVersion.findFirst({
      where: { active: true },
    });

    if (!evaluator) {
      throw new ApiError("INTERNAL", "no active evaluator version configured");
    }

    const metadata = {
      version: evaluator.version,
      project_id: evaluator.projectId,
      wasm_hash: evaluator.wasmHash,
      public_key: evaluator.publicKey.toString("base64"),
      trust_tier: evaluator.trustTier,
    };

    // Validate schema before returning
    const result = EvaluatorMetadataSchema.safeParse(metadata);
    if (!result.success) {
      throw new ApiError("INTERNAL", "evaluator metadata validation failed");
    }

    return result.data;
  }

  /**
   * Upload dataset for a listing.
   * AP-02: Idempotent asset creation - same bytes from same owner returns same asset_id.
   */
  async uploadDataset(
    listingId: string,
    accountId: string,
    fileBuffer: Buffer,
    wrappedKeyJson: any,
  ) {
    // Validate size BEFORE touching storage or database
    if (fileBuffer.length > MAX_UPLOAD_BYTES_TONIGHT) {
      throw new ApiError("ASSET_TOO_LARGE", "file exceeds size limit");
    }

    // Check that listing exists and is owned by account
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new ApiError("LISTING_NOT_FOUND", "listing not found");
    }

    if (listing.sellerId !== accountId) {
      throw new ApiError("FORBIDDEN", "only the listing seller can upload dataset");
    }

    // Validate wrapped_key envelope
    const parseResult = EnvelopeSchema.safeParse(wrappedKeyJson);
    if (!parseResult.success) {
      throw new ApiError("ENVELOPE_INVALID", "wrapped_key envelope validation failed");
    }
    const wrappedKey = parseResult.data;

    // Compute sha256 of file
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

    // Idempotent asset create-or-find
    const asset = await this.createOrFindAsset(
      accountId,
      sha256,
      fileBuffer.length,
      fileBuffer,
      "dataset",
    );

    // Update listing with dataset info
    await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        datasetAssetId: asset.id,
        datasetWrappedKey: wrappedKey,
      },
    });

    return { asset_id: asset.id };
  }

  /**
   * Upload model for a listing.
   * AP-02: Idempotent asset creation for models too.
   */
  async uploadModel(
    listingId: string,
    accountId: string,
    fileBuffer: Buffer,
    wrappedKeyJson: any,
  ) {
    // Validate size BEFORE touching storage or database
    if (fileBuffer.length > MAX_UPLOAD_BYTES_TONIGHT) {
      throw new ApiError("ASSET_TOO_LARGE", "file exceeds size limit");
    }

    // Check that listing exists
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new ApiError("LISTING_NOT_FOUND", "listing not found");
    }

    // Validate wrapped_key envelope
    const parseResult = EnvelopeSchema.safeParse(wrappedKeyJson);
    if (!parseResult.success) {
      throw new ApiError("ENVELOPE_INVALID", "wrapped_key envelope validation failed");
    }
    const wrappedKey = parseResult.data;

    // Compute sha256 of file
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

    // Idempotent asset create-or-find
    const asset = await this.createOrFindAsset(
      accountId,
      sha256,
      fileBuffer.length,
      fileBuffer,
      "model",
    );

    // Create Model record
    const model = await this.prisma.model.create({
      data: {
        id: `mdl_${randomUUID()}`,
        buyerId: accountId,
        listingId: listingId,
        assetId: asset.id,
        wrappedKey: wrappedKey,
        evaluatorVersion: listing.evaluatorVersion,
      },
    });

    return { model_id: model.id };
  }

  /**
   * Create or find an asset (idempotent).
   * On P2002 unique constraint error (ownerId, sha256), look up the existing asset.
   * Only upload to storage on creation, not on idempotent lookup.
   */
  private async createOrFindAsset(
    ownerId: string,
    sha256: string,
    sizeBytes: number,
    fileBuffer: Buffer,
    kind: "dataset" | "model",
  ) {
    const assetId = `ast_${randomUUID()}`;
    const storageKey = assetId;

    try {
      // Try to create the asset
      const asset = await this.prisma.asset.create({
        data: {
          id: assetId,
          ownerId,
          kind,
          sha256,
          sizeBytes,
          storageKey,
        },
      });

      // Upload to storage only on successful creation
      await this.storage.putCiphertext(storageKey, fileBuffer);

      return asset;
    } catch (err: any) {
      // Handle unique constraint error - asset already exists
      if (err.code === "P2002") {
        // Look up the existing asset by unique constraint (ownerId, sha256)
        const existingAsset = await this.prisma.asset.findUnique({
          where: { ownerId_sha256: { ownerId, sha256 } },
        });

        if (existingAsset) {
          return existingAsset;
        }
      }

      // Re-throw if not a P2002 or lookup failed
      throw err;
    }
  }
}
