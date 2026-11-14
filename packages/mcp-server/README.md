# @securelambda/mcp-server

A local stdio MCP server that lets Claude Code, Claude Desktop, Codex or any MCP client browse SecureLambda listings and pay for evaluation runs. It wraps `@securelambda/agent-sdk`: NEP-413 login, x402 quote, NEP-366 wNEAR payment, polling.

| Tool | Spends tokens | Needs NEAR credentials |
|---|---|---|
| `list_listings` (`q`, `limit`, `cursor`) | no | no |
| `get_listing` (`listing_id`) | no | no |
| `quote_evaluation` (`listing_id`, `model_id`) | no | yes (the evaluate endpoint requires login) |
| `evaluate` (`listing_id`, `model_id`, `max_price`) | **yes** | yes |
| `get_run` (`run_id`) | no | yes |
| `get_receipt` (`run_id`) | no | yes |
| `connect_agent_wallet` (`budget_near`) | no | no |
| `agent_wallet_status` | no | no |

## Agent wallet (no private key in your config)

Instead of pasting a key into the client config, let the agent make its own wallet:

1. Ask the agent to connect, e.g. "connect a SecureLambda agent wallet with 1 NEAR". It calls `connect_agent_wallet`, which generates a key on this machine (`~/.securelambda/agent-key.json`, mode 0600, never overwritten) and returns a link. The agent's account is the NEAR implicit account for that key (64 hex characters).
2. Open the link, connect any wallet and send the budget as a plain transfer. No key permission is requested, so every wallet accepts it.
3. The agent now pays from its own account. It can spend at most what you sent (NEAR is wrapped to wNEAR as needed); your account and its keys are never exposed. Top it up by sending more.

`NEAR_ACCOUNT_ID`/`NEAR_PRIVATE_KEY`, when set, take precedence and `connect_agent_wallet` refuses. `SECURELAMBDA_AGENT_KEY_FILE` and `SECURELAMBDA_DASHBOARD_URL` override the key file path and the approve page host.

`evaluate` returns only what the API returns: rounded aggregate metrics, a row-count bucket, the run id, the mode (`enclave` or `local`) and the receipt. No rows, no per-row predictions.

The model must already be uploaded (sealed) to the listing; this server does not upload models. Use the dashboard or the SDK to get a `model_id`.

## Spend caps

All amounts are integer strings in token base units, the same units as `price_amount` and the quote's `amount`. wNEAR has 24 decimals: `10000000000000000000000` is 0.01 NEAR.

- `max_price` (required on every `evaluate` call): the caller's limit for this run.
- `SECURELAMBDA_MAX_PER_RUN` (env, optional): the highest price any single run may cost.
- `SECURELAMBDA_SESSION_BUDGET` (env, optional): total that may be authorized while this server process runs. It resets when the client restarts the server.

The caps are checked against the fresh quote at the moment of signing, before anything is signed. A refused call signs nothing and sends no payment. A run that fails after payment was signed (for example `FAILED_NOT_CHARGED`) still counts against the session budget, so the budget errs on the side of spending less. Leaving an env cap unset means no limit of that kind, so set both.

Without `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY`, the server runs read-only: listing tools work, everything else refuses.

## Configuration

| Variable | Meaning |
|---|---|
| `SECURELAMBDA_API_URL` | API base URL, with or without `/v1`. Default `https://secure-lambda-api.projectdeadwood.my.id` |
| `NEAR_ACCOUNT_ID` | Buyer account, e.g. `my-agent.testnet` |
| `NEAR_PRIVATE_KEY` | `ed25519:...` full-access key of that account |
| `NEAR_RPC_URL` | Optional NEAR RPC override |
| `NEAR_AUTO_WRAP` | `1` lets the signer wrap NEAR into wNEAR when the wNEAR balance is short |
| `SECURELAMBDA_MAX_PER_RUN`, `SECURELAMBDA_SESSION_BUDGET` | See above |

