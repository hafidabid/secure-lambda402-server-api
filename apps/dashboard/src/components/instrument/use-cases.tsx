"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/components/ui";
import { USE_CASES, type UseCase } from "./data";
import { Engraved, FlapCell, Led } from "./panel";

const ADVANCE_MS = 5000;

function Party({ role, who, holds }: { role: string; who: string; holds: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[16px] bg-slot/90 px-4 py-3 shadow-[0_10px_24px_-14px_rgba(40,36,28,0.5)] backdrop-blur-sm">
      <Engraved>{role}</Engraved>
      <p className="text-[17px] font-bold leading-tight">{who}</p>
      <p className="text-[14px] text-etch-2">{holds}</p>
    </div>
  );
}

function CaseArt({ c }: { c: UseCase }) {
  const [missing, setMissing] = useState(false);
  const src = `/landing/case-${c.industry.toLowerCase()}.webp`;
  return (
    <div className="relative overflow-hidden rounded-[24px] bg-chassis shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
      {missing ? (
        <div className="flex aspect-[4/3] items-center justify-center p-6 text-center">
          <Engraved>Illustration · public{src}</Engraved>
        </div>
      ) : (
        <motion.div initial={{ scale: 1.06 }} animate={{ scale: 1 }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}>
          <Image
            src={src}
            alt={`${c.dataOwner} and ${c.modelOwner.toLowerCase()} each keeping their own file`}
            width={712}
            height={528}
            onError={() => setMissing(true)}
            className="aspect-[4/3] h-auto w-full object-cover"
          />
        </motion.div>
      )}
      <div className="grid grid-cols-2 gap-2 p-2 sm:absolute sm:inset-x-4 sm:bottom-4 sm:p-0">
        <Party role="Has the data" who={c.dataOwner} holds={c.data} />
        <Party role="Has the model" who={c.modelOwner} holds={c.model} />
      </div>
    </div>
  );
}

function CasePanel({ c }: { c: UseCase }) {
  return (
    <motion.div
      key={c.industry}
      initial={{ opacity: 0, y: 20, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -20, filter: "blur(6px)" }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
    >
      <CaseArt c={c} />
      <div className="flex flex-col justify-between gap-8 rounded-[24px] bg-display p-6 text-flap-ink shadow-[inset_0_3px_10px_rgba(0,0,0,0.6)] sm:p-8">
        <p className="text-balance text-[clamp(1.5rem,2.4vw,2.1rem)] font-semibold leading-[1.15] tracking-[-0.015em]">“{c.question}”</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-2">
            <Led on />
            <Engraved className="text-display-dim">{c.metric} · example</Engraved>
          </div>
          <div className="flex gap-1.5">
            {c.value.split("").map((ch, i) => (
              <FlapCell key={`${c.industry}-${i}`} char={ch} play delay={300 + i * 90} />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function UseCases() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    if (!inView || picked || reduce) return;
    const id = setInterval(() => setActive((a) => (a + 1) % USE_CASES.length), ADVANCE_MS);
    return () => clearInterval(id);
  }, [inView, picked, reduce]);

  return (
    <section id="use-cases" aria-labelledby="cases-title">
      <div className="mx-auto max-w-[1296px] px-4 py-28 sm:px-8 lg:py-36">
        <h2 id="cases-title" className="max-w-[44rem] text-balance text-[clamp(2.4rem,5vw,4.25rem)] font-bold leading-[1] tracking-[-0.03em]">
          Where it’s useful.
        </h2>

        <div ref={ref} className="mt-12">
          <div role="tablist" aria-label="Industries" className="flex flex-wrap gap-2">
            {USE_CASES.map((c, i) => (
              <button
                key={c.industry}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => {
                  setActive(i);
                  setPicked(true);
                }}
                className={cn(
                  "relative h-12 cursor-pointer overflow-hidden rounded-full px-5 text-[16px] font-semibold transition-colors",
                  i === active ? "bg-etch text-panel" : "bg-chassis text-etch hover:bg-chassis-deep",
                )}
              >
                {c.industry}
                {i === active && !picked && !reduce && (
                  <motion.span
                    key={`bar-${active}`}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: ADVANCE_MS / 1000, ease: "linear" }}
                    style={{ originX: 0 }}
                    className="absolute inset-x-0 bottom-0 h-[3px] bg-signal"
                  />
                )}
              </button>
            ))}
          </div>

          <div role="tabpanel" className="mt-6" aria-live="polite">
            <AnimatePresence mode="wait">
              <CasePanel key={active} c={USE_CASES[active]} />
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
