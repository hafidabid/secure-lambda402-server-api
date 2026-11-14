"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, Loader2 } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { accountExists, MOCKING } from "@/lib/near";
import { AgentRequest, parseAgentRequest } from "@/lib/connect-agent";
import { errorMessage, nearToYocto, shortHash } from "@/lib/format";
import { Btn, CopyIconButton, Engraved, Led, NearLogo, Page, PageError, PageTitle, Panel, Slot } from "@/components/ui";

type Phase = "checking" | "ready" | "sending" | "done";

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
  const [phase, setPhase] = useState<Phase>("checking");
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
        <Slot className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <Led tone={statusTone(phase, funded)} pulse={phase === "sending"} />
          <span className="flex-1 text-[15px] font-medium">{statusLabel(phase, funded)}</span>
          {!funded && wallet.status !== "connected" && (
            <Btn variant="outline" className="h-9 px-4 text-[14px]" onClick={wallet.connect} disabled={wallet.status !== "disconnected"}>
              <NearLogo />
              Connect wallet
            </Btn>
          )}
          {!funded && wallet.status === "connected" && (
            <Btn className="h-9 px-4 text-[14px]" onClick={() => void send()} disabled={phase !== "ready"}>
              {phase === "sending" && <Loader2 className="size-4 animate-spin" />}
              Send {request.budgetNear} NEAR
            </Btn>
          )}
        </Slot>
        {phase === "done" && !funded && (
          <p className="px-1 text-[13px] text-etch-2">The wallet finished, but the account is not visible on chain yet. Refresh in a minute.</p>
        )}
        {error && <p className="px-1 text-[13px] text-etch-2">{error}</p>}
      </Panel>
    </Page>
  );
}

function statusTone(phase: Phase, funded: boolean): "ok" | "signal" | "off" {
  if (funded) return "ok";
  return phase === "sending" ? "signal" : "off";
}

function statusLabel(phase: Phase, funded: boolean): string {
  if (funded) return "Funded. Go back to your agent; it can pay now.";
  if (phase === "checking") return "Checking…";
  if (phase === "sending") return "Waiting for your wallet…";
  return "Not funded yet";
}
