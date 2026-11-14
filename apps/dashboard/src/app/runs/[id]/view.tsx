"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { isTerminal } from "@securelambda/schemas";
import { useEvaluator, useListing, useReceipt, useRun } from "@/lib/queries";
import { deriveStages, type Stage } from "@/lib/run-stages";
import { formatTime, userMessage } from "@/lib/format";
import { CopyIconButton, LinkBtn, ModeBadge, Page, PageError, PageTitle, Skeleton } from "@/components/ui";
import { MetricTiles, ReceiptList, RunStages } from "@/components/run";
import { SignInGate } from "@/components/gate";

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

function failureText(state: string, errorCode: string | null): string {
  if (state === "PAYMENT_REJECTED") return "The payment did not verify. You were not charged.";
  if (errorCode === "DATA_UNUSABLE" || errorCode === "MODEL_UNUSABLE") return userMessage(errorCode);
  return "The run did not complete. You were not charged.";
}

function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: run, error } = useRun(id);
  const terminal = !!run && isTerminal(run.state);
  const { data: receipt } = useReceipt(id, run?.state);
  const { data: listing } = useListing(run?.listing_id ?? "");
  const { data: evaluator } = useEvaluator();
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

  if (error) return <Page><PageError message="This run could not be found for your account." /></Page>;
  if (!run) return <Page><Skeleton className="h-[420px]" /></Page>;

  const failed = run.state === "FAILED_NOT_CHARGED" || run.state === "PAYMENT_REJECTED";
  const liveMessage = stages.map((s) => `${s.label} ${s.status}`).join(", ");

  return (
    <Page>
      <PageTitle
        aside={
          <span className="flex items-center gap-1 font-readout text-[13px] text-etch-3">
            {run.id}
            <CopyIconButton content={run.id} label="Copy run id" />
          </span>
        }
      >
        <span className="flex flex-wrap items-center gap-3">
          {listing?.name ?? "Run"}
          <ModeBadge mode={run.mode} trustTier={evaluator?.trust_tier} />
        </span>
      </PageTitle>

      <p className="sr-only" aria-live="polite">{liveMessage}</p>
      <RunStages stages={stages} seenAt={seenAt} />

      {failed ? (
        <PageError
          message={failureText(run.state, run.error_code)}
          action={<LinkBtn href={`/buy/${run.listing_id}/run?model=${run.model_id}`} className="h-9 px-4 text-[14px]">Try again</LinkBtn>}
        />
      ) : (
        <MetricTiles result={run.result} />
      )}

      <ReceiptList receipt={receipt} mode={run.mode} final={terminal} />
    </Page>
  );
}

export function RunView() {
  return (
    <SignInGate title="Sign in to see this run" lead="Only the account that paid for a run can see its score and receipt.">
      <RunDetail />
    </SignInGate>
  );
}
