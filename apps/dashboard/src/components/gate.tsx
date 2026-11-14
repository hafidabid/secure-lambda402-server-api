"use client";

import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/session";
import { Btn, Engraved, Led, NearLogo, PageError, Panel, Slot } from "./ui";

function Step({ done, label, children }: { done: boolean; label: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-chassis-deep/50 px-4 py-3.5 last:border-0">
      <Led tone={done ? "ok" : "off"} />
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      {children}
    </li>
  );
}

export function SignInGate({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  const session = useSession();
  const { wallet } = session;
  if (session.status === "signed-in") return <>{children}</>;

  const connected = wallet.status === "connected";
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-4 py-14 sm:px-6">
      <h1 className="text-balance text-[clamp(1.75rem,3.4vw,2.25rem)] font-bold leading-[1.05] tracking-[-0.02em]">{title}</h1>
      <p className="text-[16px] leading-relaxed text-etch-2">{lead}</p>
      <Panel className="flex flex-col gap-3">
        <Engraved>Sign in with NEAR</Engraved>
        <Slot>
          <ol>
            <Step done={connected} label={connected ? `Wallet: ${wallet.accountId}` : "Connect a NEAR wallet"}>
              {!connected && (
                <Btn variant="outline" className="h-9 px-4 text-[14px]" onClick={wallet.connect} disabled={wallet.status !== "disconnected"}>
                  <NearLogo />
                  Connect
                </Btn>
              )}
            </Step>
            <Step done={false} label="Sign a one-time message (no gas, nothing on-chain)">
              {connected && (
                <Btn className="h-9 px-4 text-[14px]" onClick={() => void session.signIn()} disabled={session.status === "signing-in"}>
                  {session.status === "signing-in" && <Loader2 className="animate-spin" />}
                  Sign in
                </Btn>
              )}
            </Step>
          </ol>
        </Slot>
      </Panel>
      {session.signInError && <PageError message={session.signInError} />}
    </div>
  );
}

export function SignedInAction({ children, className }: { children: React.ReactNode; className?: string }) {
  const session = useSession();
  const { wallet } = session;
  if (session.status === "signed-in") return <>{children}</>;
  if (wallet.status !== "connected") {
    return (
      <Btn variant="outline" className={className} onClick={wallet.connect} disabled={wallet.status !== "disconnected"}>
        <NearLogo />
        Connect wallet to continue
      </Btn>
    );
  }
  return (
    <span className="flex flex-col items-end gap-2">
      <Btn className={className} onClick={() => void session.signIn()} disabled={session.status === "signing-in"}>
        {session.status === "signing-in" && <Loader2 className="animate-spin" />}
        Sign in to continue
      </Btn>
      {session.signInError && <span className="text-[13px] text-etch-2">{session.signInError}</span>}
    </span>
  );
}
