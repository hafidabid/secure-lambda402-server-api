"use client";

import Link from "next/link";
import type { RunState } from "@securelambda/schemas";
import { useSellerRuns } from "@/lib/queries";
import { useWallet } from "@/lib/wallet";
import { ApiRequestError } from "@/lib/api";
import { formatTime, userMessage } from "@/lib/format";
import { Badge, Btn, Card, PageError } from "@/components/ui";

function stateTone(state: RunState): string {
  if (state === "SETTLED") return "bg-seal-soft text-seal-strong";
  if (state === "FAILED_NOT_CHARGED" || state === "PAYMENT_REJECTED") return "bg-surface-2 text-ink-2";
  return "bg-warn-soft text-warn";
}

export default function SellerRunsPage() {
  const wallet = useWallet();
  const { data: runs, isLoading, error } = useSellerRuns(wallet.accountId);

  if (wallet.status !== "connected") {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col items-start gap-4 px-6 py-16">
        <h1 className="text-[26px] font-semibold tracking-tight">Connect your wallet to see runs</h1>
        <Btn onClick={() => wallet.connect("hospital.testnet")}>Connect wallet</Btn>
      </div>
    );
  }

  const settled = runs?.filter((r) => r.state === "SETTLED").length ?? 0;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Runs on your data</h1>
        <span className="font-mono text-sm text-muted">{settled} paid · {runs?.length ?? 0} total</span>
      </div>
      {error && <PageError message={userMessage(error instanceof ApiRequestError ? error.code : "NETWORK")} />}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left font-sans text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Run</th>
                <th className="px-4 py-2.5 font-medium">Buyer</th>
                <th className="px-4 py-2.5 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="px-4 py-6 text-center font-sans text-muted">Loading…</td></tr>}
              {runs?.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center font-sans text-muted">No runs yet. <Link href="/sell/new" className="text-seal">List a dataset</Link></td></tr>
              )}
              {runs?.map((r) => (
                <tr key={r.id} className="border-b border-surface-2 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatTime(r.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><Link href={`/runs/${r.id}`} className="hover:text-seal">{r.id}</Link></td>
                  <td className="whitespace-nowrap px-4 py-2.5">{r.buyer_id}</td>
                  <td className="px-4 py-2.5"><Badge className={stateTone(r.state)}>{r.state.toLowerCase().replaceAll("_", " ")}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
