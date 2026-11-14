"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Terminal } from "lucide-react";
import { cn } from "@/components/ui";
import { LOOP } from "./data";
import { ClaudeCodeLogo, CodexLogo, CursorLogo } from "./logos";
import { Engraved, Led } from "./panel";

const PHASE_MS = 1600;

const ACTOR: Record<(typeof LOOP)[number]["from"], string> = {
  agent: "Your agent",
  gateway: "SecureLambda",
  enclave: "Enclave",
};

const CLIENTS = [
  { name: "Claude Code", Logo: ClaudeCodeLogo },
  { name: "Codex", Logo: CodexLogo },
  { name: "Cursor", Logo: CursorLogo },
  { name: "Your own code", Logo: Terminal },
];

function PaymentLoop() {
  const ref = useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % LOOP.length), PHASE_MS);
    return () => clearInterval(id);
  }, [inView, reduce]);

  const shown = reduce ? LOOP.length - 1 : phase;

  return (
    <ol ref={ref} aria-label="One paid run" className="relative flex flex-col gap-7 pl-9">
      <span aria-hidden="true" className="absolute bottom-3 left-[7px] top-3 w-[2px] bg-display-line" />
      <motion.span
        aria-hidden="true"
        animate={{ height: `${(shown / (LOOP.length - 1)) * 100}%` }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute left-[7px] top-3 w-[2px] bg-signal"
        style={{ maxHeight: "calc(100% - 24px)" }}
      />
      {LOOP.map((s, i) => (
        <motion.li
          key={s.label}
          animate={{ opacity: i <= shown ? 1 : 0.3 }}
          transition={{ duration: 0.35 }}
          className="relative flex flex-col gap-1"
        >
          <span className="absolute -left-9 top-1">
            <span className={cn("flex size-4 items-center justify-center rounded-full bg-display", i === shown && "ring-4 ring-signal/20")}>
              <Led on={i <= shown} tone={s.from === "gateway" ? "signal" : "ok"} />
            </span>
          </span>
          <Engraved className="text-display-dim">{ACTOR[s.from]}</Engraved>
          <span className="font-readout text-[clamp(17px,1.6vw,21px)] font-medium text-flap-ink">{s.label}</span>
        </motion.li>
      ))}
    </ol>
  );
}

export function AgentPayments() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="bg-chassis/45">
      <div className="mx-auto max-w-[1296px] px-4 py-28 sm:px-8 lg:py-36">
        <div className="grid gap-12 overflow-hidden rounded-[36px] bg-display p-7 text-flap-ink shadow-[0_40px_70px_-40px_rgba(20,18,14,0.75)] sm:p-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16 lg:p-16">
          <div className="flex flex-col gap-8">
            <h2 id="agents-title" className="text-balance text-[clamp(2.2rem,4.4vw,3.75rem)] font-bold leading-[1.02] tracking-[-0.03em]">
              Agents can pay for it too.
            </h2>
            <p className="max-w-[34rem] text-pretty text-[18px] leading-relaxed text-display-dim">
              SecureLambda supports x402, the HTTP payment standard for AI agents. Your agent asks for a run, gets a price, pays
              in NEAR and reads the score.
            </p>
            <ul aria-label="Works with" className="mt-auto flex flex-wrap gap-3">
              {CLIENTS.map(({ name, Logo }, i) => (
                <motion.li
                  key={name}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.8 }}
                  transition={{ delay: 0.2 + i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="flex h-14 items-center gap-3 rounded-full bg-flap px-5 text-[16px] font-semibold"
                >
                  <Logo className="size-5" aria-hidden="true" />
                  {name}
                </motion.li>
              ))}
            </ul>
          </div>
          <PaymentLoop />
        </div>
      </div>
    </section>
  );
}
