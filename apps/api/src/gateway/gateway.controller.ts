import { Body, Controller, Headers, HttpCode, Ip, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { EvaluateRequestDtoSchema, ApiError } from "@securelambda/schemas";
import { GatewayService } from "./gateway.service";

@Controller("listings")
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  /** POST /v1/listings/:id/evaluate (docs/03 B4, x402 quote/verify/settle). */
  @Post(":id/evaluate")
  @HttpCode(200)
  async evaluate(
    @Param("id") listingId: string,
    @Headers("x-account-id") buyerId: string,
    @Headers("x-payment") paymentHeader: string | undefined,
    @Body() body: unknown,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const parsed = EvaluateRequestDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError("VALIDATION_FAILED", parsed.error.message);
    }

    const result = await this.gatewayService.evaluate(listingId, buyerId, parsed.data.model_id, ip, paymentHeader);

    if (result.kind === "quote") {
      res.status(402);
      return result.quote;
    }
    if (result.kind === "pending") {
      res.status(202).set("Location", result.body.location);
      return result.body;
    }
    res.status(200);
    return result.body;
  }
}
