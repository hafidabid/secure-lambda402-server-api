"use client";

import { useRef } from "react";
import { Check, FileUp, Lock, RotateCcw } from "lucide-react";
import type { SealStep } from "@/lib/seal";
import { shortHash } from "@/lib/format";
import { Btn, cn } from "./ui";

export type DropState = "idle" | "valid" | "invalid";

export function FileDrop({
  accept,
  file,
  state,
  meta,
  placeholder,
  onFile,
}: {
  accept: string;
  file: File | null;
  state: DropState;
  meta: string;
  placeholder: string;
  onFile: (f: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dark = state !== "idle";
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={cn(
        "flex cursor-pointer items-center gap-3.5 rounded-[14px] border-[1.5px] p-[18px] transition-colors",
        dark ? "border-ink bg-ink" : "border-dashed border-line-strong bg-surface hover:border-ink",
      )}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-[10px]", dark ? "bg-code" : "border border-line bg-paper")}>
        {dark ? <Lock className="size-5 text-glow" /> : <FileUp className="size-5" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate text-[15px] font-medium", dark ? "text-white" : "text-ink")}>{file?.name ?? placeholder}</span>
        <span className={cn("font-mono text-xs", dark ? "text-code-dim" : "text-muted")}>{meta}</span>
      </span>
      {state === "valid" && (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-seal-deep px-2.5 font-mono text-xs font-medium text-glow">
          <Check className="size-3" strokeWidth={3} />Valid
        </span>
      )}
      {state === "invalid" && (
        <span className="inline-flex h-6 items-center rounded-full bg-danger px-2.5 font-mono text-xs font-medium text-white">Fix below</span>
      )}
    </label>
  );
}

const STEPS: { key: Exclude<SealStep, "done">; label: string }[] = [
  { key: "encrypting", label: "Encrypting on this device" },
  { key: "uploading", label: "Uploading" },
  { key: "locking", label: "Locking to evaluator" },
];

function stepStatus(step: SealStep | null, key: Exclude<SealStep, "done">): "todo" | "now" | "done" {
  const order: SealStep[] = ["encrypting", "uploading", "locking", "done"];
  if (step === null) return "todo";
  const at = order.indexOf(step);
  const me = order.indexOf(key);
  if (at > me) return "done";
  return at === me ? "now" : "todo";
}

export function EncryptProgress({
  step,
  failed,
  wasmHash,
  onRetry,
}: {
  step: SealStep | null;
  failed: string | null;
  wasmHash: string;
  onRetry: () => void;
}) {
  return (
    <section aria-live="polite" className="flex flex-col gap-2.5 rounded-[14px] bg-ink p-[18px]">
      {STEPS.map(({ key, label }) => {
        const s = stepStatus(step, key);
        return (
          <div key={key} className={cn("flex items-center gap-3 text-[13px]", s === "todo" ? "text-code-dim" : "text-code-text")}>
            {s === "done" && <span className="flex size-4 items-center justify-center rounded-full bg-seal-deep"><Check className="size-2.5 text-glow" strokeWidth={3} /></span>}
            {s === "now" && <span className="size-4 animate-pulse rounded-full border-2 border-glow" />}
            {s === "todo" && <span className="size-4 rounded-full border-[1.5px] border-[#3A414C]" />}
            {label}
            {key === "locking" && <span className="ml-auto font-mono text-xs text-code-dim">{shortHash(wasmHash)}</span>}
          </div>
        );
      })}
      {failed && (
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-code-line pt-3">
          <span className="text-[13px] text-[#F5B8B0]">{failed}</span>
          <Btn variant="outline" className="h-8" onClick={onRetry}><RotateCcw />Retry</Btn>
        </div>
      )}
    </section>
  );
}
