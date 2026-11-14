import {
  Controller,
  Get,
  Post,
  Param,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  Body,
  Headers,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiError } from "@securelambda/schemas";
import { SellerAllowListGuard } from "../auth/seller-allow-list.guard";
import { AssetsService } from "./assets.service";

@Controller()
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /**
   * GET /evaluator - Public endpoint.
   * Returns active evaluator version metadata.
   */
  @Get("evaluator")
  async getEvaluator() {
    return this.assetsService.getEvaluatorMetadata();
  }

  /**
   * POST /listings/:id/dataset - Seller upload.
   * Multipart form with file field 'ciphertext' and text field 'wrapped_key'.
   */
  @Post("listings/:id/dataset")
  @UseGuards(SellerAllowListGuard)
  @UseInterceptors(FileInterceptor("ciphertext"))
  async uploadDataset(
    @Param("id") listingId: string,
    @Headers("x-account-id") accountId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body("wrapped_key") wrappedKeyJson: string,
  ) {
    // Parse wrapped_key JSON string
    let wrappedKey: any;
    try {
      wrappedKey = JSON.parse(wrappedKeyJson);
    } catch {
      throw new ApiError("ENVELOPE_INVALID", "wrapped_key is not valid JSON");
    }

    return this.assetsService.uploadDataset(listingId, accountId, file.buffer, wrappedKey);
  }

  /**
   * POST /listings/:id/models - Buyer upload.
   * Multipart form with file field 'ciphertext' and text field 'wrapped_key'.
   */
  @Post("listings/:id/models")
  @UseInterceptors(FileInterceptor("ciphertext"))
  async uploadModel(
    @Param("id") listingId: string,
    @Headers("x-account-id") accountId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body("wrapped_key") wrappedKeyJson: string,
  ) {
    // Parse wrapped_key JSON string
    let wrappedKey: any;
    try {
      wrappedKey = JSON.parse(wrappedKeyJson);
    } catch {
      throw new ApiError("ENVELOPE_INVALID", "wrapped_key is not valid JSON");
    }

    return this.assetsService.uploadModel(listingId, accountId, file.buffer, wrappedKey);
  }
}