> **Warning.** Every client config below stores `NEAR_PRIVATE_KEY` in plain text on disk (`~/.claude.json`, `claude_desktop_config.json`, `~/.codex/config.toml`). Use a dedicated testnet account that holds only what you are willing to lose, never your main account. Set both spend caps.

Published as [`@securelambda/mcp-server`](https://www.npmjs.com/package/@securelambda/mcp-server): a single file with no dependencies, run with `npx` on Node.js 20 or later. To run from a checkout instead, `npm ci && npm run build` at the repo root and point the client at `node packages/mcp-server/dist/index.js`.

### Claude Code

```sh
claude mcp add --scope user \
  --env SECURELAMBDA_API_URL=https://secure-lambda-api.projectdeadwood.my.id \
  --env NEAR_ACCOUNT_ID=my-agent.testnet \
  --env NEAR_PRIVATE_KEY=ed25519:... \
  --env SECURELAMBDA_MAX_PER_RUN=50000000000000000000000 \
  --env SECURELAMBDA_SESSION_BUDGET=100000000000000000000000 \
  --transport stdio securelambda -- npx -y @securelambda/mcp-server
```

Keep an option such as `--transport stdio` between the last `--env` and the server name; otherwise the CLI reads the name as another `KEY=value` pair. Check with `claude mcp get securelambda`.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "securelambda": {
      "command": "npx",
      "args": ["-y", "@securelambda/mcp-server"],
      "env": {
        "SECURELAMBDA_API_URL": "https://secure-lambda-api.projectdeadwood.my.id",
        "NEAR_ACCOUNT_ID": "my-agent.testnet",
        "NEAR_PRIVATE_KEY": "ed25519:...",
        "SECURELAMBDA_MAX_PER_RUN": "50000000000000000000000",
        "SECURELAMBDA_SESSION_BUDGET": "100000000000000000000000"
      }
    }
  }
}
```

Restart Claude Desktop after editing.

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.securelambda]
command = "npx"
args = ["-y", "@securelambda/mcp-server"]
tool_timeout_sec = 240

[mcp_servers.securelambda.env]
SECURELAMBDA_API_URL = "https://secure-lambda-api.projectdeadwood.my.id"
NEAR_ACCOUNT_ID = "my-agent.testnet"
NEAR_PRIVATE_KEY = "ed25519:..."
SECURELAMBDA_MAX_PER_RUN = "50000000000000000000000"
SECURELAMBDA_SESSION_BUDGET = "100000000000000000000000"
```

`evaluate` polls the run for up to 3 minutes, so raise `tool_timeout_sec` above Codex's default. The CLI equivalent is `codex mcp add securelambda --env KEY=VALUE ... -- npx -y @securelambda/mcp-server`.

## Smoke test

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx -y @securelambda/mcp-server
```

## Listing on NEAR Agent Market

[NEAR Agent Market](https://docs.market.near.ai/) lists *agents* that take paid jobs, not bare MCP servers. To offer SecureLambda evaluations there, you run an agent that uses this server (or the SDK) to do the work, and register that agent:

1. Create an account at https://market.near.ai and confirm the email address.
2. Building → Your agents → New agent: set a name, handle and one-line tagline.
3. Hosting: choose **Self-hosted** and leave the webhook URL empty. The agent is saved as a draft.
4. Set **Price per hire** and **Delivery SLA**; an agent needs a price before it can go live.
5. **Create token** and copy the `aat_…` value (shown once). Keep it out of the repo.
6. Have the agent poll `GET /v1/agents/me/assignments` on `https://market.near.ai` with `Authorization: Bearer aat_…`, call `POST /v1/assignments/{id}/start`, do the evaluation, then `POST /v1/assignments/{id}/submit` with `{"deliverableMarkdown": "..."}`. The marketplace also exposes these as MCP tools at `https://market.near.ai/mcp`.
7. Use **Test run** on `https://market.near.ai/a/<handle>` (free) to check the loop.
8. Set **Listing status** to **Live**.

Nothing has been registered or published for this project yet.
