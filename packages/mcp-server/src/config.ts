import { homedir } from "os";
import { join } from "path";
import { createNearLogin, createNearPaymentSigner, PaymentSigner } from "@securelambda/agent-sdk";
import { NearChain, nearChain } from "./agent-wallet";
import { SpendLimits } from "./spend-guard";

export interface Payer {
  accountId: string;
  signer: PaymentSigner;
  headers: () => Promise<Record<string, string>>;
}

export interface AgentWalletConfig {
  keyFile: string;
  dashboardUrl: string;
  chain: NearChain;
  makePayer: (accountId: string, privateKey: string) => Payer;
}

export interface ServerConfig {
  apiUrl: string;
  limits: SpendLimits;
  /** Set from NEAR_ACCOUNT_ID/NEAR_PRIVATE_KEY; takes precedence over the agent wallet. */
  payer?: Payer;
  agentWallet?: AgentWalletConfig;
}

const DEFAULT_API_URL = "https://secure-lambda-api.projectdeadwood.my.id";
const DEFAULT_DASHBOARD_URL = "https://secure-lambda402.vercel.app";
const DEFAULT_RPC_URL = "https://test.rpc.fastnear.com";

function parseAmount(name: string, value: string | undefined): bigint | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer amount in token base units, got "${value}"`);
  return BigInt(value);
}

function makePayer(apiUrl: string, rpcUrl: string, accountId: string, privateKey: string, autoWrapNear: boolean): Payer {
  return {
    accountId,
    signer: createNearPaymentSigner({ accountId, privateKey, rpcUrl, autoWrapNear }),
    headers: createNearLogin({ baseUrl: apiUrl, accountId, privateKey }),
  };
}

export function configFromEnv(env: NodeJS.ProcessEnv): ServerConfig {
  const apiUrl = (env.SECURELAMBDA_API_URL || DEFAULT_API_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
  const rpcUrl = env.NEAR_RPC_URL || DEFAULT_RPC_URL;
  const limits = {
    maxPerRun: parseAmount("SECURELAMBDA_MAX_PER_RUN", env.SECURELAMBDA_MAX_PER_RUN),
    sessionBudget: parseAmount("SECURELAMBDA_SESSION_BUDGET", env.SECURELAMBDA_SESSION_BUDGET),
  };
  const agentWallet: AgentWalletConfig = {
    keyFile: env.SECURELAMBDA_AGENT_KEY_FILE || join(homedir(), ".securelambda", "agent-key.json"),
    dashboardUrl: env.SECURELAMBDA_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
    chain: nearChain(rpcUrl),
    // The agent account is funded in native NEAR, so it must wrap to wNEAR before paying.
    makePayer: (accountId, privateKey) => makePayer(apiUrl, rpcUrl, accountId, privateKey, true),
  };
  const accountId = env.NEAR_ACCOUNT_ID;
  const privateKey = env.NEAR_PRIVATE_KEY;
  if (!accountId || !privateKey) return { apiUrl, limits, agentWallet };

  return { apiUrl, limits, agentWallet, payer: makePayer(apiUrl, rpcUrl, accountId, privateKey, env.NEAR_AUTO_WRAP === "1") };
}
