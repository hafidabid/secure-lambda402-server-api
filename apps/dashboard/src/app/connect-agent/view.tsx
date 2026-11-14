"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { accountExists, MOCKING } from "@/lib/near";
import { AgentRequest, connectSteps, parseAgentRequest, type ConnectPhase, type ConnectStepKey, type ConnectStepStatus } from "@/lib/connect-agent";
import { errorMessage, nearToYocto, shortHash } from "@/lib/format";
import { ClaudeCodeLogo, CodexLogo } from "@/components/instrument/logos";
import { Btn, CopyIconButton, Led, NearLogo, Page, PageError, PageTitle, Panel, Slot, cn, type LedTone } from "@/components/ui";

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

  const steps = connectSteps({ walletConnected: wallet.status === "connected", phase, funded });
  const current = steps.find((step) => step.status === "active")?.key ?? "agent";
  const busy = phase === "sending" || phase === "confirming";

  return (
    <Page className="max-w-[560px]">
      <PageTitle>Connect your agent</PageTitle>
      <Panel className="flex flex-col gap-5">
        <ConnectProgress steps={steps} busy={busy} />
        <Slot className="flex flex-col items-start gap-4 px-5 py-5">
          <p className="text-[18px] font-semibold leading-snug">{headline(current, phase, funded, request.budgetNear)}</p>
          {current === "wallet" && (
            <Btn className="h-11 px-5" onClick={wallet.connect} disabled={wallet.status !== "disconnected"}>
              <NearLogo />
              Connect wallet
            </Btn>
          )}
          {current === "approve" && (
            <Btn className="h-11 px-5" onClick={() => void send()} disabled={phase !== "ready"}>
              {phase === "sending" && <Loader2 className="size-4 animate-spin" />}
              {phase === "sending" ? "Approve in your wallet" : `Send ${request.budgetNear} NEAR`}
            </Btn>
          )}
          {error && <p className="text-[13px] text-etch-2">{error}</p>}
        </Slot>
        <div className="flex items-center gap-2 px-1 font-readout text-[13px] text-etch-3">
          <span className="flex shrink-0 items-center gap-2 text-etch">
            <ClaudeCodeLogo className="size-5" />
            <CodexLogo className="size-5" />
          </span>
          <span className="min-w-0 truncate">{shortHash(request.account, 8)}</span>
          <CopyIconButton content={request.account} label="Copy agent account" />
          <span className="ml-auto shrink-0">Budget {request.budgetNear} NEAR</span>
        </div>
      </Panel>
    </Page>
  );
}

const STEP_LABEL: Record<ConnectStepKey, string> = { wallet: "Wallet", approve: "Send", confirm: "Confirm", agent: "Ready" };
const STEP_TONE: Record<ConnectStepStatus, LedTone> = { done: "ok", active: "signal", pending: "off" };

function ConnectProgress({ steps, busy }: { steps: { key: ConnectStepKey; status: ConnectStepStatus }[]; busy: boolean }) {
  return (
    <ol aria-label="Connection progress" className="grid grid-cols-4 px-1">
      {steps.map(({ key, status }, i) => (
        <li key={key} className="relative flex flex-col items-center gap-2">
          {i > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-[calc(-50%+10px)] right-[calc(50%+10px)] top-[4px] h-0.5 rounded-full transition-colors duration-300",
                status === "pending" ? "bg-chassis-deep" : "bg-led",
              )}
            />
          )}
          <Led tone={STEP_TONE[status]} pulse={status === "active" && busy} className="relative" />
          <span className={cn("font-engraved text-[12px] font-semibold uppercase tracking-[0.12em]", status === "pending" ? "text-etch-3" : "text-etch")}>
            {STEP_LABEL[key]}
            <span className="sr-only"> ({status})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function headline(current: ConnectStepKey, phase: ConnectPhase, funded: boolean, budgetNear: string): string {
  if (funded) return "Connected. Go back to your agent.";
  if (current === "wallet") return "Connect the wallet that funds your agent.";
  if (current === "approve") return `Send ${budgetNear} NEAR. Your agent can spend only this.`;
  if (phase === "done") return "Sent, but not visible yet. Refresh in a minute.";
  return "Confirming on NEAR…";
}
