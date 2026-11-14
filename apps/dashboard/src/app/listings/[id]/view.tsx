"use client";

import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useEvaluator, useListing } from "@/lib/queries";
import { formatNear, userMessage } from "@/lib/format";
import { ApiRequestError } from "@/lib/api";
import { Card, Crumb, LinkBtn, PageError } from "@/components/ui";
import { EvaluatorPanel, SampleRows, SchemaTable } from "@/components/listing";

export function ListingView() {
  const { id } = useParams<{ id: string }>();
  const { data: listing, error } = useListing(id);
  const { data: evaluator } = useEvaluator();

  if (error) return <div className="mx-auto max-w-[1200px] px-6 py-8"><PageError message={userMessage(error instanceof ApiRequestError ? error.code : "NETWORK")} /></div>;
  if (!listing) return <div className="mx-auto h-[400px] max-w-[1200px] animate-pulse px-6 py-8" aria-label="Loading listing" />;

  const evaluatorOk = evaluator?.version === listing.evaluator_version;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-6 py-7">
      <Crumb href="/listings">Catalog</Crumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] font-semibold tracking-tight">{listing.name}</h1>
          <span className="font-mono text-[13px] text-muted">
            binary classification · {listing.schema.features.length} features · evaluator {listing.evaluator_version}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-2xl font-semibold">
            {formatNear(listing.price_amount)} <span className="text-[13px] font-normal text-muted">{listing.price_asset.toUpperCase()} / run</span>
          </span>
          <LinkBtn
            href={`/buy/${listing.id}/model`}
            aria-disabled={!evaluatorOk}
            className="h-11 text-[15px] aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            Test my model<ArrowRight />
          </LinkBtn>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <SchemaTable schema={listing.schema} />
          <SampleRows schema={listing.schema} rows={listing.sample_rows} />
        </div>
        <div className="flex flex-col gap-4">
          <EvaluatorPanel evaluator={evaluator} expectedVersion={listing.evaluator_version} />
          <Card className="px-4 py-1.5 text-[13px]">
            <div className="flex justify-between border-b border-surface-2 py-2.5"><span className="text-muted">You get</span><span className="font-mono">accuracy · auc · f1 · row bucket</span></div>
            <div className="flex justify-between py-2.5"><span className="text-muted">Charged</span><span className="font-mono">only on success</span></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
