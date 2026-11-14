"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { useWallet } from "@/lib/wallet";
import { Btn, NearLogo, SealIcon, cn } from "./ui";

const NAV = [
  { href: "/listings", label: "Catalog" },
  { href: "/sell/new", label: "Sell" },
  { href: "/sell/runs", label: "Runs" },
];

function WalletButton() {
  const { status, accountId, connect, disconnect } = useWallet();

  if (status === "connected" && accountId) {
    return (
      <button
        onClick={disconnect}
        title="Disconnect"
        className="group inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface pl-3 pr-1 font-mono text-[13px] cursor-pointer hover:bg-hover"
      >
        <NearLogo className="size-4 text-ink" />
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-ink px-3 text-glow">
          {accountId}
          <LogOut className="hidden size-3 group-hover:inline" />
        </span>
      </button>
    );
  }

  return (
    <Btn onClick={() => connect()} disabled={status === "connecting"} className="h-9">
      {status === "connecting" ? <Loader2 className="animate-spin" /> : <NearLogo className="text-white" />}
      {status === "connecting" ? "Connecting…" : "Connect wallet"}
    </Btn>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 md:px-8">
      <div className="flex flex-wrap items-center gap-6">
        <Link href="/" className="flex items-center gap-2.5">
          <SealIcon />
          <span className="text-[15px] font-semibold">SecureLambda</span>
        </Link>
        <Highlight hover controlledItems mode="parent" className="rounded-md bg-hover" containerClassName="flex gap-1">
          <nav aria-label="Main" className="flex gap-1">
            {NAV.map((item) => (
              <HighlightItem key={item.href} value={item.href} asChild>
                <Link
                  href={item.href}
                  className={cn(
                    "relative z-10 rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:text-ink",
                    pathname.startsWith(item.href) && "bg-hover font-medium text-ink",
                  )}
                >
                  {item.label}
                </Link>
              </HighlightItem>
            ))}
          </nav>
        </Highlight>
      </div>
      <WalletButton />
    </header>
  );
}
