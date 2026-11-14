import { Injectable, NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "@securelambda/schemas";
import type { AppConfig } from "../config";
import { bearerToken } from "./auth.controller";
import { AuthService } from "./auth.service";

/**
 * Decides who the caller is, once, before any controller runs. Controllers and guards read the account id from
 * `x-account-id`; in signed mode this middleware first throws away whatever the client sent there and fills it
 * only from a verified session, so a client can never choose its own identity.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (this.config.get("AUTH_MODE", { infer: true }) === "header") return next();

    delete req.headers["x-account-id"];
    const header = req.headers.authorization;
    if (header === undefined) return next();

    const token = bearerToken(header);
    const accountId = token ? await this.auth.resolve(token) : null;
    // A credential that was presented but is bad is an error, not "anonymous": the caller should know to log in again.
    if (!accountId) throw new ApiError("UNAUTHENTICATED", "session is invalid or expired; log in again");
    req.headers["x-account-id"] = accountId;
    next();
  }
}
