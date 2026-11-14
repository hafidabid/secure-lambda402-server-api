"use client";

import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { CopyButton, CopyButtonIcon } from "@animate-ui/react/primitives/buttons/copy";
import type { RunMode } from "@securelambda/schemas";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type BtnVariant = "signal" | "outline" | "ghost";
const btnVariants: Record<BtnVariant, string> = {
  signal:
    "bg-signal text-etch shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_0_#b8450a,0_8px_16px_-10px_rgba(184,69,10,0.7)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_0_#b8450a,0_5px_12px_-8px_rgba(184,69,10,0.7)] active:translate-y-px",
  outline: "border-[1.5px] border-etch text-etch hover:bg-etch hover:text-panel",
  ghost: "text-etch-2 hover:bg-chassis hover:text-etch",
};
const btnBase =
  "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-[transform,box-shadow,background-color,color] duration-150 disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0";

export function Btn({ variant = "signal", className, ...props }: React.ComponentProps<"button"> & { variant?: BtnVariant }) {
  return <button className={cn(btnBase, btnVariants[variant], className)} {...props} />;
}

export function LinkBtn({ variant = "signal", className, ...props }: React.ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link className={cn(btnBase, btnVariants[variant], className)} {...props} />;
}

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-[28px] bg-chassis p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_24px_44px_-32px_rgba(40,36,28,0.55)] sm:p-5",
        className,
      )}
      {...props}
    />
  );
}

export function Slot({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-[16px] bg-slot shadow-[inset_0_2px_4px_rgba(40,36,28,0.14)]", className)} {...props} />;
}

export function Display({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-[20px] bg-display text-flap-ink shadow-[inset_0_3px_10px_rgba(0,0,0,0.6)]", className)}
      {...props}
    />
  );
}

export function Engraved({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("font-engraved text-[13px] font-semibold uppercase tracking-[0.12em] text-etch-3", className)}>{children}</span>
  );
}

export type LedTone = "off" | "ok" | "signal";

export function Led({ tone, pulse, className }: { tone: LedTone; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full transition-colors duration-300",
        tone === "off" && "bg-chassis-deep shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]",
        tone === "ok" && "bg-led shadow-[0_0_0_3px_rgba(47,158,68,0.18)]",
        tone === "signal" && "bg-signal shadow-[0_0_0_3px_rgba(232,89,12,0.2)]",
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}

function FlapCell({ char }: { char: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative flex h-11 w-8 items-center justify-center overflow-hidden rounded-[6px] bg-flap font-readout text-[24px] font-semibold text-flap-ink shadow-[inset_0_-22px_0_rgba(0,0,0,0.16)] [perspective:300px] sm:h-14 sm:w-10 sm:text-[30px]">
      <motion.span
        key={char}
        initial={reduce ? false : { rotateX: -80, opacity: 0.4 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
        className="block origin-top"
      >
        {char}
      </motion.span>
      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-black/55" />
    </span>
  );
}

export function FlapReadout({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex gap-1" role="img" aria-label={`${label} ${value}`}>
      {[...value].map((char, i) => (
        <FlapCell key={i} char={char} />
      ))}
    </span>
  );
}

export function ModeBadge({ mode, trustTier }: { mode: RunMode; trustTier?: 1 | 2 }) {
  const label = mode === "enclave" ? `Enclave mode${trustTier === 1 ? " (operator-set key)" : ""}` : "Local mode";
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full bg-slot px-3 text-[13px] font-medium text-etch-2 shadow-[inset_0_1px_3px_rgba(40,36,28,0.16)]">
      <Led tone={mode === "enclave" ? "ok" : "off"} />
      {label}
    </span>
  );
}

export function CopyIconButton({ content, label, dark }: { content: string; label: string; dark?: boolean }) {
  return (
    <CopyButton
      content={content}
      aria-label={label}
      className={cn(
        "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full",
        dark ? "bg-display-line text-flap-ink hover:bg-flap" : "text-etch-2 hover:bg-chassis-deep/60 hover:text-etch",
      )}
    >
      <CopyButtonIcon icon={<Copy className="size-3.5" />} copiedIcon={<Check className="size-3.5 text-led" />} />
    </CopyButton>
  );
}

export function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-chassis-deep/50 px-4 py-2.5 text-[14px] last:border-0">
      <Led tone={ok ? "ok" : "signal"} />
      <span>{label}</span>
      {detail && <span className="ml-auto truncate pl-3 text-right font-readout text-[12px] text-etch-3">{detail}</span>}
    </div>
  );
}

export function NearLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} role="img" aria-label="NEAR">
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <path
        className="fill-panel"
        d="M15.6 5.6 13.1 9.3c-.2.3.2.6.4.4l2.5-2.2c.1-.1.2 0 .2.1v6.6c0 .1-.2.2-.2.1L8.4 5.9a1 1 0 0 0-.8-.4h-.3c-.6 0-1 .5-1 1v11c0 .6.4 1 1 1 .3 0 .7-.2.8-.5l2.5-3.7c.2-.3-.2-.6-.4-.4l-2.5 2.2c-.1.1-.2 0-.2-.1V9.4c0-.1.2-.2.2-.1l7.6 8.8c.2.3.5.4.8.4h.3c.6 0 1-.5 1-1v-11c0-.6-.4-1-1-1-.3 0-.7.2-.8.6Z"
      />
    </svg>
  );
}

export function Crumb({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="w-fit font-engraved text-[13px] font-semibold uppercase tracking-[0.12em] text-etch-3 hover:text-etch">
      ← {children}
    </Link>
  );
}

export function PageTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <h1 className="text-balance text-[clamp(1.75rem,3.4vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.02em]">{children}</h1>
      {aside}
    </div>
  );
}

export function PageError({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <Slot role="alert" className="flex flex-wrap items-center gap-3 px-4 py-3 text-[15px]">
      <Led tone="signal" />
      <span className="flex-1">{message}</span>
      {action}
    </Slot>
  );
}

export function Page({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-[20px] bg-chassis", className)} />;
}

export function SecureLambdaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect width="100" height="100" rx="13" fill="#1D1D1B" />
      <g fill="none" stroke="#F2EFE8" strokeWidth="12.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M29.3 20.6H43.5L70.6 73" />
        <path d="M48 44.1 25.1 79.5" />
      </g>
      <circle cx="74.8" cy="79.3" r="9" fill="#1D1D1B" />
      <circle cx="74.8" cy="79.3" r="6.5" fill="#E8590C" />
    </svg>
  );
}
