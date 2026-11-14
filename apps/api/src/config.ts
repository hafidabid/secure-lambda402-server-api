import { z } from "zod";

/** Env vars per docs/03 B11 "Config". Loaded once at bootstrap via ConfigModule. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  STORAGE_ENDPOINT: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().default("securelambda"),
  STORAGE_SECRET_KEY: z.string().default("securelambda123"),
  STORAGE_BUCKET: z.string().default("securelambda-assets"),
  STORAGE_REGION: z.string().default("us-east-1"),
  /** Optional folder inside the bucket, so one bucket (e.g. Cloudflare R2) can be shared safely. */
  STORAGE_KEY_PREFIX: z.string().default(""),

  NEAR_RPC_URL: z.string().default("https://test.rpc.fastnear.com"),
  NEAR_NETWORK: z.string().default("testnet"),
  RELAYER_ACCOUNT: z.string().optional(),
  RELAYER_KEY: z.string().optional(),
  /** "sandbox" = Redis ledger (no chain). "near" = real NEP-366 delegate actions settled on NEAR. */
  /** NEP-141 token contract buyers pay in, e.g. wrap.testnet (wNEAR). Required when FACILITATOR_MODE=near. */
  PAYMENT_TOKEN_CONTRACT: z.string().optional(),
  FACILITATOR_MODE: z.enum(["sandbox", "near"]).default("sandbox"),

  OUTLAYER_PROJECT: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(1 * 1024 * 1024),
  PAYMENT_ASSET: z.enum(["near", "usdc"]).default("near"),
  PAYMENT_VALID_MINUTES: z.coerce.number().int().positive().default(15),

  /** Comma-separated NEAR account ids allowed on seller routes (docs/03 A5/FR-14). Empty = any signed-in account. */
  SELLER_ALLOW_LIST: z.string().default(""),

  /**
   * "signed" = callers log in with a NEP-413 signature and send `Authorization: Bearer <session>`; the `x-account-id`
   * header is ignored. "header" trusts `x-account-id` as-is and exists only for local development and tests.
   */
  AUTH_MODE: z.enum(["signed", "header"]).default("signed"),
  /** The `recipient` a login signature must be made for, so a signature for another service is useless here. */
  AUTH_AUDIENCE: z.string().min(1).default("securelambda-api"),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  AUTH_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /** Browser origins allowed to call the API. "*" allows any origin; otherwise a comma-separated list. */
  CORS_ORIGINS: z.string().default("*"),
  /** How many reverse proxies sit in front (nginx = 1), so the rate limit sees the real client IP. 0 = none. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  RATE_LIMIT_PER_IP_PER_MINUTE: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`invalid environment configuration: ${result.error.message}`);
  }
  if (result.data.NODE_ENV === "production" && result.data.AUTH_MODE === "header") {
    throw new Error("AUTH_MODE=header trusts a client-supplied account id and is not allowed in production");
  }
  return result.data;
}

export function sellerAllowList(config: AppConfig): Set<string> {
  return new Set(
    config.SELLER_ALLOW_LIST.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}
