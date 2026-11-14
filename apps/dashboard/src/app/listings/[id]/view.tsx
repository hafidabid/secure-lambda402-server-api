"use client";

import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useEvaluator, useListing } from "@/lib/queries";
import { errorMessage, formatNear } from "@/lib/format";
import { Crumb, Engraved, LinkBtn, Page, PageError, Panel, Skeleton, Slot } from "@/components/ui";
import { EvaluatorPanel, SampleRows, SchemaTable } from "@/components/listing";

export function ListingView() {
  const { id } = useParams<{ id: string }>();
  const { data: listing, error } = useListing(id);
  const { data: evaluator } = useEvaluator();

  if (error) return <Page><PageError message={errorMessage(error)} /></Page>;
  if (!listing) return <Page><Skeleton className="h-[420px]" /></Page>;

  const evaluatorOk = evaluator?.version === listing.evaluator_version;

  return (
    <Page>
      <Crumb href="/listings">Datasets</Crumb>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-[clamp(1.75rem,3.4vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.02em]">{listing.name}</h1>
          <span className="text-[15px] text-etch-2">
            Binary classification · {listing.schema.features.length} features · evaluator {listing.evaluator_version}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-readout text-[26px] font-semibold">
            {formatNear(listing.price_amount)} <span className="text-[14px] font-normal text-etch-3">{listing.price_asset.toUpperCase()} per run</span>
          </span>
          <LinkBtn href={`/buy/${listing.id}/model`} aria-disabled={!evaluatorOk} className="h-12 px-6">
            Test my model
            <ArrowRight />
          </LinkBtn>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <SchemaTable schema={listing.schema} />
          <SampleRows schema={listing.schema} rows={listing.sample_rows} />
        </div>
        <div className="flex flex-col gap-5">
          <EvaluatorPanel evaluator={evaluator} expectedVersion={listing.evaluator_version} />
          <Panel className="flex flex-col gap-3">
            <Engraved>What leaves the evaluator</Engraved>
            <Slot className="text-[14px]">
              <div className="flex justify-between gap-3 border-b border-chassis-deep/50 px-4 py-2.5"><span className="text-etch-3">You get</span><span>Accuracy, AUC, F1, row range</span></div>
              <div className="flex justify-between gap-3 px-4 py-2.5"><span className="text-etch-3">Charged</span><span>Only when a score is delivered</span></div>
            </Slot>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
