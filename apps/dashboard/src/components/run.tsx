"use client";

import { Check, X } from "lucide-react";
import { SlidingNumber } from "@animate-ui/react/primitives/texts/sliding-number";
import type { Receipt, RunMode, RunResult } from "@securelambda/schemas";
import type { Stage, StageStatus } from "@/lib/run-stages";
import { shortHash } from "@/lib/format";
import { CopyIconButton, cn } from "./ui";

const PILL: Record<StageStatus, string> = {
  pending: "border-line-strong",
  active: "border-seal",
  done: "border-seal",
  slow: "border-warn bg-[#FFFBF5]",
  failed: "border-danger bg-danger-soft",
  skipped: "border-dashed border-faint",
};

function caption(status: StageStatus, key: Stage["key"], seenAt?: string): string {
  if (status === "done" && seenAt) return seenAt;
  if (status === "slow") return "Taking longer than usual";
  if (status === "active") return "In progress";
  if (status === "failed") return "Did not complete";
  if (status === "skipped") return key === "attested" ? "Not attested" : "Not charged";
  return "Waiting";
}

function StageIcon({ status, index }: { status: StageStatus; index: number }) {
  if (status === "done") {
    return <span className="flex size-[22px] items-center justify-center rounded-full bg-seal"><Check className="size-3 text-white" strokeWidth={3} /></span>;
  }
  if (status === "failed") {
    return <span className="flex size-[22px] items-center justify-center rounded-full bg-danger"><X className="size-3 text-white" strokeWidth={3} /></span>;
  }
  if (status === "active" || status === "slow") {
    return (
      <span className={cn("flex size-[22px] items-center justify-center rounded-full border-2", status === "slow" ? "border-warn" : "border-seal")}>
        <span className={cn("size-1.5 animate-pulse rounded-full", status === "slow" ? "bg-warn" : "bg-seal")} />
      </span>
    );
  }
  return <span className="flex size-[22px] items-center justify-center rounded-full border border-line-strong font-mono text-[11px] text-muted">{index + 1}</span>;
}

export function RunStages({ stages, seenAt }: { stages: Stage[]; seenAt: Partial<Record<Stage["key"], string>> }) {
  return (
    <ol aria-label="Run stages" className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
      {stages.map((s, i) => (
        <li key={s.key} className={cn("flex min-h-[86px] flex-col gap-2 rounded-xl border-[1.5px] bg-surface px-4 py-3.5", PILL[s.status])}>
          <span className={cn("flex items-center gap-2 text-[15px] font-semibold", s.status === "pending" && "text-muted")}>
            <StageIcon status={s.status} index={i} />
            {s.label}
          </span>
          <span className={cn("font-mono text-xs", s.status === "slow" ? "text-warn" : "text-muted")}>{caption(s.status, s.key, seenAt[s.key])}</span>
        </li>
      ))}
    </ol>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface px-[18px] py-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[34px] font-semibold leading-none tracking-tight">{children}</span>
    </div>
  );
}

function Metric({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">n/a</span>;
  return (
    <>
      <span className="sr-only">{value.toFixed(2)}</span>
      <span aria-hidden="true"><SlidingNumber number={value} decimalPlaces={2} /></span>
    </>
  );
}

export function MetricTiles({ result }: { result: RunResult | null }) {
  if (!result) {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3" aria-label="Waiting for metrics">
        {["Accuracy", "AUC", "F1", "Rows"].map((l) => (
          <div key={l} className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-[18px] py-4">
            <span className="text-[13px] text-muted">{l}</span>
            <span className="h-8 w-20 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
      <Tile label="Accuracy"><Metric value={result.metrics.accuracy} /></Tile>
      <Tile label="AUC"><Metric value={result.metrics.auc} /></Tile>
      <Tile label="F1"><Metric value={result.metrics.f1} /></Tile>
      <Tile label="Rows">{result.n_bucket}</Tile>
    </div>
  );
}

function explorerTx(hash: string): string {
  return `https://testnet.nearblocks.io/txns/${hash}`;
}

function ReceiptRow({ label, value, href, final }: { label: string; value: string | null; href?: boolean; final: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-surface-2 py-2.5 text-[13px] last:border-0">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      {value ? (
        <>
          {href ? (
            <a href={explorerTx(value)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-seal hover:text-seal-strong">
              {shortHash(value)} ↗
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate font-mono">{shortHash(value)}</span>
          )}
          <CopyIconButton content={value} label={`Copy ${label}`} />
        </>
      ) : (
        <span className="flex-1 text-muted">{final ? "—" : "pending"}</span>
      )}
    </div>
  );
}

function attestationText(mode: RunMode, final: boolean, receipt?: Receipt): string {
  if (mode === "local") return "Recorded run · not attested";
  if (receipt?.attested) return "Verified";
  return final ? "Not attested" : "Pending";
}

export function ReceiptList({ receipt, mode, final }: { receipt?: Receipt; mode: RunMode; final: boolean }) {
  const copyAll = receipt ? JSON.stringify(receipt, null, 2) : "";
  return (
    <section className="rounded-[14px] border border-line bg-surface px-[18px] py-1.5">
      <div className="flex items-center justify-between py-2.5">
        <span className="text-sm font-semibold">Receipt</span>
        {receipt && <CopyIconButton content={copyAll} label="Copy receipt" />}
      </div>
      <ReceiptRow label="Payment" value={receipt?.settle_tx ?? null} href final={final} />
      <ReceiptRow label={mode === "local" ? "Recorded run" : "Execution"} value={receipt?.exec_tx || null} href final={final} />
      <ReceiptRow label="Evaluator" value={receipt?.wasm_hash || null} final={final} />
      <div className="flex items-center gap-3 py-2.5 text-[13px]">
        <span className="w-28 shrink-0 text-muted">Attestation</span>
        <span className={cn(receipt?.attested && mode === "enclave" ? "text-seal-strong" : "text-ink-2")}>{attestationText(mode, final, receipt)}</span>
      </div>
    </section>
  );
}
