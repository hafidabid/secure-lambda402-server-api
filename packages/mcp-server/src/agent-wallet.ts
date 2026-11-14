import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { KeyPair } from "@near-js/crypto";
import { z } from "zod/v4";

const AgentKeySchema = z.object({
  account_id: z.string(),
  public_key: z.string(),
  private_key: z.string(),
  budget_near: z.string(),
});

export type AgentKey = z.infer<typeof AgentKeySchema>;

const NEAR_AMOUNT = /^\d+(\.\d{1,24})?$/;

/** The account is NEAR's implicit account for the key: it exists as soon as it receives NEAR, with this key on it. */
export function newAgentKey(budgetNear: string): AgentKey {
  if (!NEAR_AMOUNT.test(budgetNear) || Number(budgetNear) <= 0) throw new Error(`budget_near must be a positive NEAR amount, got "${budgetNear}"`);
  const key = KeyPair.fromRandom("ed25519");
  const publicKey = key.getPublicKey();
  return {
    account_id: Buffer.from(publicKey.data).toString("hex"),
    public_key: publicKey.toString(),
    private_key: key.toString(),
    budget_near: budgetNear,
  };
}

export function readAgentKey(path: string): AgentKey | undefined {
  if (!existsSync(path)) return undefined;
  return AgentKeySchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Refuses to overwrite: an existing file may be the only copy of a funded key. */
export function writeAgentKey(path: string, key: AgentKey): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(key, null, 2), { mode: 0o600, flag: "wx" });
}

export function approveUrl(dashboardUrl: string, key: AgentKey): string {
  const params = new URLSearchParams({ account: key.account_id, budget: key.budget_near });
  return `${dashboardUrl.replace(/\/+$/, "")}/connect-agent?${params}`;
}

export interface NearChain {
  keyExists(accountId: string, publicKey: string): Promise<boolean>;
  balanceYocto(accountId: string): Promise<bigint | null>;
}

const QueryResponseSchema = z.object({ result: z.record(z.string(), z.unknown()).optional(), error: z.unknown().optional() });
const AccountViewSchema = z.object({ amount: z.string() });

// Public testnet RPC nodes drop connections and rate-limit now and then.
const RPC_ATTEMPTS = 4;

export function nearChain(rpcUrl: string): NearChain {
  async function post(body: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
        if (response.status !== 429 && response.status < 500) return response;
        if (attempt >= RPC_ATTEMPTS) return response;
      } catch (error) {
        if (attempt >= RPC_ATTEMPTS) throw error;
      }
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }

  async function view(params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const response = await post(JSON.stringify({ jsonrpc: "2.0", id: "securelambda-mcp", method: "query", params: { finality: "final", ...params } }));
    if (!response.ok) throw new Error(`NEAR RPC: HTTP ${response.status}`);
    const body = QueryResponseSchema.parse(await response.json());
    // UNKNOWN_ACCOUNT and UNKNOWN_ACCESS_KEY come back as RPC errors; both mean "not there yet".
    if (body.error !== undefined || !body.result || "error" in body.result) return null;
    return body.result;
  }
  return {
    keyExists: async (accountId, publicKey) =>
      (await view({ request_type: "view_access_key", account_id: accountId, public_key: publicKey })) !== null,
    balanceYocto: async (accountId) => {
      const account = await view({ request_type: "view_account", account_id: accountId });
      return account ? BigInt(AccountViewSchema.parse(account).amount) : null;
    },
  };
}
