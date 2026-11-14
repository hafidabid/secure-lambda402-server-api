import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { ApiError } from "@securelambda/schemas";
import { sellerAllowList, type AppConfig } from "../config";

/**
 * Guard that checks if the authenticated account (resolved by AuthMiddleware into x-account-id) is in the seller allow-list.
 * A missing account is always refused. A non-empty list restricts seller routes to its accounts; an empty list
 * (the default) leaves them open to any signed-in account.
 * (docs/03 A5/FR-14)
 */
@Injectable()
export class SellerAllowListGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const accountId = request.headers["x-account-id"];

    // Fail closed: missing or empty header is forbidden
    if (!accountId || typeof accountId !== "string" || accountId.trim() === "") {
      throw new ApiError("UNAUTHENTICATED", "log in first: send Authorization: Bearer <session>");
    }

    // Get allow-list from config
    const rawAllowList = this.configService.get<string>("SELLER_ALLOW_LIST", "");
    const allowList = sellerAllowList({ SELLER_ALLOW_LIST: rawAllowList } as AppConfig);

    // An empty list means no restriction; any signed-in account may create and publish listings.
    if (allowList.size > 0 && !allowList.has(accountId)) {
      throw new ApiError("FORBIDDEN", "account is not on the seller allow-list");
    }

    // Optional: attach resolved account id to request for convenience
    (request as Request & { accountId?: string }).accountId = accountId;

    return true;
  }
}
