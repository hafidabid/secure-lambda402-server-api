"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/components/ui";

const FLAP_CHARS = "0123456789";
const FLAP_TICKS = 9;
const FLAP_TICK_MS = 55;

function flapChar(char: string, tick: number) {
  if (tick < 0) return "";
  if (tick >= FLAP_TICKS || char === ".") return char;
  return FLAP_CHARS[(tick * 7 + char.charCodeAt(0)) % FLAP_CHARS.length];
}

export function FlapCell({ char, play, delay = 0 }: { char: string; play: boolean; delay?: number }) {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(-1);

  useEffect(() => {
    if (reduce || !play) return;
    let n = -1;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        n += 1;
        setTick(n);
        if (n >= FLAP_TICKS) clearInterval(interval);
      }, FLAP_TICK_MS);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [play, delay, reduce]);

  const shown = reduce ? char : flapChar(char, play ? tick : -1);

  return (
    <span className="relative flex h-[clamp(44px,5vw,68px)] w-[clamp(32px,3.6vw,50px)] items-center justify-center overflow-hidden rounded-[6px] bg-flap font-readout text-[clamp(26px,3vw,40px)] font-semibold text-flap-ink shadow-[inset_0_-34px_0_rgba(0,0,0,0.16),0_1px_0_rgba(255,255,255,0.06)] [perspective:300px]">
      <motion.span
        key={shown}
        initial={reduce ? false : { rotateX: -80, opacity: 0.4 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ duration: 0.09, ease: "easeOut" }}
        className="block origin-top"
      >
        {shown}
      </motion.span>
      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-black/55" />
    </span>
  );
}

export function Led({ on, tone = "ok", pulse }: { on: boolean; tone?: "ok" | "signal"; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full transition-colors duration-300",
        !on && "bg-chassis-deep shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]",
        on && tone === "ok" && "bg-led shadow-[0_0_0_3px_rgba(47,158,68,0.18)]",
        on && tone === "signal" && "bg-signal shadow-[0_0_0_3px_rgba(232,89,12,0.2)]",
        pulse && "animate-pulse",
      )}
    />
  );
}

export function Engraved({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("font-engraved text-[13px] font-semibold uppercase tracking-[0.12em] text-etch-3", className)}>{children}</span>
  );
}

export function KeyLink({ href, children, tone = "signal" }: { href: string; children: React.ReactNode; tone?: "signal" | "outline" }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-14 items-center rounded-full px-7 text-[16px] font-semibold transition-[transform,box-shadow] duration-150 active:translate-y-px",
        tone === "signal" &&
          "bg-signal text-etch shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_0_#b8450a,0_10px_20px_-10px_rgba(184,69,10,0.7)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_0_#b8450a,0_6px_14px_-8px_rgba(184,69,10,0.7)]",
        tone === "outline" && "border-[1.5px] border-etch text-etch hover:bg-etch hover:text-panel",
      )}
    >
      {children}
    </Link>
  );
}

export function SectionTitle({ id, children, lead }: { id: string; children: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <div className="max-w-[44rem]">
      <h2 id={id} className="text-balance text-[clamp(2rem,4vw,3.25rem)] font-bold leading-[1.02] tracking-[-0.025em]">
        {children}
      </h2>
      {lead && <p className="mt-4 text-pretty text-[18px] leading-relaxed text-etch-2">{lead}</p>}
    </div>
  );
}
