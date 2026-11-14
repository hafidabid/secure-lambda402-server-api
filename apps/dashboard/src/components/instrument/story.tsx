"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { Lock, LockOpen } from "lucide-react";
import { cn } from "@/components/ui";
import { BEATS, METRICS } from "./data";
import { Engraved, FlapCell, Led } from "./panel";

const EASE = [0.22, 1, 0.36, 1] as const;

function SlotLock({ file, owner, locked }: { file: string; owner: string; locked: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[16px] bg-slot p-3 shadow-[inset_0_2px_4px_rgba(40,36,28,0.14)] sm:p-4">
      <motion.span
        animate={locked ? { scale: [1.4, 1], backgroundColor: "#1b1b1a", color: "#e7e5e0" } : { scale: 1, backgroundColor: "#c7c3bb", color: "#5c5952" }}
        transition={{ duration: 0.4, ease: EASE }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
      >
        {locked ? <Lock className="size-4" aria-hidden="true" /> : <LockOpen className="size-4" aria-hidden="true" />}
      </motion.span>
      <div className="min-w-0">
        <p className="font-readout text-[13px] font-medium leading-tight sm:text-[15px]">{file}</p>
        <p className="text-[12px] text-etch-3 sm:text-[13px]">{owner}</p>
      </div>
    </div>
  );
}

const DISPLAY_TEXT = ["No data to test on", "Their data stays with them"];

function Machine({ step }: { step: number }) {
  const locked = step >= 1;
  const scored = step >= 2;
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 rounded-[30px] bg-chassis p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_34px_60px_-34px_rgba(40,36,28,0.55)] sm:p-6">
      <div className="grid grid-cols-2 gap-3">
        <SlotLock file="Your model" owner="You" locked={locked} />
        <SlotLock file="Patient data" owner="A hospital" locked={locked} />
      </div>

      <div className="relative flex min-h-[230px] flex-col justify-center gap-3 overflow-hidden rounded-[20px] bg-display p-5 shadow-[inset_0_3px_10px_rgba(0,0,0,0.6)]">
        <div className="absolute left-5 top-4 flex items-center gap-2">
          <Led on={scored} />
          <Engraved className="text-display-dim">Enclave · TEE</Engraved>
        </div>
        <AnimatePresence mode="wait">
          {scored ? (
            <motion.dl key="on" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 flex flex-col gap-2">
              {METRICS.map((m, row) => (
                <div key={m.label} className="flex items-center justify-between">
                  <dt className="font-engraved text-[14px] font-semibold uppercase tracking-[0.14em] text-display-dim">{m.label}</dt>
                  <dd className="flex gap-1">
                    {m.value.split("").map((ch, i) => (
                      <FlapCell key={i} char={ch} play delay={250 + row * 180 + i * 60} />
                    ))}
                  </dd>
                </div>
              ))}
            </motion.dl>
          ) : (
            <motion.p
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-center font-engraved text-[17px] uppercase tracking-[0.14em] text-display-dim"
            >
              {DISPLAY_TEXT[step]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 rounded-[16px] bg-slot px-4 py-3 shadow-[inset_0_2px_4px_rgba(40,36,28,0.14)]">
        <Led on={scored} />
        <Engraved className={cn(scored && "text-etch")}>{scored ? "Neither side saw the other’s file" : "Waiting"}</Engraved>
      </div>
    </div>
  );
}

export function Story() {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    setStep(Math.min(BEATS.length - 1, Math.floor(p * BEATS.length)));
  });

  return (
    <section ref={ref} id="how" aria-labelledby="how-title" className="relative h-[220dvh] bg-chassis/45">
      <h2 id="how-title" className="sr-only">How it works</h2>
      <div className="sticky top-0 mx-auto flex h-[100dvh] max-w-[1296px] flex-col justify-center gap-8 px-4 sm:px-8 lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:items-center lg:gap-16">
        <ol className="hidden flex-col gap-10 lg:flex">
          {BEATS.map((b, i) => (
            <motion.li key={b.title} animate={{ opacity: i === step ? 1 : 0.22 }} transition={{ duration: 0.4 }}>
              <p className="text-[clamp(2rem,3.6vw,3.25rem)] font-bold leading-[1.02] tracking-[-0.025em]">{b.title}</p>
              <motion.p
                animate={{ height: i === step ? "auto" : 0, opacity: i === step ? 1 : 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="max-w-[30rem] overflow-hidden text-[18px] leading-relaxed text-etch-2"
              >
                <span className="block pt-3">{b.line}</span>
              </motion.p>
            </motion.li>
          ))}
        </ol>

        <div className="min-h-[140px] lg:hidden" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.35 }}>
              <p className="text-[2rem] font-bold leading-[1.05] tracking-[-0.025em]">{BEATS[step].title}</p>
              <p className="mt-2 text-[17px] leading-relaxed text-etch-2">{BEATS[step].line}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex justify-center lg:justify-end">
          <Machine step={step} />
        </div>
      </div>
    </section>
  );
}
