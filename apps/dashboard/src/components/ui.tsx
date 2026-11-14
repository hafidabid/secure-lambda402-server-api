"use client";

import Link from "next/link";
import { Check, Copy, Lock } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { CopyButton, CopyButtonIcon } from "@animate-ui/react/primitives/buttons/copy";
import type { RunMode } from "@securelambda/schemas";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type BtnVariant = "ink" | "outline" | "ghost" | "seal";
const btnVariants: Record<BtnVariant, string> = {
  ink: "bg-ink text-white hover:bg-code",
  outline: "bg-surface text-ink border-line-strong hover:bg-hover",
  ghost: "bg-transparent text-ink-2 hover:bg-hover hover:text-ink",
  seal: "bg-seal text-white hover:bg-seal-strong",
};
const btnBase =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-transparent px-4 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-seal focus-visible:outline-offset-2 [&_svg]:size-4 [&_svg]:shrink-0";

export function Btn({ variant = "ink", className, ...props }: React.ComponentProps<"button"> & { variant?: BtnVariant }) {
  return <button className={cn(btnBase, btnVariants[variant], className)} {...props} />;
}

export function LinkBtn({ variant = "ink", className, ...props }: React.ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link className={cn(btnBase, btnVariants[variant], className)} {...props} />;
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-[14px] border border-line bg-surface", className)} {...props} />;
}

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 font-mono text-xs font-medium", className)}
      {...props}
    />
  );
}

export function SealIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-7 items-center justify-center rounded-[7px] bg-ink", className)}>
      <Lock className="size-[15px] text-glow" strokeWidth={2} />
    </span>
  );
}

export function ModeBadge({ mode }: { mode: RunMode }) {
  return mode === "enclave" ? (
    <Badge className="rounded-full bg-ink text-glow">
      <span className="size-1.5 rounded-full bg-glow" />
      Enclave mode
    </Badge>
  ) : (
    <Badge className="rounded-full border border-dashed border-faint bg-transparent text-ink-2">Local mode</Badge>
  );
}

export function CopyIconButton({ content, label, dark }: { content: string; label: string; dark?: boolean }) {
  return (
    <CopyButton
      content={content}
      aria-label={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md border cursor-pointer",
        dark ? "border-transparent bg-code-line text-code-text" : "border-line bg-paper text-ink hover:bg-hover",
      )}
    >
      <CopyButtonIcon icon={<Copy className="size-3.5" />} copiedIcon={<Check className="size-3.5 text-seal" />} />
    </CopyButton>
  );
}

export function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-surface-2 py-2 text-[13px] last:border-0">
      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", ok ? "bg-seal-soft" : "bg-danger-soft")}>
        {ok ? <Check className="size-2.5 text-seal-strong" strokeWidth={3} /> : <span className="text-[10px] font-bold text-danger">!</span>}
      </span>
      <span>{label}</span>
      {detail && <span className="ml-auto text-right font-mono text-xs text-muted">{detail}</span>}
    </div>
  );
}

export function NearLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} role="img" aria-label="NEAR">
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <path
        className="fill-surface"
        d="M15.6 5.6 13.1 9.3c-.2.3.2.6.4.4l2.5-2.2c.1-.1.2 0 .2.1v6.6c0 .1-.2.2-.2.1L8.4 5.9a1 1 0 0 0-.8-.4h-.3c-.6 0-1 .5-1 1v11c0 .6.4 1 1 1 .3 0 .7-.2.8-.5l2.5-3.7c.2-.3-.2-.6-.4-.4l-2.5 2.2c-.1.1-.2 0-.2-.1V9.4c0-.1.2-.2.2-.1l7.6 8.8c.2.3.5.4.8.4h.3c.6 0 1-.5 1-1v-11c0-.6-.4-1-1-1-.3 0-.7.2-.8.6Z"
      />
    </svg>
  );
}

export function Crumb({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[13px] text-muted hover:text-ink">
      {children} /
    </Link>
  );
}

export function PageError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-[#F5C2BC] bg-danger-soft px-4 py-3 text-sm text-danger-ink">
      {message}
    </div>
  );
}
