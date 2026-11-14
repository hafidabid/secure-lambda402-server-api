import type { Receipt, Run } from "@securelambda/schemas";

export type StageStatus = "pending" | "active" | "done" | "slow" | "failed" | "skipped";

export interface Stage {
  key: "authorised" | "paid" | "attested" | "result";
  label: string;
  status: StageStatus;
}

const SLOW_AFTER_MS = 30_000;

function activeOrSlow(run: Run, now: number): StageStatus {
  return now - Date.parse(run.created_at) > SLOW_AFTER_MS ? "slow" : "active";
}

function authorised(run: Run): StageStatus {
  if (run.state === "PAYMENT_REJECTED") return "failed";
  return run.state === "REQUESTED" ? "active" : "done";
}

function paid(run: Run, receipt: Receipt | undefined, now: number): StageStatus {
  if (receipt?.settle_tx) return "done";
  if (run.state === "FAILED_NOT_CHARGED" || run.state === "PAYMENT_REJECTED") return "skipped";
  return run.result ? activeOrSlow(run, now) : "pending";
}

function attested(run: Run, receipt: Receipt | undefined, now: number): StageStatus {
  if (run.mode === "local") return "skipped";
  if (receipt?.attested) return "done";
  if (run.state === "FAILED_NOT_CHARGED" || run.state === "PAYMENT_REJECTED") return "failed";
  return ["REQUESTED", "PAYMENT_VERIFIED", "QUEUED"].includes(run.state) ? "pending" : activeOrSlow(run, now);
}

function result(run: Run, now: number): StageStatus {
  if (run.result) return "done";
  if (run.state === "FAILED_NOT_CHARGED" || run.state === "PAYMENT_REJECTED") return "failed";
  return run.state === "REQUESTED" ? "pending" : activeOrSlow(run, now);
}

export function deriveStages(run: Run, receipt: Receipt | undefined, now = Date.now()): Stage[] {
  return [
    { key: "authorised", label: "Authorised", status: authorised(run) },
    { key: "paid", label: "Paid", status: paid(run, receipt, now) },
    { key: "attested", label: "Attested", status: attested(run, receipt, now) },
    { key: "result", label: "Result", status: result(run, now) },
  ];
}
