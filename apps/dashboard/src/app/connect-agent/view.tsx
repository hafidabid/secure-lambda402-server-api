"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, Loader2 } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { accountExists, MOCKING } from "@/lib/near";
import { AgentRequest, connectSteps, parseAgentRequest, type ConnectPhase, type ConnectStepKey, type ConnectStepStatus } from "@/lib/connect-agent";
import { errorMessage, nearToYocto, shortHash } from "@/lib/format";
import { Btn, CopyIconButton, Engraved, Led, NearLogo, Page, PageError, PageTitle, Panel, Slot, type LedTone } from "@/components/ui";

const POLL_MS = 3000;
const POLL_TRIES = 20;

function useFunded(request: AgentRequest | null) {
  const [funded, setFunded] = useState(false);
  const check = useCallback(async () => {
    if (!request || MOCKING) return false;
    const exists = await accountExists(request.account);
    setFunded(exists);
    return exists;
  }, [request]);
  return { funded, setFunded, check };
}

export function ConnectAgentView() {
  const query = useSearchParams().toString();
  const parsed = useMemo(() => parseAgentRequest(new URLSearchParams(query)), [query]);
  const request = typeof parsed === "string" ? null : parsed;
  const wallet = useWallet();
  const { funded, setFunded, check } = useFunded(request);
  const [phase, setPhase] = useState<ConnectPhase>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void check().then(() => setPhase("ready"));
  }, [check]);

  if (!request) return <Page><PageError message={typeof parsed === "string" ? parsed : "Invalid link"} /></Page>;

  const send = async () => {
    setError(null);
    setPhase("sending");
    try {
      await wallet.sendNear(request.account, BigInt(nearToYocto(request.budgetNear)));
      setPhase("confirming");
      if (MOCKING) {
        setFunded(true);
      } else {
        for (let i = 0; i < POLL_TRIES && !(await check()); i++) await new Promise((r) => setTimeout(r, POLL_MS));
      }
      setPhase("done");
    } catch (e) {
      setError(errorMessage(e));
      setPhase("ready");
    }
  };

  return (
    <Page className="max-w-[640px]">
      <PageTitle>Connect your agent</PageTitle>
      <Panel className="flex flex-col gap-3">
        <Engraved className="px-1">Agent wallet</Engraved>
        <Slot className="flex flex-col gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Bot className="size-5" />
            <span className="flex-1 font-readout text-[14px]">{shortHash(request.account, 10)}</span>
            <CopyIconButton content={request.account} label="Copy agent account" />
          </div>
          <p className="text-[14px] leading-relaxed text-etch-2">
            Your AI agent made its own NEAR account; its key never left your computer. Send it <strong>{request.budgetNear} NEAR</strong>{" "}
            from your wallet as a normal transfer. The agent can spend at most what you send, never anything in your own account. Top it up
            by sending more; stop it by sending nothing more.
          </p>
        </Slot>
        <Slot>
          <ol aria-label="Connection progress">
            {connectSteps({ walletConnected: wallet.status === "connected", phase, funded }).map(({ key, status }) => (
              <li key={key} className="flex flex-wrap items-center gap-3 border-b border-chassis-deep/50 px-4 py-3.5 last:border-0">
                <Led tone={STEP_TONE[status]} pulse={status === "active" && (phase === "sending" || phase === "confirming")} />
                <span className={status === "pending" ? "flex-1 text-[15px] text-etch-3" : "flex-1 text-[15px] font-medium"}>
                  {stepLabel(key, request.budgetNear)}
                  <span className="sr-only"> ({status})</span>
                </span>
                {status === "active" && key === "wallet" && (
                  <Btn variant="outline" className="h-9 px-4 text-[14px]" onClick={wallet.connect} disabled={wallet.status !== "disconnected"}>
                    <NearLogo />
                    Connect wallet
                  </Btn>
                )}
                {status === "active" && key === "approve" && (
                  <Btn className="h-9 px-4 text-[14px]" onClick={() => void send()} disabled={phase !== "ready"}>
                    {phase === "sending" && <Loader2 className="size-4 animate-spin" />}
                    {phase === "sending" ? "Approve in your wallet" : `Send ${request.budgetNear} NEAR`}
                  </Btn>
                )}
                {status === "active" && key === "confirm" && phase === "confirming" && (
                  <span className="flex items-center gap-2 text-[13px] text-etch-3">
                    <Loader2 className="size-4 animate-spin" />
                    Waiting for the transfer to land
                  </span>
                )}
                {status === "done" && key === "agent" && (
                  <span className="w-full pl-[22px] text-[13px] text-etch-2">Ask your agent to check agent_wallet_status, then run.</span>
                )}
              </li>
            ))}
          </ol>
        </Slot>
        {phase === "done" && !funded && (
          <p className="px-1 text-[13px] text-etch-2">The wallet finished, but the account is not visible on chain yet. Refresh in a minute.</p>
        )}
        {error && <p className="px-1 text-[13px] text-etch-2">{error}</p>}
      </Panel>
    </Page>
  );
}

const STEP_TONE: Record<ConnectStepStatus, LedTone> = { done: "ok", active: "signal", pending: "off" };

function stepLabel(key: ConnectStepKey, budgetNear: string): string {
  if (key === "wallet") return "Connect your NEAR wallet";
  if (key === "approve") return `Send ${budgetNear} NEAR to the agent`;
  if (key === "confirm") return "Confirm on NEAR testnet";
  return "Go back to your agent";
}
