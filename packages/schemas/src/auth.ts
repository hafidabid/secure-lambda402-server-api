import { z } from "zod";

export const AuthChallengeRequestSchema = z.object({ account_id: z.string().min(1) });
export type AuthChallengeRequest = z.infer<typeof AuthChallengeRequestSchema>;

export const AuthChallengeResponseSchema = z.object({
  nonce: z.string(),
  message: z.string(),
  recipient: z.string(),
  expires_in: z.number().int(),
});
export type AuthChallengeResponse = z.infer<typeof AuthChallengeResponseSchema>;

export const AuthLoginRequestSchema = z.object({
  account_id: z.string().min(1),
  public_key: z.string().min(1),
  signature: z.string().min(1),
  nonce: z.string().min(1),
});
export type AuthLoginRequest = z.infer<typeof AuthLoginRequestSchema>;

export const AuthLoginResponseSchema = z.object({
  token: z.string(),
  account_id: z.string(),
  expires_in: z.number().int(),
});
export type AuthLoginResponse = z.infer<typeof AuthLoginResponseSchema>;
