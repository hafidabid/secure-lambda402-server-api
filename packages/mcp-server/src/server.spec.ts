import { createServer as createHttpServer, IncomingMessage, Server, ServerResponse } from "http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { PaymentSigner } from "@securelambda/agent-sdk";
import { SignedPayment, X402Accept } from "@securelambda/schemas";
import { PublicKey } from "@near-js/crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentWalletConfig, configFromEnv, Payer, ServerConfig } from "./config";
import { SpendLimits } from "./spend-guard";
import { createServer } from "./server";

const PRICE = "10000000000000000000000";

interface Recorded {
  method: string;
  url: string;
  authorization?: string;
  payment?: string;
}

function quoteFor(resource: string): { x402Version: number; accepts: X402Accept[] } {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "near:testnet",
        asset: "near",
        assetContract: "wrap.testnet",
        maxAmountRequired: PRICE,
        payTo: "seller.testnet",
        resource,
        validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        nonce: "nonce_1",
      },
    ],
  };
}

function signedFor(accept: X402Accept): SignedPayment {
  return {
    nonce: accept.nonce,
    payerId: "buyer.testnet",
    payerPublicKey: "ed25519:11111111111111111111111111111111",
    payTo: accept.payTo,
    asset: accept.asset,
    amount: accept.maxAmountRequired,
    validUntil: accept.validUntil,
    maxBlockHeight: 1,
    signedDelegate: "c2lnbmVk",
  };
}

const SETTLED = {
  run_id: "run_1",
  mode: "local",
  result: { metrics: { accuracy: 0.9, auc: 0.95, f1: 0.91 }, n_bucket: "200-499" },
  receipt: { exec_tx: "tx_exec", settle_tx: "tx_settle", wasm_hash: "a".repeat(64), attested: false },
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function gateway(requests: Recorded[]) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    requests.push({
      method: req.method ?? "",
      url,
      authorization: req.headers["authorization"],
      payment: firstHeader(req.headers["x-payment"]),
    });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.startsWith("/v1/listings?")) return send(200, { items: [{ id: "lst_1" }], next_cursor: null });
    if (req.method === "GET" && url === "/v1/runs/run_1") return send(200, { id: "run_1", state: "SETTLED" });
    if (req.method === "POST" && url === "/v1/listings/lst_1/evaluate") {
      return req.headers["x-payment"] ? send(200, SETTLED) : send(402, quoteFor(url));
    }
    send(404, { error: { code: "NOT_FOUND", message: url } });
  };
}

