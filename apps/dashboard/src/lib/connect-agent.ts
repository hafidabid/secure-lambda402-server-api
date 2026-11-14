export interface AgentRequest {
  account: string;
  budgetNear: string;
}

const IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;
const NEAR_AMOUNT = /^\d+(\.\d{1,24})?$/;

export function parseAgentRequest(params: URLSearchParams): AgentRequest | string {
  const account = params.get("account") ?? "";
  const budgetNear = params.get("budget") ?? "";
  if (!IMPLICIT_ACCOUNT.test(account)) return "This link has no valid agent account. Ask your agent for a new link.";
  if (!NEAR_AMOUNT.test(budgetNear) || Number(budgetNear) <= 0) return "This link has no valid budget. Ask your agent for a new link.";
  return { account, budgetNear };
}

export type ConnectPhase = "checking" | "ready" | "sending" | "confirming" | "done";
export type ConnectStepKey = "wallet" | "approve" | "confirm" | "agent";
export type ConnectStepStatus = "done" | "active" | "pending";

const STEP_KEYS: ConnectStepKey[] = ["wallet", "approve", "confirm", "agent"];

function activeStep(walletConnected: boolean, phase: ConnectPhase): ConnectStepKey {
  if (phase === "confirming" || phase === "done") return "confirm";
  if (phase === "sending") return "approve";
  return walletConnected ? "approve" : "wallet";
}

export function connectSteps({ walletConnected, phase, funded }: { walletConnected: boolean; phase: ConnectPhase; funded: boolean }) {
  const active = funded ? null : STEP_KEYS.indexOf(activeStep(walletConnected, phase));
  return STEP_KEYS.map((key, i): { key: ConnectStepKey; status: ConnectStepStatus } => {
    if (active === null || i < active) return { key, status: "done" };
    return { key, status: i === active ? "active" : "pending" };
  });
}
