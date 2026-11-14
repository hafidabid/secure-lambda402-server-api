import { signNep413 } from "@securelambda/facilitator";

export interface NearLoginOptions {
  baseUrl: string;
  /** The NEAR account to log in as. */
  accountId: string;
  /** `ed25519:<base58>` full-access key of that account. Only a signature leaves this process. */
  privateKey: string;
}

async function post(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) throw new Error(`login failed: ${json.error?.code ?? res.status} - ${json.error?.message ?? "no detail"}`);
  return json;
}

/**
 * Logs in with a NEP-413 signature (no transaction, no gas) and returns a function that yields the
 * `Authorization` header for each request. The session is reused until shortly before it expires, then
 * renewed with a fresh signature. Pass it as `BuyerAgentClient`'s `headers` option.
 */
export function createNearLogin(options: NearLoginOptions): () => Promise<Record<string, string>> {
  let token: string | undefined;
  let renewAt = 0;
  let inflight: Promise<void> | undefined;

  async function login(): Promise<void> {
    const challenge = await post(`${options.baseUrl}/v1/auth/challenge`, { account_id: options.accountId });
    const { publicKey, signature } = signNep413(options.privateKey, {
      message: challenge.message,
      nonce: Buffer.from(challenge.nonce, "base64"),
      recipient: challenge.recipient,
    });
    const session = await post(`${options.baseUrl}/v1/auth/login`, {
      account_id: options.accountId,
      public_key: publicKey,
      signature,
      nonce: challenge.nonce,
    });
    token = session.token as string;
    renewAt = Date.now() + Math.max(0, (session.expires_in as number) - 30) * 1000;
  }

  return async () => {
    if (!token || Date.now() >= renewAt) {
      inflight ??= login().finally(() => (inflight = undefined));
      await inflight;
    }
    return { authorization: `Bearer ${token}` };
  };
}
