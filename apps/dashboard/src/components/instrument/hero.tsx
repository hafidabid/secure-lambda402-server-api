"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { DOCS, LIVE_RUN_TX, REPO } from "./data";
import { DataField } from "./data-field";
import { BuiltWith } from "./faq";
import { SecureLambdaMark } from "./logos";
import { KeyLink } from "./panel";

function WalletLink() {
  const { status, accountId, connect } = useWallet();
  if (status === "connected" && accountId) {
    return <span className="font-readout text-[13px] text-etch-2">{accountId}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => connect()}
      disabled={status === "connecting"}
      className="inline-flex h-11 cursor-pointer items-center rounded-full bg-etch px-5 text-[15px] font-semibold text-panel transition-colors hover:bg-etch-2 disabled:cursor-wait"
    >
      {status === "connecting" ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-[1296px] flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 pt-5 sm:px-8">
      <Link href="/" className="flex h-11 items-center gap-2.5 text-[19px] font-bold tracking-[-0.01em]">
        <SecureLambdaMark className="size-8" />
        SecureLambda
      </Link>
      <nav aria-label="Main" className="flex flex-wrap items-center gap-x-6 text-[15px] font-medium">
        <a href="#how" className="hidden h-11 items-center hover:underline md:inline-flex">How it works</a>
        <a href="#use-cases" className="hidden h-11 items-center hover:underline md:inline-flex">Use cases</a>
        <Link href="/listings" className="inline-flex h-11 items-center hover:underline">Catalog</Link>
        <Link href={DOCS} className="inline-flex h-11 items-center hover:underline">Docs</Link>
        <a href={REPO} className="inline-flex h-11 items-center hover:underline">GitHub</a>
        <WalletLink />
      </nav>
    </header>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title">
      <SiteHeader />
      <div className="mx-auto grid max-w-[1296px] gap-12 px-4 pb-16 pt-12 sm:px-8 lg:min-h-[calc(100dvh-190px)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-16 lg:pt-6">
        <div className="flex flex-col gap-7">
          <h1 id="hero-title" className="text-balance text-[clamp(2.9rem,5.6vw,5rem)] font-bold leading-[0.98] tracking-[-0.03em]">
            Test a model on data you never see.
          </h1>
          <p className="max-w-[32rem] text-pretty text-[19px] leading-[1.55] text-etch-2">
            Test an AI model on data you can’t access, and share data without giving it away. Only the score comes out.
          </p>
          <div className="flex flex-wrap gap-3">
            <KeyLink href="/start?role=buyer">Test a model</KeyLink>
            <KeyLink href="/start?role=seller" tone="outline">List a dataset</KeyLink>
          </div>
          <a href={LIVE_RUN_TX} className="group flex w-fit items-center gap-2 text-[15px] font-semibold underline decoration-etch/30 underline-offset-[0.3em] hover:decoration-etch">
            <span aria-hidden="true" className="size-2 rounded-full bg-led shadow-[0_0_0_3px_rgba(47,158,68,0.18)]" />
            See a real paid run on NEAR testnet
            <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
        </div>
        <DataField />
      </div>
      <BuiltWith />
    </section>
  );
}
