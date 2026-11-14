"use client";

import type { Receipt, RunMode, RunResult } from "@securelambda/schemas";
import type { Stage, StageStatus } from "@/lib/run-stages";
import { shortHash } from "@/lib/format";
import { checkEvaluatorHash, type EvaluatorHashCheck } from "@/lib/evaluator-check";
import { CopyIconButton, Engraved, FlapReadout, Led, Panel, Slot, cn, type LedTone } from "./ui";

function caption(status: StageStatus, key: Stage["key"], seenAt?: string): string {
  if (status === "done" && seenAt) return seenAt;
  if (status === "done") return "Done";
  if (status === "slow") return "Taking longer than usual";
  if (status === "active") return "In progress";
  if (status === "failed") return "Did not complete";
  if (status === "skipped") return key === "attested" ? "Not attested" : "Not charged";
  return "Waiting";
}

const LED: Record<StageStatus, LedTone> = {
  pending: "off",
  active: "ok",
  done: "ok",
  slow: "signal",
  failed: "signal",
  skipped: "off",
};

export function RunStages({ stages, seenAt }: { stages: Stage[]; seenAt: Partial<Record<Stage["key"], string>> }) {
  return (
    <Panel>
      <ol aria-label="Run stages" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {stages.map((s) => (
          <li key={s.key}>
            <Slot className="flex min-h-[78px] flex-col justify-between gap-2 px-4 py-3">
              <span className={cn("flex items-center gap-2.5 text-[15px] font-semibold", s.status === "pending" && "text-etch-3")}>
                <Led tone={LED[s.status]} pulse={s.status === "active" || s.status === "slow"} />
                {s.label}
              </span>
              <span className={cn("font-readout text-[12px]", s.status === "slow" ? "text-signal" : "text-etch-3")}>
                {caption(s.status, s.key, seenAt[s.key])}
              </span>
            </Slot>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function MetricCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="font-engraved text-[13px] font-semibold uppercase tracking-[0.14em] text-display-dim">{label}</span>
      {value === null ? <span className="font-readout text-[24px] text-display-dim">n/a</span> : <FlapReadout label={label} value={value.toFixed(2)} />}
    </div>
  );
}

export function MetricTiles({ result }: { result: RunResult | null }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 rounded-[24px] bg-display p-5 text-flap-ink shadow-[inset_0_3px_10px_rgba(0,0,0,0.6)] sm:p-7 lg:grid-cols-4">
      {result ? (
        <>
          <MetricCell label="Accuracy" value={result.metrics.accuracy} />
          <MetricCell label="AUC" value={result.metrics.auc} />
          <MetricCell label="F1" value={result.metrics.f1} />
          <div className="flex flex-col gap-3">
            <span className="font-engraved text-[13px] font-semibold uppercase tracking-[0.14em] text-display-dim">Rows</span>
            <span className="font-readout text-[24px] font-semibold sm:text-[30px]">{result.n_bucket}</span>
          </div>
        </>
      ) : (
        ["Accuracy", "AUC", "F1", "Rows"].map((l) => (
          <div key={l} className="flex flex-col gap-3" aria-label={`Waiting for ${l}`}>
            <span className="font-engraved text-[13px] font-semibold uppercase tracking-[0.14em] text-display-dim">{l}</span>
            <span className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-11 w-8 animate-pulse rounded-[6px] bg-flap-off sm:h-14 sm:w-10" />
              ))}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function explorerTx(hash: string): string {
  return `https://testnet.nearblocks.io/txns/${hash}`;
}

function ReceiptRow({ label, value, link, final }: { label: string; value: string | null; link?: boolean; final: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-chassis-deep/50 px-4 py-2.5 text-[14px] last:border-0">
      <span className="w-28 shrink-0 text-etch-3">{label}</span>
      {value ? (
        <>
          {link ? (
            <a href={explorerTx(value)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-readout text-[13px] underline">
              {shortHash(value)} ↗
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate font-readout text-[13px]">{shortHash(value)}</span>
          )}
          <CopyIconButton content={value} label={`Copy ${label}`} />
        </>
      ) : (
        <span className="flex-1 text-etch-3">{final ? "None" : "Pending"}</span>
      )}
    </div>
  );
}

const HASH_CHECK: Record<EvaluatorHashCheck, { tone: LedTone; text: string }> = {
  match: { tone: "ok", text: "Matches the build pinned by this listing" },
  mismatch: { tone: "signal", text: "Differs from the pinned build. Payment is blocked." },
  unknown: { tone: "off", text: "Not checked yet" },
};

function attestationText(mode: RunMode, final: boolean, receipt?: Receipt): string {
  if (receipt?.attested) return "Attested by the enclave";
  if (mode === "local") return "Not attested (local mode)";
  return final ? "Not attested" : "Pending";
}

export function ReceiptList({ receipt, mode, final }: { receipt?: Receipt; mode: RunMode; final: boolean }) {
  const hashCheck = checkEvaluatorHash(receipt);
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <Engraved>Receipt</Engraved>
        {receipt && <CopyIconButton content={JSON.stringify(receipt, null, 2)} label="Copy receipt" />}
      </div>
      <Slot>
        <ReceiptRow label="Payment" value={receipt?.settle_tx ?? null} link final={final} />
        <ReceiptRow label="Run" value={receipt?.exec_tx || null} link={mode === "enclave"} final={final} />
        <ReceiptRow label="Evaluator" value={receipt?.wasm_hash || null} final={final} />
        <div className="flex items-center gap-3 border-b border-chassis-deep/50 px-4 py-2.5 text-[14px]">
          <span className="w-28 shrink-0 text-etch-3">Build check</span>
          <span className="flex items-center gap-2">
            <Led tone={HASH_CHECK[hashCheck].tone} />
            {HASH_CHECK[hashCheck].text}
          </span>
        </div>
        <div className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
          <span className="w-28 shrink-0 text-etch-3">Attestation</span>
          <span className="flex items-center gap-2">
            <Led tone={receipt?.attested ? "ok" : "off"} />
            {attestationText(mode, final, receipt)}
          </span>
        </div>
      </Slot>
    </Panel>
  );
}
