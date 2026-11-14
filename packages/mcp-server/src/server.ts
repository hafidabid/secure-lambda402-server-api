import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { apiErrorDetail, BuyerAgentClient } from "@securelambda/agent-sdk";
import { z } from "zod/v4";
import { AgentKey, approveUrl, newAgentKey, readAgentKey, writeAgentKey } from "./agent-wallet";
import { AgentWalletConfig, Payer, ServerConfig } from "./config";
import { SpendGuard } from "./spend-guard";

const AmountSchema = z.string().regex(/^\d+$/, "integer amount in token base units");
const MISSING_CREDENTIALS =
  "refused: no NEAR account. Call connect_agent_wallet to create a funded agent wallet, or set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY in this MCP server's env";

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) }] };
}

function pendingMessage(wallet: AgentWalletConfig, key: AgentKey): string {
  return `refused: agent wallet ${key.account_id} is not funded yet. Ask the user to open ${approveUrl(wallet.dashboardUrl, key)} and send it ${key.budget_near} NEAR`;
}

export function createServer(config: ServerConfig): McpServer {
  const guard = new SpendGuard(config.limits);
  const server = new McpServer({ name: "securelambda", version: "0.1.0" });
  let payer = config.payer;

  async function requirePayer(): Promise<Payer> {
    if (payer) return payer;
    const wallet = config.agentWallet;
    const key = wallet && readAgentKey(wallet.keyFile);
    if (!wallet || !key) throw new Error(MISSING_CREDENTIALS);
    if (!(await wallet.chain.keyExists(key.account_id, key.public_key))) throw new Error(pendingMessage(wallet, key));
    payer = wallet.makePayer(key.account_id, key.private_key);
    return payer;
  }

  function requireAgentWallet(): AgentWalletConfig {
    if (config.payer) throw new Error(`refused: this server pays from NEAR_ACCOUNT_ID ${config.payer.accountId}; remove it from the env to use an agent wallet`);
    if (!config.agentWallet) throw new Error("refused: agent wallets are not configured");
    return config.agentWallet;
  }

  async function agentWalletStatus(wallet: AgentWalletConfig, key: AgentKey) {
    const active = await wallet.chain.keyExists(key.account_id, key.public_key);
    return {
      account_id: key.account_id,
      status: active ? "active" : "awaiting_funding",
      approve_url: active ? undefined : approveUrl(wallet.dashboardUrl, key),
      balance_yocto_near: active ? await wallet.chain.balanceYocto(key.account_id) : undefined,
      key_file: wallet.keyFile,
    };
  }

  server.registerTool(
    "connect_agent_wallet",
    {
      description:
        "Create this agent's own NEAR wallet: a NEAR implicit account whose key is generated and kept on this machine. Returns approve_url; the user opens it and sends budget_near to the account from their wallet as a plain transfer (no key permission is requested). The agent can then spend at most that balance. If a wallet already exists, returns it instead of making another.",
      inputSchema: {
        budget_near: z.string().optional().describe('NEAR to fund the agent with, e.g. "1". It pays for runs and a little gas and storage. Default "1".'),
      },
    },
    async ({ budget_near }) => {
      const wallet = requireAgentWallet();
      const existing = readAgentKey(wallet.keyFile);
      if (existing) return json({ ...(await agentWalletStatus(wallet, existing)), note: "an agent wallet already exists; it was not replaced" });
      const key = newAgentKey(budget_near ?? "1");
      writeAgentKey(wallet.keyFile, key);
      return json({
        ...(await agentWalletStatus(wallet, key)),
        next: "Show the user approve_url. After they send the funds, call agent_wallet_status to confirm, then quote and evaluate as usual.",
      });
    },
  );

  server.registerTool(
    "agent_wallet_status",
    {
      description: "Show which NEAR account this server pays from: the env account, or the agent wallet and whether the user has funded it yet, with its balance.",
      inputSchema: {},
    },
    async () => {
      if (config.payer) return json({ source: "env", account_id: config.payer.accountId });
      const wallet = config.agentWallet;
      const key = wallet && readAgentKey(wallet.keyFile);
      if (!wallet || !key) return json({ source: "none", next: "call connect_agent_wallet" });
      return json({ source: "agent_wallet", ...(await agentWalletStatus(wallet, key)) });
    },
  );

  async function getJson(path: string, headers: Record<string, string> = {}): Promise<unknown> {
    const response = await fetch(`${config.apiUrl}${path}`, { headers });
    if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}${await apiErrorDetail(response)}`);
    return response.json();
  }

  function client(payer: Payer, signer = payer.signer): BuyerAgentClient {
    return new BuyerAgentClient({ baseUrl: config.apiUrl, signer, headers: payer.headers });
  }

  server.registerTool(
    "list_listings",
    {
      description:
        "Search published SecureLambda listings (sealed datasets a model can be scored against). Free, no login. Prices are integer strings in token base units (wNEAR has 24 decimals).",
      inputSchema: {
        q: z.string().optional().describe("Text search"),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional().describe("next_cursor from a previous page"),
      },
    },
    async ({ q, limit, cursor }) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (limit) params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      const query = params.size ? `?${params}` : "";
      return json(await getJson(`/v1/listings${query}`));
    },
  );

  server.registerTool(
    "get_listing",
    {
      description: "Get one published listing: schema, 5 synthetic sample rows, price, evaluator version. Free, no login.",
      inputSchema: { listing_id: z.string().min(1) },
    },
    async ({ listing_id }) => json(await getJson(`/v1/listings/${encodeURIComponent(listing_id)}`)),
  );

  server.registerTool(
    "quote_evaluation",
    {
      description:
        "Get the x402 price quote for running a model on a listing WITHOUT paying. Returns amount (token base units), token, payTo and expiry. Use the amount to choose max_price for evaluate.",
      inputSchema: { listing_id: z.string().min(1), model_id: z.string().min(1) },
    },
    async ({ listing_id, model_id }) => {
      const accept = await client(await requirePayer()).quote(listing_id, model_id);
      return json({
        amount: accept.maxAmountRequired,
        asset: accept.asset,
        token_contract: accept.assetContract ?? null,
        network: accept.network,
        pay_to: accept.payTo,
        valid_until: accept.validUntil,
      });
    },
  );

  server.registerTool(
    "evaluate",
    {
      description:
        "SPENDS REAL TOKENS: pays the listing's price from the configured NEAR account and runs the model on the sealed dataset. Refuses if the fresh quote exceeds max_price or the server's per-run or session caps. Returns only rounded aggregate metrics, a row-count bucket, the run id, mode and receipt; no rows or per-row predictions.",
      inputSchema: {
        listing_id: z.string().min(1),
        model_id: z.string().min(1).describe("model_id from uploading a sealed model to this listing"),
        max_price: AmountSchema.describe("Most you will pay, in the same base units as quote_evaluation's amount"),
      },
    },
    async ({ listing_id, model_id, max_price }) => {
      const payer = await requirePayer();
      const maxPrice = BigInt(max_price);
      let paid = 0n;
      // Checking inside the signer applies the caps to the exact quote being signed, not an earlier one.
      const result = await client(payer, (accept) => {
        paid = BigInt(accept.maxAmountRequired);
        guard.authorize(paid, maxPrice);
        return payer.signer(accept);
      }).evaluate(listing_id, model_id);
      return json({
        run_id: result.run_id,
        mode: result.mode,
        metrics: result.result.metrics,
        n_bucket: result.result.n_bucket,
        receipt: result.receipt,
        amount_paid: paid,
        session_authorized_total: guard.authorizedTotal,
      });
    },
  );

  server.registerTool(
    "get_run",
    {
      description: "Get a run's state and result (rounded metrics only). Only the buyer who started it can read it.",
      inputSchema: { run_id: z.string().min(1) },
    },
    async ({ run_id }) => {
      const payer = await requirePayer();
      return json(await getJson(`/v1/runs/${encodeURIComponent(run_id)}`, await payer.headers()));
    },
  );

  server.registerTool(
    "get_receipt",
    {
      description: "Get a run's receipt: payment transactions, evaluator wasm hash, attestation flag. Buyer only.",
      inputSchema: { run_id: z.string().min(1) },
    },
    async ({ run_id }) => {
      const payer = await requirePayer();
      return json(await getJson(`/v1/runs/${encodeURIComponent(run_id)}/receipt`, await payer.headers()));
    },
  );

  return server;
}
