"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useSession } from "@/lib/session";
import { Btn, Engraved, Led, NearLogo, Panel, Slot } from "@/components/ui";

const SELLER = [
  { label: "Describe your dataset and pick the CSV", href: "/sell/new" },
  { label: "Check the 5 made-up sample rows", href: "/sell/new" },
  { label: "Set price and limits", href: "/sell/new" },
  { label: "Encrypt, upload and publish", href: "/sell/new" },
];

const BUYER = [
  { label: "Pick a dataset", href: "/listings" },
  { label: "Add model.json and check it on this device", href: "/listings" },
  { label: "Encrypt and upload", href: "/listings" },
  { label: "Run once, or hand it to your agent", href: "/listings" },
];

export function StartView() {
  const role = useSearchParams().get("role") === "seller" ? "seller" : "buyer";
  const session = useSession();
  const { wallet } = session;
  const signedIn = session.status === "signed-in";
  const steps = role === "seller" ? SELLER : BUYER;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-14 sm:px-6">
      <h1 className="text-balance text-[clamp(1.75rem,3.4vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.02em]">
        {role === "seller" ? "Sell runs on your data" : "Test your model"}
      </h1>
      <Panel className="flex flex-col gap-3">
        <Engraved className="px-1">{role === "seller" ? "Seller setup" : "Buyer setup"}</Engraved>
        <Slot>
          <ol>
            <li className="flex flex-wrap items-center gap-3 border-b border-chassis-deep/50 px-4 py-3.5">
              <Led tone={signedIn ? "ok" : "signal"} />
              <span className="flex-1 text-[15px] font-medium">Sign in with a NEAR wallet</span>
              {signedIn && <span className="font-readout text-[13px] text-etch-3">{wallet.accountId}</span>}
              {!signedIn && wallet.status !== "connected" && (
                <Btn variant="outline" className="h-9 px-4 text-[14px]" onClick={wallet.connect} disabled={wallet.status !== "disconnected"}>
                  <NearLogo />
                  Connect
                </Btn>
              )}
              {!signedIn && wallet.status === "connected" && (
                <Btn className="h-9 px-4 text-[14px]" onClick={() => void session.signIn()} disabled={session.status === "signing-in"}>
                  Sign in
                </Btn>
              )}
            </li>
            {steps.map((s, i) => {
              const next = signedIn && i === 0;
              return (
                <li key={s.label} className="flex items-center gap-3 border-b border-chassis-deep/50 px-4 py-3.5 last:border-0">
                  <Led tone={next ? "signal" : "off"} />
                  <span className={next ? "flex-1 text-[15px] font-medium" : "flex-1 text-[15px] text-etch-2"}>{s.label}</span>
                  {next && (
                    <Link href={s.href} className="inline-flex items-center gap-1 text-[14px] font-semibold underline">
                      Start<ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </Slot>
      </Panel>
      {session.signInError && <p className="text-[14px] text-etch-2">{session.signInError}</p>}
    </div>
  );
}
