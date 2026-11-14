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
