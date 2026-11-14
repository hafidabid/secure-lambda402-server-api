"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { Btn, cn } from "@/components/ui";

const SELLER = [
  { label: "Describe your dataset and pick the CSV", href: "/sell/new" },
  { label: "Check the 5 synthetic rows", href: "/sell/new" },
  { label: "Set price and limits", href: "/sell/new" },
  { label: "Encrypt, upload and publish", href: "/sell/new" },
];

const BUYER = [
  { label: "Pick a dataset", href: "/listings" },
  { label: "Add model.json and test it locally", href: "/listings" },
  { label: "Encrypt and upload", href: "/listings" },
  { label: "Run once, or hand it to your agent", href: "/listings" },
];

export function StartView() {
  const role = useSearchParams().get("role") === "seller" ? "seller" : "buyer";
  const wallet = useWallet();
  const connected = wallet.status === "connected";
  const steps = role === "seller" ? SELLER : BUYER;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6 px-6 py-14">
      <h1 className="text-[28px] font-semibold tracking-tight">{role === "seller" ? "Sell runs on your data" : "Test your model"}</h1>
      <ol className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface">
        <li className="flex items-center gap-3 border-b border-surface-2 px-5 py-4">
          <span className={cn("flex size-6 items-center justify-center rounded-full", connected ? "bg-seal" : "border-2 border-seal")}>
            {connected && <Check className="size-3.5 text-white" strokeWidth={3} />}
          </span>
          <span className="flex-1 text-sm font-medium">Connect a NEAR wallet</span>
          {connected ? (
            <span className="font-mono text-xs text-muted">{wallet.accountId}</span>
          ) : (
            <Btn className="h-8" onClick={() => wallet.connect(role === "seller" ? "hospital.testnet" : undefined)}>Connect</Btn>
          )}
        </li>
        {steps.map((s, i) => {
          const active = connected && i === 0;
          return (
            <li key={s.label} className="flex items-center gap-3 border-b border-surface-2 px-5 py-4 last:border-0">
              <span className={cn("flex size-6 items-center justify-center rounded-full border font-mono text-[11px]", active ? "border-2 border-seal text-seal" : "border-line-strong text-muted")}>{i + 2}</span>
              <span className={cn("flex-1 text-sm", active ? "font-medium" : "text-ink-2")}>{s.label}</span>
              {active && (
                <Link href={s.href} className="inline-flex items-center gap-1 text-sm font-medium text-seal hover:text-seal-strong">
                  Start<ArrowRight className="size-3.5" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
