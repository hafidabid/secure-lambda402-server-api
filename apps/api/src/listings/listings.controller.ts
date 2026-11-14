import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CreateListingDto, PatchListingDto } from "@securelambda/schemas";
import { SellerAllowListGuard } from "../auth/seller-allow-list.guard";
import { ListingsService } from "./listings.service";

@Controller("listings")
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  /**
   * POST /v1/listings
   * Create a new draft listing. Returns the created listing.
   */
  @Post()
  @HttpCode(201)
  @UseGuards(SellerAllowListGuard)
  async createListing(
    @Headers("x-account-id") accountId: string,
    @Body() dto: CreateListingDto,
  ) {
    return this.listingsService.createListing(accountId, dto);
  }

  /**
   * PATCH /v1/listings/:id
   * Update a draft listing (owner only, draft status only).
   */
  @Patch(":id")
  @HttpCode(200)
  @UseGuards(SellerAllowListGuard)
  async patchListing(
    @Param("id") id: string,
    @Headers("x-account-id") accountId: string,
    @Body() dto: PatchListingDto,
  ) {
    return this.listingsService.patchListing(id, accountId, dto);
  }

  /**
   * GET /v1/listings
   * List published listings with optional search and pagination.
   * Query params: q (search), limit (default 20, max 100), cursor (pagination).
   */
  @Get()
  @HttpCode(200)
  async listListings(
    @Query("q") q?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.listingsService.listListings(q, parsedLimit, cursor);
  }

  /**
   * GET /v1/listings/:id
   * Get a single listing by ID.
   * - Published listings: public access.
   * - Draft listings: owner only (returns 404 to non-owners).
   */
  @Get(":id")
  @HttpCode(200)
  async getListing(
    @Param("id") id: string,
    @Headers("x-account-id") accountId?: string,
  ) {
    return this.listingsService.getListing(id, accountId);
  }

  /**
   * POST /v1/listings/:id/publish
   * Publish a draft listing (owner only, requires datasetAssetId).
   */
  @Post(":id/publish")
  @HttpCode(200)
  @UseGuards(SellerAllowListGuard)
  async publishListing(
    @Param("id") id: string,
    @Headers("x-account-id") accountId: string,
  ) {
    return this.listingsService.publishListing(id, accountId);
  }
}