describe("securelambda MCP server", () => {
  let http: Server;
  let apiUrl: string;
  let requests: Recorded[];
  let signerCalls: number;

  const signer: PaymentSigner = (accept) => {
    signerCalls++;
    return signedFor(accept);
  };
  const payer: Payer = { accountId: "buyer.testnet", signer, headers: async () => ({ authorization: "Bearer test" }) };

  beforeEach(async () => {
    requests = [];
    signerCalls = 0;
    http = createHttpServer(gateway(requests));
    await new Promise<void>((resolve) => http.listen(0, () => resolve()));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("mock gateway has no port");
    apiUrl = `http://localhost:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  async function connect(limits: SpendLimits = {}, withPayer = true): Promise<Client> {
    const config: ServerConfig = { apiUrl, limits, payer: withPayer ? payer : undefined };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(config).connect(serverSide);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientSide);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
    const first = result.content[0];
    return { isError: result.isError ?? false, text: first?.type === "text" ? first.text : "" };
  }

  test("lists all eight tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "agent_wallet_status",
      "connect_agent_wallet",
      "evaluate",
      "get_listing",
      "get_receipt",
      "get_run",
      "list_listings",
      "quote_evaluation",
    ]);
  });

  describe("agent wallet", () => {
    let dir: string;
    let keyFile: string;
    let approved: boolean;
    let madePayerFor: string | undefined;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "sl-agent-"));
      keyFile = join(dir, "nested", "agent-key.json");
      approved = false;
      madePayerFor = undefined;
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    async function connectAgent(envPayer?: Payer): Promise<Client> {
      const agentWallet: AgentWalletConfig = {
        keyFile,
        dashboardUrl: "https://dash.test/",
        chain: { keyExists: async () => approved, balanceYocto: async () => 10n ** 24n },
        makePayer: (accountId) => {
          madePayerFor = accountId;
          return { ...payer, accountId };
        },
      };
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await createServer({ apiUrl, limits: {}, payer: envPayer, agentWallet }).connect(serverSide);
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(clientSide);
      return client;
    }

    test("connect writes a 0600 key file and returns a funding link for the key's implicit account", async () => {
      const client = await connectAgent();
      const { isError, text } = await call(client, "connect_agent_wallet", { budget_near: "0.5" });
      expect(isError).toBe(false);
      const body = JSON.parse(text);
      const stored = JSON.parse(readFileSync(keyFile, "utf8"));
      expect(body.account_id).toBe(Buffer.from(PublicKey.fromString(stored.public_key).data).toString("hex"));
      expect(body.status).toBe("awaiting_funding");
      const url = new URL(body.approve_url);
      expect(`${url.origin}${url.pathname}`).toBe("https://dash.test/connect-agent");
      expect(url.searchParams.get("account")).toBe(body.account_id);
      expect(url.searchParams.get("budget")).toBe("0.5");
      expect(statSync(keyFile).mode & 0o777).toBe(0o600);
      expect(stored.private_key).toMatch(/^ed25519:/);
      expect(text).not.toContain(stored.private_key.slice("ed25519:".length));
    });

    test("paying is refused until the account is funded, then uses the agent account", async () => {
      const client = await connectAgent();
      const { text } = await call(client, "connect_agent_wallet", {});
      const accountId = JSON.parse(text).account_id;

      const pending = await call(client, "quote_evaluation", { listing_id: "lst_1", model_id: "mdl_1" });
      expect(pending.isError).toBe(true);
      expect(pending.text).toContain("not funded yet");
      expect(requests).toHaveLength(0);

      approved = true;
      const quoted = await call(client, "quote_evaluation", { listing_id: "lst_1", model_id: "mdl_1" });
      expect(quoted.isError).toBe(false);
      expect(madePayerFor).toBe(accountId);
    });

    test("a second connect returns the existing wallet and never replaces the key", async () => {
      const client = await connectAgent();
      const first = JSON.parse((await call(client, "connect_agent_wallet", { budget_near: "1" })).text);
      const before = readFileSync(keyFile, "utf8");
      const second = JSON.parse((await call(client, "connect_agent_wallet", { budget_near: "5" })).text);
      expect(second.account_id).toBe(first.account_id);
      expect(second.note).toContain("not replaced");
      expect(readFileSync(keyFile, "utf8")).toBe(before);
    });

    test("status reports the balance once approved", async () => {
      const client = await connectAgent();
      await call(client, "connect_agent_wallet", {});
      approved = true;
      const body = JSON.parse((await call(client, "agent_wallet_status", {})).text);
      expect(body).toMatchObject({ source: "agent_wallet", status: "active", balance_yocto_near: (10n ** 24n).toString() });
      expect(body.approve_url).toBeUndefined();
    });

    test("connect is refused when the env already configures a payer", async () => {
      const client = await connectAgent(payer);
      const { isError, text } = await call(client, "connect_agent_wallet", {});
      expect(isError).toBe(true);
      expect(text).toContain("NEAR_ACCOUNT_ID buyer.testnet");
      expect(existsSync(keyFile)).toBe(false);
    });

    test("connect rejects a budget that is not a positive NEAR amount", async () => {
      const client = await connectAgent();
      const { isError } = await call(client, "connect_agent_wallet", { budget_near: "0" });
      expect(isError).toBe(true);
      expect(existsSync(keyFile)).toBe(false);
    });
  });

  test("list_listings forwards the search without login", async () => {
    const client = await connect({}, false);
    const { isError, text } = await call(client, "list_listings", { q: "diabetes", limit: 5 });
    expect(isError).toBe(false);
    expect(JSON.parse(text).items[0].id).toBe("lst_1");
    expect(requests[0]).toMatchObject({ method: "GET", url: "/v1/listings?q=diabetes&limit=5", authorization: undefined });
  });

  test("quote_evaluation returns the price without paying", async () => {
    const client = await connect();
    const { isError, text } = await call(client, "quote_evaluation", { listing_id: "lst_1", model_id: "mdl_1" });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toMatchObject({ amount: PRICE, token_contract: "wrap.testnet", pay_to: "seller.testnet" });
    expect(signerCalls).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.payment).toBeUndefined();
  });

  test("evaluate pays within the caps and returns metrics, run id, mode and receipt", async () => {
    const client = await connect({ maxPerRun: BigInt(PRICE), sessionBudget: BigInt(PRICE) });
    const { isError, text } = await call(client, "evaluate", { listing_id: "lst_1", model_id: "mdl_1", max_price: PRICE });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({
      run_id: "run_1",
      mode: "local",
      metrics: SETTLED.result.metrics,
      n_bucket: "200-499",
      receipt: SETTLED.receipt,
      amount_paid: PRICE,
      session_authorized_total: PRICE,
    });
    expect(signerCalls).toBe(1);
    expect(requests.map((r) => r.authorization)).toEqual(["Bearer test", "Bearer test"]);
    expect(requests[1]?.payment).toBeDefined();
  });

  test("evaluate refuses when the fresh quote exceeds max_price, without signing or retrying", async () => {
    const client = await connect();
    const { isError, text } = await call(client, "evaluate", { listing_id: "lst_1", model_id: "mdl_1", max_price: "1" });
    expect(isError).toBe(true);
    expect(text).toContain("exceeds max_price 1");
    expect(signerCalls).toBe(0);
    expect(requests).toHaveLength(1);
  });

  test("evaluate refuses above SECURELAMBDA_MAX_PER_RUN", async () => {
    const client = await connect({ maxPerRun: 5n });
    const { isError, text } = await call(client, "evaluate", { listing_id: "lst_1", model_id: "mdl_1", max_price: PRICE });
    expect(isError).toBe(true);
    expect(text).toContain("SECURELAMBDA_MAX_PER_RUN");
    expect(signerCalls).toBe(0);
  });

  test("evaluate refuses the call that would cross SECURELAMBDA_SESSION_BUDGET", async () => {
    const client = await connect({ sessionBudget: BigInt(PRICE) * 2n - 1n });
    const args = { listing_id: "lst_1", model_id: "mdl_1", max_price: PRICE };
    expect((await call(client, "evaluate", args)).isError).toBe(false);
    const second = await call(client, "evaluate", args);
    expect(second.isError).toBe(true);
    expect(second.text).toContain("SECURELAMBDA_SESSION_BUDGET");
    expect(signerCalls).toBe(1);
  });

  test("evaluate refuses without NEAR credentials and makes no request", async () => {
    const client = await connect({}, false);
    const { isError, text } = await call(client, "evaluate", { listing_id: "lst_1", model_id: "mdl_1", max_price: PRICE });
    expect(isError).toBe(true);
    expect(text).toContain("NEAR_ACCOUNT_ID");
    expect(requests).toHaveLength(0);
  });

  test("get_run reads the run with the login session", async () => {
    const client = await connect();
    const { isError, text } = await call(client, "get_run", { run_id: "run_1" });
    expect(isError).toBe(false);
    expect(JSON.parse(text).state).toBe("SETTLED");
    expect(requests[0]?.authorization).toBe("Bearer test");
  });

  test("get_receipt surfaces the gateway error", async () => {
    const client = await connect();
    const { isError, text } = await call(client, "get_receipt", { run_id: "run_missing" });
    expect(isError).toBe(true);
    expect(text).toContain("404 NOT_FOUND");
  });
});

describe("configFromEnv", () => {
  test("strips a trailing /v1 because the SDK adds it", () => {
    expect(configFromEnv({ SECURELAMBDA_API_URL: "http://x.test/v1/" }).apiUrl).toBe("http://x.test");
  });

  test("is read-only without both NEAR credentials", () => {
    expect(configFromEnv({ NEAR_ACCOUNT_ID: "buyer.testnet" }).payer).toBeUndefined();
  });

  test("rejects a cap that is not an integer base-unit amount", () => {
    expect(() => configFromEnv({ SECURELAMBDA_MAX_PER_RUN: "0.01" })).toThrow("SECURELAMBDA_MAX_PER_RUN");
  });
});
