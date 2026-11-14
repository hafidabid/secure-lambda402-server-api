"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { useSession } from "@/lib/session";
import { useHydrated } from "@/lib/hydrated";
import { Btn, Led, NearLogo, SecureLambdaMark, cn } from "./ui";

const NAV = [
  { href: "/listings", label: "Datasets" },
  { href: "/sell/new", label: "Sell" },
  { href: "/sell/runs", label: "Runs" },
  { href: "/docs", label: "Docs" },
];

function AccountControl() {
  const session = useSession();
  const { wallet } = session;
  const hydrated = useHydrated();

  if (!hydrated || wallet.status === "loading") return <span className="h-10 w-36 animate-pulse rounded-full bg-chassis" aria-hidden="true" />;

  if (wallet.status !== "connected") {
    return (
      <Btn variant="outline" onClick={wallet.connect} disabled={wallet.status === "connecting"} className="h-10 px-4 text-[14px]">
        {wallet.status === "connecting" ? <Loader2 className="animate-spin" /> : <NearLogo />}
        {wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
      </Btn>
    );
  }

  if (session.status !== "signed-in") {
    return (
      <Btn onClick={() => void session.signIn()}
        title={session.signInError ?? undefined} disabled={session.status === "signing-in"} className="h-10 px-4 text-[14px]">
        {session.status === "signing-in" && <Loader2 className="animate-spin" />}
        Sign in as {wallet.accountId}
      </Btn>
    );
  }

  return (
    <button
      onClick={() => void session.signOut()}
      title="Sign out"
      className="group inline-flex h-10 cursor-pointer items-center gap-2.5 rounded-full bg-slot pl-3.5 pr-2 font-readout text-[13px] shadow-[inset_0_2px_4px_rgba(40,36,28,0.14)]"
    >
      <Led tone="ok" />
      <span className="max-w-[150px] truncate">{wallet.accountId}</span>
      <span className="flex size-7 items-center justify-center rounded-full text-etch-3 group-hover:bg-chassis group-hover:text-etch">
        <LogOut className="size-3.5" />
      </span>
    </button>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <header className="border-b border-chassis-deep">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/" className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.01em]">
            <SecureLambdaMark className="size-8 shrink-0" />
            SecureLambda
          </Link>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname.startsWith(item.href) ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1.5 font-engraved text-[14px] font-semibold uppercase tracking-[0.12em] text-etch-3 hover:text-etch",
                  pathname.startsWith(item.href) && "bg-chassis text-etch shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <AccountControl />
      </div>
    </header>
  );
}
