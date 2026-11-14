"use client";

import { FileUp, Lock, RotateCcw } from "lucide-react";
import type { SealStep } from "@/lib/seal";
import { shortHash } from "@/lib/format";
import { Display, Led, cn, type LedTone } from "./ui";

export type DropState = "idle" | "valid" | "invalid";

const DROP_LED: Record<DropState, LedTone> = { idle: "off", valid: "ok", invalid: "signal" };

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
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={cn(
        "flex cursor-pointer items-center gap-4 rounded-[20px] bg-slot p-4 shadow-[inset_0_2px_4px_rgba(40,36,28,0.14)] transition-colors focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-signal",
        state === "idle" && "border-2 border-dashed border-chassis-deep hover:border-etch-3",
      )}
    >
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-chassis shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
        {state === "idle" ? <FileUp className="size-5" /> : <Lock className="size-5" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[16px] font-semibold">{file?.name ?? placeholder}</span>
        <span className="truncate text-[13px] text-etch-3">{meta}</span>
      </span>
      {state !== "idle" && (
        <span className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
          <Led tone={DROP_LED[state]} />
          {state === "valid" ? "Ready" : "Fix below"}
        </span>
      )}
    </label>
  );
}

const STEPS: { key: Exclude<SealStep, "done">; label: string }[] = [
  { key: "encrypting", label: "Encrypting on this device and locking to the evaluator" },
  { key: "uploading", label: "Uploading" },
];

function stepTone(step: SealStep | null, key: Exclude<SealStep, "done">, failed: boolean): { tone: LedTone; pulse: boolean } {
  const order: SealStep[] = ["encrypting", "uploading", "done"];
  if (step === null) return { tone: "off", pulse: false };
  const at = order.indexOf(step);
  const me = order.indexOf(key);
  if (at > me) return { tone: "ok", pulse: false };
  if (at === me) return failed ? { tone: "signal", pulse: false } : { tone: "ok", pulse: true };
  return { tone: "off", pulse: false };
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
    <Display aria-live="polite" className="flex flex-col gap-3 p-5">
      {STEPS.map(({ key, label }) => {
        const { tone, pulse } = stepTone(step, key, !!failed);
        return (
          <div key={key} className={cn("flex items-center gap-3 text-[14px]", tone === "off" && "text-display-dim")}>
            <Led tone={tone} pulse={pulse} />
            <span className="flex-1">{label}</span>
            {key === "encrypting" && <span className="hidden font-readout text-[12px] text-display-dim sm:inline">{shortHash(wasmHash)}</span>}
          </div>
        );
      })}
      {step === "done" && <div className="flex items-center gap-3 text-[14px]"><Led tone="ok" />Locked to the evaluator</div>}
      {failed && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-display-line pt-3">
          <span className="text-[14px] text-flap-ink">{failed}</span>
          <button onClick={onRetry} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-flap-ink px-4 text-[14px] font-semibold hover:bg-flap-ink hover:text-display">
            <RotateCcw className="size-4" />
            Retry
          </button>
        </div>
      )}
    </Display>
  );
}

