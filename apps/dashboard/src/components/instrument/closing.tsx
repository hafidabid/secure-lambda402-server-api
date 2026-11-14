"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { API_REFERENCE, DOCS, LIVE_RUN_TX, REPO } from "./data";
import { NearLogo, SecureLambdaMark } from "./logos";
import { Reveal } from "./reveal";

function Door({ title, cta, href, dark }: { title: string; cta: string; href: string; dark?: boolean }) {
  return (
    <Link
      href={href}
      className={
        dark
          ? "group flex min-h-[260px] flex-col justify-between rounded-[32px] bg-etch p-8 text-panel transition-transform duration-300 hover:-translate-y-1 sm:p-10"
          : "group flex min-h-[260px] flex-col justify-between rounded-[32px] bg-chassis p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_24px_44px_-32px_rgba(40,36,28,0.55)] transition-transform duration-300 hover:-translate-y-1 sm:p-10"
      }
    >
      <span className="text-[clamp(2rem,3.6vw,3rem)] font-bold leading-[1] tracking-[-0.03em]">{title}</span>
      <span className="flex items-center justify-between">
        <span className="text-[18px] font-semibold">{cta}</span>
        <span className="flex size-14 items-center justify-center rounded-full bg-signal text-etch transition-transform duration-300 group-hover:translate-x-1">
          <ArrowRight className="size-6" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}

export function GetStarted() {
  return (
    <section aria-labelledby="start-title">
      <div className="mx-auto max-w-[1296px] px-4 py-28 sm:px-8 lg:py-36">
        <h2 id="start-title" className="sr-only">Get started</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Reveal>
            <Door title="I have data." cta="List a dataset" href="/start?role=seller" />
          </Reveal>
          <Reveal delay={0.12}>
            <Door title="I have a model." cta="Test a model" href="/start?role=buyer" dark />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const FOOTER_LINKS = [
  { label: "Catalog", href: "/listings" },
  { label: "Integration guide", href: DOCS },
  { label: "API reference", href: API_REFERENCE },
  { label: "Live testnet run", href: LIVE_RUN_TX },
  { label: "GitHub", href: REPO },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-chassis-deep">
      <div className="mx-auto flex max-w-[1296px] flex-col gap-6 px-4 py-10 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-[17px] font-bold">
            <SecureLambdaMark className="size-7" />
            SecureLambda
          </span>
          <span className="flex items-center gap-2 text-[14px] text-etch-2">
            <NearLogo className="size-4 text-etch" />
            Built on NEAR Protocol for the Privacy &amp; Private AI track
          </span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-1 text-[15px] text-etch-2">
          {FOOTER_LINKS.map((l) =>
            l.href.startsWith("/") ? (
              <Link key={l.label} href={l.href} className="inline-flex h-11 items-center hover:text-etch hover:underline">{l.label}</Link>
            ) : (
              <a key={l.label} href={l.href} className="inline-flex h-11 items-center hover:text-etch hover:underline">{l.label}</a>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
}
