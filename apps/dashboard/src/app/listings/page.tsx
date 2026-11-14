"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Search } from "lucide-react";
import { useListings } from "@/lib/queries";
import { formatNear, userMessage } from "@/lib/format";
import { ApiRequestError } from "@/lib/api";
import { Badge, PageError } from "@/components/ui";

export default function CatalogPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useListings(q);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Datasets</h1>
        <label className="flex h-9 min-w-[260px] items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 focus-within:border-seal">
          <Search className="size-3.5 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or feature"
            aria-label="Search datasets"
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </div>

      {error && <PageError message={userMessage(error instanceof ApiRequestError ? error.code : "NETWORK")} />}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {isLoading && [0, 1, 2].map((i) => <div key={i} className="h-[170px] animate-pulse rounded-[14px] bg-surface-2" />)}
        {data?.items.map((l) => (
          <Link key={l.id} href={`/listings/${l.id}`} className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5 hover:border-line-strong">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[17px] font-semibold">{l.name}</span>
              <span className="whitespace-nowrap font-mono text-[15px] font-semibold">
                {formatNear(l.price_amount)} <span className="text-xs font-normal text-muted">{l.price_asset.toUpperCase()}</span>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {l.schema.features.slice(0, 4).map((f) => (
                <span key={f.name} className="rounded-[5px] border border-line bg-paper px-1.5 py-0.5 font-mono text-xs text-ink-2">{f.name}</span>
              ))}
              {l.schema.features.length > 4 && (
                <span className="rounded-[5px] border border-line bg-paper px-1.5 py-0.5 font-mono text-xs text-ink-2">+{l.schema.features.length - 4}</span>
              )}
              <span className="rounded-[5px] border border-[#CBE9E1] bg-seal-soft px-1.5 py-0.5 font-mono text-xs text-seal-strong">→ {l.schema.label}</span>
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-surface-2 pt-3 text-xs text-muted">
              <Badge className="bg-ink text-glow"><Lock className="size-2.5" strokeWidth={2.5} />evaluator {l.evaluator_version}</Badge>
              <span className="font-mono">{l.schema.features.length} features</span>
            </div>
          </Link>
        ))}
        {data && data.items.length === 0 && <p className="text-sm text-muted">No datasets match.</p>}
      </div>
    </div>
  );
}
