"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useListings } from "@/lib/queries";
import { JudgeBanner } from "@/components/judge-banner";
import { errorMessage, formatNear } from "@/lib/format";
import { Btn, Engraved, Page, PageError, PageTitle, Skeleton } from "@/components/ui";

export default function CatalogPage() {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useListings(query);
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page>
      <JudgeBanner />
      <PageTitle
        aside={
          <label className="flex h-11 w-full items-center gap-2 rounded-full bg-slot px-4 shadow-[inset_0_2px_4px_rgba(40,36,28,0.14)] focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-signal sm:w-[300px]">
            <Search className="size-4 text-etch-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name"
              aria-label="Search datasets"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-etch-3"
            />
          </label>
        }
      >
        Datasets
      </PageTitle>

      {error && <PageError message={errorMessage(error)} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[190px] rounded-[28px]" />)}
        {items.map((l) => (
          <Link
            key={l.id}
            href={`/listings/${l.id}`}
            className="group flex flex-col gap-4 rounded-[28px] bg-chassis p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_24px_44px_-32px_rgba(40,36,28,0.55)] transition-transform duration-150 hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-[18px] font-semibold leading-snug">{l.name}</span>
              <span className="shrink-0 rounded-full bg-display px-3 py-1 font-readout text-[13px] text-flap-ink">
                {formatNear(l.price_amount)} {l.price_asset.toUpperCase()}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {l.schema.features.slice(0, 4).map((f) => (
                <span key={f.name} className="rounded-full bg-slot px-2.5 py-0.5 font-readout text-[12px] text-etch-2">{f.name}</span>
              ))}
              {l.schema.features.length > 4 && (
                <span className="rounded-full bg-slot px-2.5 py-0.5 font-readout text-[12px] text-etch-2">+{l.schema.features.length - 4}</span>
              )}
              <span className="rounded-full border-[1.5px] border-etch-3 px-2.5 py-0.5 font-readout text-[12px]">→ {l.schema.label}</span>
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-chassis-deep pt-3">
              <Engraved>Evaluator {l.evaluator_version}</Engraved>
              <span className="text-[13px] text-etch-3 group-hover:text-etch">Open →</span>
            </div>
          </Link>
        ))}
      </div>

      {data && items.length === 0 && <p className="text-[15px] text-etch-2">No datasets match.</p>}
      {hasNextPage && (
        <Btn variant="outline" className="self-center" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </Btn>
      )}
    </Page>
  );
}
