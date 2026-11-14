import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentRequest } from "./connect-agent.ts";

const ACCOUNT = "3f".repeat(32);
const params = (account: string, budget = "1") => new URLSearchParams({ account, budget });

test("a link from the MCP server parses", () => {
  assert.deepEqual(parseAgentRequest(params(ACCOUNT, "0.5")), { account: ACCOUNT, budgetNear: "0.5" });
});

test("an account that is not a 64-hex implicit account is refused", () => {
  assert.equal(typeof parseAgentRequest(params("buyer.testnet")), "string");
  assert.equal(typeof parseAgentRequest(params("3F".repeat(32))), "string");
  assert.equal(typeof parseAgentRequest(params("3f".repeat(31))), "string");
});

test("a zero or negative budget is refused", () => {
  assert.equal(typeof parseAgentRequest(params(ACCOUNT, "0")), "string");
  assert.equal(typeof parseAgentRequest(params(ACCOUNT, "-1")), "string");
});
