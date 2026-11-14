"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useInView, useReducedMotion } from "motion/react";
import { ArrowRight, Check, Copy } from "lucide-react";
import { cn } from "@/components/ui";
import { AGENT_CHAT, DOCS, INSTALL } from "./data";
import { ClaudeCodeLogo, ClaudeLogo, CodexLogo } from "./logos";
import { Engraved, Led } from "./panel";

const STEP_MS = 1400;
const HOLD_STEPS = 3;

const LOGO: Record<(typeof INSTALL)[number]["client"], typeof ClaudeLogo> = {
  "Claude Code": ClaudeCodeLogo,
  Codex: CodexLogo,
  "Claude Desktop": ClaudeLogo,
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      aria-label={copied ? "Copied" : "Copy command"}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-display-dim hover:bg-flap hover:text-flap-ink"
    >
      {copied ? <Check className="size-4 text-led" /> : <Copy className="size-4" />}
    </button>
  );
}

function InstallTabs() {
  const [active, setActive] = useState(0);
  const item = INSTALL[active];

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Install for" className="flex flex-wrap gap-2">
        {INSTALL.map(({ client }, i) => {
          const Logo = LOGO[client];
          return (
            <button
              key={client}
              role="tab"
              type="button"
              aria-selected={i === active}
              aria-controls="install-panel"
              onClick={() => setActive(i)}
              className={cn(
                "flex h-11 cursor-pointer items-center gap-2.5 rounded-full px-4 text-[15px] font-semibold transition-colors",
                i === active ? "bg-flap-ink text-display" : "bg-flap text-display-dim hover:text-flap-ink",
              )}
            >
              <Logo className="size-4" />
              {client}
            </button>
          );
        })}
      </div>
      <div id="install-panel" role="tabpanel" className="rounded-[20px] bg-[#161614] p-2 pl-5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)]">
        <Engraved className="block pt-2 text-display-dim">{item.file}</Engraved>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 whitespace-pre-wrap py-2 font-readout text-[14px] leading-relaxed text-flap-ink [overflow-wrap:anywhere]">
            {item.command}
          </code>
          <CopyButton text={item.command} />
        </div>
      </div>
    </div>
  );
}

function ChatLine({ line, active, done }: { line: (typeof AGENT_CHAT)[number]; active: boolean; done: boolean }) {
  if (line.kind === "user") {
    return <p className="ml-auto max-w-[85%] rounded-[18px] rounded-br-md bg-flap px-4 py-3 text-[15px] leading-snug">{line.text}</p>;
  }
  if (line.kind === "agent") {
    return <p className="max-w-[92%] text-[15px] leading-relaxed text-flap-ink">{line.text}</p>;
  }
  return (
    <div className="flex items-start gap-3 font-readout text-[13px]">
      <span className="pt-1">
        <Led on tone={line.name === "evaluate" ? "signal" : "ok"} pulse={active && !done} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-flap-ink">securelambda · {line.name}</span>
        <span className="text-display-dim">{line.result}</span>
      </span>
    </div>
  );
}

function AgentChat() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => setStep((s) => (s + 1) % (AGENT_CHAT.length + HOLD_STEPS)), STEP_MS);
    return () => clearInterval(id);
  }, [inView, reduce]);

  const shown = reduce ? AGENT_CHAT.length - 1 : Math.min(step, AGENT_CHAT.length - 1);

  return (
    <div ref={ref} className="flex flex-col overflow-hidden rounded-[28px] bg-[#161614] shadow-[0_24px_40px_-24px_rgba(0,0,0,0.9)]">
      <div className="flex items-center gap-2.5 border-b border-display-line px-5 py-4">
        <ClaudeCodeLogo className="size-4 text-display-dim" />
        <Engraved className="text-display-dim">Claude Code · securelambda MCP</Engraved>
      </div>
      <ol aria-label="An agent buying one run" className="flex flex-1 flex-col gap-5 p-5 sm:p-6">
        {AGENT_CHAT.map((line, i) => (
          <motion.li
            key={i}
            initial={false}
            animate={{ opacity: i <= shown ? 1 : 0, y: i <= shown ? 0 : 8 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex"
          >
            <ChatLine line={line} active={i === shown} done={i < shown || step >= AGENT_CHAT.length} />
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

export function AgentPayments() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="bg-chassis/45">
      <div className="mx-auto max-w-[1296px] px-4 py-28 sm:px-8 lg:py-36">
        <div className="grid gap-12 overflow-hidden rounded-[36px] bg-display p-7 text-flap-ink shadow-[0_40px_70px_-40px_rgba(20,18,14,0.75)] sm:p-12 lg:grid-cols-2 lg:gap-14 lg:p-16">
          <div className="flex min-w-0 flex-col gap-8">
            <h2 id="agents-title" className="text-balance text-[clamp(2.2rem,4.4vw,3.75rem)] font-bold leading-[1.02] tracking-[-0.03em]">
              Agents can pay for it too.
            </h2>
            <p className="max-w-[34rem] text-pretty text-[18px] leading-relaxed text-display-dim">
              Add the SecureLambda MCP server to your coding agent. It finds a dataset, pays per run in NEAR over x402, and reads
              back the score.
            </p>
            <InstallTabs />
            <div className="mt-auto flex flex-col gap-3 text-[15px]">
              <p className="flex items-center gap-2.5 text-display-dim">
                <Led on />
                The agent pays from a wallet you fund, so it can’t spend more than you sent.
              </p>
              <Link href={DOCS} className="inline-flex h-11 w-fit items-center gap-2 font-semibold hover:underline">
                Setup, spend caps and plain HTTP in the docs
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
          <AgentChat />
        </div>
      </div>
    </section>
  );
}
