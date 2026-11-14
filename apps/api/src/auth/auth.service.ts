import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import { verifyNep413 } from "@securelambda/facilitator";
import { ApiError } from "@securelambda/schemas";
import { PrismaService } from "../common/prisma.service";
import { RedisService } from "../common/redis.service";
import type { AppConfig } from "../config";

/** Checks on chain that `publicKey` is a full-access key of `accountId`. */
export const FULL_ACCESS_KEY_CHECK = Symbol("FULL_ACCESS_KEY_CHECK");
export type FullAccessKeyCheck = (accountId: string, publicKey: string) => Promise<boolean>;

/** Lowercase NEAR account ids: named (`alice.testnet`) or 64-hex implicit accounts. */
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+([-_.][a-z0-9]+)*$/;

const challengeKey = (nonceHex: string) => `auth:challenge:${nonceHex}`;
// Sessions are stored under a hash of the token, so reading Redis does not reveal usable tokens.
const sessionKey = (token: string) => `auth:session:${createHash("sha256").update(token).digest("hex")}`;

export interface Challenge {
  /** base64 of 32 random bytes. Sign it into the NEP-413 payload as `nonce`. */
  nonce: string;
  message: string;
  recipient: string;
  expires_in: number;
}

export interface Session {
  token: string;
  account_id: string;
  expires_in: number;
}

/**
 * Login by NEP-413 signature. Step 1 hands out a single-use challenge; step 2 checks the signature over it,
 * checks on chain that the signing key is a full-access key of the claimed account, and issues an opaque bearer
 * session. The account id on every later request comes from that session, never from a client header.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(FULL_ACCESS_KEY_CHECK) private readonly isFullAccessKey: FullAccessKeyCheck,
  ) {}

  private get audience(): string {
    return this.config.get("AUTH_AUDIENCE", { infer: true });
  }

  async createChallenge(accountId: string): Promise<Challenge> {
    if (!ACCOUNT_ID.test(accountId)) throw new ApiError("VALIDATION_FAILED", "account_id is not a valid NEAR account id");
    const nonce = randomBytes(32);
    const ttl = this.config.get("AUTH_CHALLENGE_TTL_SECONDS", { infer: true });
    await this.redis.client.set(challengeKey(nonce.toString("hex")), accountId, "EX", ttl);
    return {
      nonce: nonce.toString("base64"),
      message: `Log in to SecureLambda as ${accountId}`,
      recipient: this.audience,
      expires_in: ttl,
    };
  }

  async login(input: { accountId: string; publicKey: string; signature: string; nonce: string }): Promise<Session> {
    const nonce = Buffer.from(input.nonce, "base64");
    if (nonce.length !== 32) throw new ApiError("UNAUTHENTICATED", "invalid login challenge");

    // GETDEL makes the challenge single-use even under concurrent attempts, and burns it on a failed try too.
    const owner = await this.redis.client.getdel(challengeKey(nonce.toString("hex")));
    if (owner === null || owner !== input.accountId) throw new ApiError("UNAUTHENTICATED", "login challenge is unknown, expired or for another account");

    const signed = verifyNep413(input.publicKey, input.signature, {
      message: `Log in to SecureLambda as ${input.accountId}`,
      nonce,
      recipient: this.audience,
    });
    if (!signed) throw new ApiError("UNAUTHENTICATED", "signature does not match the challenge");

    if (!(await this.isFullAccessKey(input.accountId, input.publicKey))) {
      throw new ApiError("UNAUTHENTICATED", "key is not a full-access key of that account");
    }

    // First login creates the account row that listings and runs point at. Proving key ownership is the only gate.
    await this.prisma.account.upsert({ where: { id: input.accountId }, update: {}, create: { id: input.accountId } });

    const token = randomBytes(32).toString("base64url");
    const ttl = this.config.get("AUTH_SESSION_TTL_SECONDS", { infer: true });
    await this.redis.client.set(sessionKey(token), input.accountId, "EX", ttl);
    return { token, account_id: input.accountId, expires_in: ttl };
  }

  /** The account a bearer token belongs to, or null if it is unknown or expired. */
  resolve(token: string): Promise<string | null> {
    return this.redis.client.get(sessionKey(token));
  }

  async logout(token: string): Promise<void> {
    await this.redis.client.del(sessionKey(token));
  }
}
