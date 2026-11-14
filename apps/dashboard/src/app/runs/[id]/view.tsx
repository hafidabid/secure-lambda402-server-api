"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { isTerminal } from "@securelambda/schemas";
import { useListing, useReceipt, useRun } from "@/lib/queries";
import { deriveStages, type Stage } from "@/lib/run-stages";
import { formatTime } from "@/lib/format";
import { CopyIconButton, LinkBtn, ModeBadge, PageError } from "@/components/ui";
import { MetricTiles, ReceiptList, RunStages } from "@/components/run";

const STAGE_KEYS: Stage["key"][] = ["authorised", "paid", "attested", "result"];

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function RunView() {
  const { id } = useParams<{ id: string }>();
  const { data: run, error } = useRun(id);
  const terminal = !!run && isTerminal(run.state);
  const { data: receipt } = useReceipt(id, run?.state);
  const { data: listing } = useListing(run?.listing_id ?? "");
  const now = useNow(!terminal);
  const [seenAt, setSeenAt] = useState<Partial<Record<Stage["key"], string>>>({});
  const [seenKeys, setSeenKeys] = useState("");

  const stages = run ? deriveStages(run, receipt, now) : [];
  const doneKeys = stages.filter((s) => s.status === "done").map((s) => s.key).join(",");

  if (doneKeys !== seenKeys) {
    setSeenKeys(doneKeys);
    const next = { ...seenAt };
    for (const key of STAGE_KEYS) {
      if (doneKeys.split(",").includes(key)) next[key] ??= formatTime(new Date(now).toISOString());
    }
    setSeenAt(next);
  }

  if (error) return <div className="mx-auto max-w-[1100px] px-6 py-8"><PageError message="This run could not be found." /></div>;
  if (!run) return <div className="mx-auto h-[400px] max-w-[1100px] animate-pulse px-6 py-8" aria-label="Loading run" />;

  const failed = run.state === "FAILED_NOT_CHARGED" || run.state === "PAYMENT_REJECTED";
  const liveMessage = stages.map((s) => `${s.label} ${s.status}`).join(", ");

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-6 py-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{listing?.name ?? "Run"}</h1>
          <ModeBadge mode={run.mode} />
        </div>
        <span className="flex items-center gap-2 font-mono text-[13px] text-muted">
          {run.id}
          <CopyIconButton content={run.id} label="Copy run id" />
        </span>
      </div>

      <p className="sr-only" aria-live="polite">{liveMessage}</p>
      <RunStages stages={stages} seenAt={seenAt} />

      {failed ? (
        <section role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F5C2BC] bg-danger-soft px-5 py-4">
          <span className="text-[15px] font-semibold text-danger-ink">The run did not complete. You were not charged.</span>
          <LinkBtn href={`/buy/${run.listing_id}/run?model=${run.model_id}`} className="h-9">Try again</LinkBtn>
        </section>
      ) : (
        <>
          <MetricTiles result={run.result} />
          <span className="text-[13px] text-muted">Payment is taken only after a successful run.</span>
        </>
      )}

      <ReceiptList receipt={receipt} mode={run.mode} final={terminal} />
    </div>
  );
}
