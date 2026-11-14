import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { ApiError } from "@securelambda/schemas";

/** Rejects requests that the auth middleware (or header mode) did not resolve to an account. Fails closed. */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const accountId = context.switchToHttp().getRequest<Request>().headers["x-account-id"];
    if (typeof accountId !== "string" || accountId.trim() === "") {
      throw new ApiError("UNAUTHENTICATED", "log in first: send Authorization: Bearer <session>");
    }
    return true;
  }
}
