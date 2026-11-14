"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { FAQ } from "./data";
import { IntelLogo, NearLogo } from "./logos";

const BUILT_WITH = [
  { name: "NEAR Protocol", mark: <NearLogo className="size-6" /> },
  { name: "OutLayer", mark: null },
  { name: "TDX", mark: <IntelLogo className="-my-2 h-10 w-auto" /> },
  { name: "x402", mark: null },
];

export function BuiltWith() {
  return (
    <div className="mx-auto max-w-[1296px] px-4 pb-16 sm:px-8">
      <div className="flex flex-col gap-5 border-t border-chassis-deep pt-8 sm:flex-row sm:items-center sm:gap-12">
        <span className="font-engraved text-[13px] font-semibold uppercase tracking-[0.12em] text-etch-3">Built with</span>
        <ul className="flex flex-wrap items-center gap-x-10 gap-y-4 text-etch-2">
          {BUILT_WITH.map((b, i) => (
            <motion.li
              key={b.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1 + i * 0.1, duration: 0.5 }}
              className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.01em]"
            >
              {b.mark}
              {b.name}
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Item({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <li className="border-t border-chassis-deep last:border-b">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-left text-[clamp(18px,1.8vw,22px)] font-semibold tracking-[-0.01em]"
      >
        {q}
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-chassis"
        >
          <Plus className="size-5" aria-hidden="true" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="max-w-[44rem] pb-6 text-[17px] leading-relaxed text-etch-2">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" aria-labelledby="faq-title">
      <div className="mx-auto grid max-w-[1296px] gap-10 px-4 py-28 sm:px-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-36">
        <h2 id="faq-title" className="text-[clamp(2.4rem,5vw,4.25rem)] font-bold leading-[1] tracking-[-0.03em]">
          Questions
        </h2>
        <ul>
          {FAQ.map((f, i) => (
            <Item key={f.q} q={f.q} a={f.a} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </ul>
      </div>
    </section>
  );
}
