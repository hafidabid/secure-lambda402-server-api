import { z } from "zod";

export const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";
export const NEAR_NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
const RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";

export const PAYMENT_TTL_BLOCKS = 1200;

const RpcEnvelopeSchema = z.object({ result: z.unknown().optional(), error: z.unknown().optional() });
const AccessKeySchema = z.object({ nonce: z.union([z.number(), z.string()]) });
const BlockSchema = z.object({ header: z.object({ height: z.number() }) });

async function rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "dashboard", method, params }),
  });
  const envelope = RpcEnvelopeSchema.parse(await res.json());
  if (envelope.error !== undefined) throw new Error(`NEAR RPC ${method} failed`);
  return envelope.result;
}

export async function accessKeyNonce(accountId: string, publicKey: string): Promise<bigint | null> {
  if (MOCKING) return BigInt(0);
  const result = await rpc("query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: accountId,
    public_key: publicKey,
  });
  const parsed = AccessKeySchema.safeParse(result);
  return parsed.success ? BigInt(parsed.data.nonce) : null;
}

export async function accountExists(accountId: string): Promise<boolean> {
  const result = await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId }).catch(() => null);
  return result !== null;
}

const CallResultSchema = z.object({ result: z.array(z.number()) });

async function viewCall(contract: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(CallResultSchema.parse(result).result)));
}

export async function tokenBalance(contract: string, accountId: string): Promise<bigint> {
  if (MOCKING) return BigInt(0);
  return BigInt(z.string().parse(await viewCall(contract, "ft_balance_of", { account_id: accountId })));
}

export async function isRegisteredOnToken(contract: string, accountId: string): Promise<boolean> {
  if (MOCKING) return false;
  return (await viewCall(contract, "storage_balance_of", { account_id: accountId })) !== null;
}

// The gateway checks balances at "final" finality, which trails a fresh wrap by a few seconds.
export async function waitForTokenBalance(contract: string, accountId: string, atLeast: bigint, timeoutMs = 60_000): Promise<void> {
  if (MOCKING) return;
  const deadline = Date.now() + timeoutMs;
  while ((await tokenBalance(contract, accountId)) < atLeast) {
    if (Date.now() > deadline) throw new Error("The wrapped NEAR has not arrived yet. Wait a moment and run again.");
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export async function blockHeight(): Promise<number> {
  if (MOCKING) return 1_000;
  return BlockSchema.parse(await rpc("block", { finality: "final" })).header.height;
}
