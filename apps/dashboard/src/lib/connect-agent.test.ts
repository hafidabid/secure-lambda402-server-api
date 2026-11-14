import { test } from "node:test";
import assert from "node:assert/strict";
import { connectSteps, parseAgentRequest } from "./connect-agent.ts";

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

const statuses = (state: Parameters<typeof connectSteps>[0]) => connectSteps(state).map((s) => `${s.key}:${s.status}`);

test("before the wallet is connected, connecting is the active step", () => {
  assert.deepEqual(statuses({ walletConnected: false, phase: "ready", funded: false }), ["wallet:active", "approve:pending", "confirm:pending", "agent:pending"]);
});

test("while the wallet is open, approving is the active step", () => {
  assert.deepEqual(statuses({ walletConnected: true, phase: "sending", funded: false }), ["wallet:done", "approve:active", "confirm:pending", "agent:pending"]);
});

test("after approval, waiting for the chain is the active step", () => {
  assert.deepEqual(statuses({ walletConnected: true, phase: "confirming", funded: false }), ["wallet:done", "approve:done", "confirm:active", "agent:pending"]);
});

test("once funded every step is done, even after a reload with no wallet connected", () => {
  assert.deepEqual(statuses({ walletConnected: false, phase: "ready", funded: true }), ["wallet:done", "approve:done", "confirm:done", "agent:done"]);
});
