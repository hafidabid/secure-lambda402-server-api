import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { ApiError, AuthChallengeRequestSchema, AuthLoginRequestSchema } from "@securelambda/schemas";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /v1/auth/challenge: get a single-use nonce to sign (NEP-413). */
  @Post("challenge")
  @HttpCode(200)
  challenge(@Body() body: unknown) {
    const parsed = AuthChallengeRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError("VALIDATION_FAILED", parsed.error.message);
    return this.auth.createChallenge(parsed.data.account_id);
  }

  /** POST /v1/auth/login: exchange the signed challenge for a bearer session. */
  @Post("login")
  @HttpCode(200)
  login(@Body() body: unknown) {
    const parsed = AuthLoginRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError("VALIDATION_FAILED", parsed.error.message);
    const { account_id, public_key, signature, nonce } = parsed.data;
    return this.auth.login({ accountId: account_id, publicKey: public_key, signature, nonce });
  }

  /** POST /v1/auth/logout: end the session behind the bearer token. */
  @Post("logout")
  @HttpCode(204)
  async logout(@Headers("authorization") authorization?: string): Promise<void> {
    const token = bearerToken(authorization);
    if (token) await this.auth.logout(token);
  }
}

export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1] : null;
}
