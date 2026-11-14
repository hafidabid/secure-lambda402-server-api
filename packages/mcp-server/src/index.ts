#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv } from "./config";
import { createServer } from "./server";

async function main(): Promise<void> {
  const config = configFromEnv(process.env);
  await createServer(config).connect(new StdioServerTransport());
  // stdout carries JSON-RPC, so diagnostics go to stderr.
  console.error(`securelambda mcp: ${config.apiUrl}, payer ${config.payer?.accountId ?? "none (read-only)"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
