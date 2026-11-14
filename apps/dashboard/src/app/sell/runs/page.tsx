"use client";

import Link from "next/link";
import type { RunState } from "@securelambda/schemas";
import { useSellerRuns } from "@/lib/queries";
import { errorMessage, formatTime } from "@/lib/format";
import { Engraved, Led, Page, PageError, PageTitle, Panel, Slot, type LedTone } from "@/components/ui";
import { SignInGate } from "@/components/gate";

function stateTone(state: RunState): LedTone {
  if (state === "SETTLED") return "ok";
  if (state === "FAILED_NOT_CHARGED" || state === "PAYMENT_REJECTED") return "off";
  return "signal";
}

const th = "whitespace-nowrap px-4 py-2.5 text-left font-engraved text-[12px] font-semibold uppercase tracking-[0.12em] text-etch-3";

function SellerRuns() {
  const { data: runs, isLoading, error } = useSellerRuns();
  const settled = runs?.filter((r) => r.state === "SETTLED").length ?? 0;

  return (
    <Page>
      <PageTitle aside={<span className="font-readout text-[14px] text-etch-2">{settled} paid · {runs?.length ?? 0} total</span>}>
        Runs on your data
      </PageTitle>
      <p className="-mt-2 text-[15px] text-etch-2">Who ran a model on your listings and when. You never see their model or score.</p>
      {error && <PageError message={errorMessage(error)} />}
      <Panel className="flex flex-col gap-3">
        <Engraved className="px-1">Latest first</Engraved>
        <Slot className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-chassis-deep/60">
                <th className={th}>Time</th>
                <th className={th}>Run</th>
                <th className={th}>Buyer</th>
                <th className={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="px-4 py-6 text-center text-etch-3">Loading…</td></tr>}
              {runs?.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-etch-3">No runs yet. <Link href="/sell/new" className="font-semibold text-etch underline">List a dataset</Link></td></tr>
              )}
              {runs?.map((r) => (
                <tr key={r.id} className="border-b border-chassis-deep/40 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 font-readout text-[13px] text-etch-3">{formatTime(r.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-readout text-[13px]">{r.id}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-readout text-[13px]">{r.buyer_id}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="inline-flex items-center gap-2 text-[13px]"><Led tone={stateTone(r.state)} />{r.state.toLowerCase().replaceAll("_", " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Slot>
      </Panel>
    </Page>
  );
}

export default function SellerRunsPage() {
  return (
    <SignInGate title="Sign in to see runs on your data" lead="Sign in with the NEAR account that owns your listings.">
      <SellerRuns />
    </SignInGate>
  );
}
