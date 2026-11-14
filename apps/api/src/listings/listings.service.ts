import { Injectable } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { randomUUID } from "crypto";
import {
  ApiError,
  CreateListingDto,
  CreateListingDtoSchema,
  PatchListingDto,
  PatchListingDtoSchema,
  ListingSchema,
  ListingCatalogItemSchema,
  Listing,
  ListingCatalogItem,
} from "@securelambda/schemas";
import { PrismaService } from "../common/prisma.service";

/** Parse a value against a Zod schema or throw ApiError with VALIDATION_FAILED. */
function parseOrThrow<T>(schema: any, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError("VALIDATION_FAILED", result.error.message);
  }
  return result.data;
}

/** Convert a DB listing (with camelCase, Decimal types) to API format (snake_case, string prices). */
function toListingDto(dbListing: any): Listing {
  return {
    id: dbListing.id,
    seller_id: dbListing.sellerId,
    name: dbListing.name,
    schema: dbListing.schemaJson,
    sample_rows: dbListing.sampleRows,
    price_amount: dbListing.priceAmount.toString(),
    price_asset: dbListing.priceAsset,
    rules: dbListing.rulesJson,
    evaluator_version: dbListing.evaluatorVersion,
    dataset_asset_id: dbListing.datasetAssetId,
    status: dbListing.status,
    created_at: dbListing.createdAt.toISOString(),
    published_at: dbListing.publishedAt ? dbListing.publishedAt.toISOString() : null,
  };
}

/** Convert to public catalog item (no seller-private fields). */
function toCatalogItemDto(dbListing: any): ListingCatalogItem {
  const full = toListingDto(dbListing);
  const catalogItem: any = {
    id: full.id,
    name: full.name,
    schema: full.schema,
    sample_rows: full.sample_rows,
    price_amount: full.price_amount,
    price_asset: full.price_asset,
    evaluator_version: full.evaluator_version,
    status: full.status,
  };
  return catalogItem;
}

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new draft listing.
   * AP-01: validates CreateListingDtoSchema, creates with status='draft'.
   */
  async createListing(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    const validated = parseOrThrow<CreateListingDto>(CreateListingDtoSchema, dto);

    const id = `lst_${randomUUID()}`;
    const dbListing = await this.prisma.listing.create({
      data: {
        id,
        sellerId,
        name: validated.name,
        schemaJson: validated.schema,
        sampleRows: validated.sample_rows,
        priceAmount: new Decimal(validated.price_amount),
        priceAsset: validated.price_asset,
        rulesJson: validated.rules,
        evaluatorVersion: validated.evaluator_version,
        status: "draft",
      },
    });

    return toListingDto(dbListing);
  }

  /**
   * Update a draft listing (patch).
   * AP-09: only owner can patch (403 FORBIDDEN if not).
   * AP-11: cannot patch published listings (409 CONFLICT).
   */
  async patchListing(listingId: string, sellerId: string, dto: PatchListingDto): Promise<Listing> {
    const validated = parseOrThrow<PatchListingDto>(PatchListingDtoSchema, dto);

    const existing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!existing) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found");
    }

    // AP-09: only owner can edit
    if (existing.sellerId !== sellerId) {
      throw new ApiError("FORBIDDEN", "Only the owner can modify this listing");
    }

    // AP-11: cannot edit published listings
    if (existing.status !== "draft") {
      throw new ApiError("CONFLICT", "cannot edit a published listing without pausing it first");
    }

    // Build update data, only including provided fields
    const updateData: any = {};
    if (validated.name !== undefined) updateData.name = validated.name;
    if (validated.schema !== undefined) updateData.schemaJson = validated.schema;
    if (validated.sample_rows !== undefined) updateData.sampleRows = validated.sample_rows;
    if (validated.price_amount !== undefined) updateData.priceAmount = new Decimal(validated.price_amount);
    if (validated.price_asset !== undefined) updateData.priceAsset = validated.price_asset;
    if (validated.rules !== undefined) updateData.rulesJson = validated.rules;
    if (validated.evaluator_version !== undefined) updateData.evaluatorVersion = validated.evaluator_version;

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: updateData,
    });

    return toListingDto(updated);
  }

  /**
   * Get a single listing by ID.
   * - If published: public access, returns as ListingCatalogItem.
   * - If draft: only owner can read (404 if not owner, never reveal existence).
   * AP-10: drafts return 404 to non-owners, never FORBIDDEN.
   */
  async getListing(listingId: string, requesterId?: string): Promise<Listing | ListingCatalogItem> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });

    if (!listing) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found");
    }

    // Public access for published listings
    if (listing.status === "published") {
      return toCatalogItemDto(listing);
    }

    // Draft access: only owner
    if (requesterId && listing.sellerId === requesterId) {
      return toListingDto(listing);
    }

    // AP-10: non-owner trying to access draft gets 404, never 403 (never reveal existence)
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found");
  }

  /**
   * List published listings with pagination and optional search.
   * AP-03: supports pagination with cursor (base64-encoded last seen id).
   * AP-12: search parameter is passed safely to Prisma (no SQL injection).
   */
  async listListings(q?: string, limit: number = 20, cursor?: string): Promise<{
    items: ListingCatalogItem[];
    next_cursor: string | null;
  }> {
    // Normalize and validate limit
    const normalizedLimit = Math.min(Math.max(1, limit || 20), 100);

    // Decode cursor if provided
    let decodedCursor: string | undefined;
    if (cursor) {
      try {
        decodedCursor = Buffer.from(cursor, "base64").toString("utf-8");
      } catch {
        decodedCursor = undefined;
      }
    }

    // Build where clause: status = published, and optionally filter by name
    const where: any = { status: "published" };
    if (q) {
      where.name = {
        contains: q, // AP-12: this is safe - Prisma parameterizes it automatically
        mode: "insensitive",
      };
    }

    // AP-03: fetch one extra to determine if there's a next page
    const listings = await this.prisma.listing.findMany({
      where,
      orderBy: { id: "asc" },
      skip: decodedCursor ? 1 : 0,
      cursor: decodedCursor ? { id: decodedCursor } : undefined,
      take: normalizedLimit + 1,
    });

    // Determine if there's a next page
    let items: ListingCatalogItem[] = [];
    let nextCursor: string | null = null;

    if (listings.length > normalizedLimit) {
      // There's a next page
      items = listings.slice(0, normalizedLimit).map(toCatalogItemDto);
      const lastItem = listings[normalizedLimit];
      if (lastItem) {
        nextCursor = Buffer.from(lastItem.id, "utf-8").toString("base64");
      }
    } else {
      items = listings.map(toCatalogItemDto);
    }

    return { items, next_cursor: nextCursor };
  }

  /**
   * Publish a draft listing.
   * - Only owner can publish (403 FORBIDDEN if not).
   * - AP-07: requires datasetAssetId to be set (409 CONFLICT if not).
   */
  async publishListing(listingId: string, sellerId: string): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });

    if (!listing) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found");
    }

    // Only owner can publish
    if (listing.sellerId !== sellerId) {
      throw new ApiError("FORBIDDEN", "Only the owner can publish this listing");
    }

    // AP-07: must have datasetAssetId
    if (!listing.datasetAssetId) {
      throw new ApiError("CONFLICT", "cannot publish without a dataset");
    }

    const published = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: "published",
        publishedAt: new Date(),
      },
    });

    return toListingDto(published);
  }
}
