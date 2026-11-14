"use client";

import type { EvaluatorMetadata, SchemaContract } from "@securelambda/schemas";
import type { SampleRow } from "@/lib/csv";
import { shortHash } from "@/lib/format";
import { CopyIconButton, Display, Engraved, Led, Panel, Slot } from "./ui";

const th = "whitespace-nowrap px-4 py-2.5 text-left font-engraved text-[12px] font-semibold uppercase tracking-[0.12em] text-etch-3";
const td = "whitespace-nowrap px-4 py-2 font-readout text-[13px]";

export function SchemaTable({ schema }: { schema: SchemaContract }) {
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <Engraved>Schema</Engraved>
        <span className="text-[13px] text-etch-3">model.json features follow this order</span>
      </div>
      <Slot className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-chassis-deep/60">
              <th className={th}>#</th>
              <th className={th}>Feature</th>
              <th className={th}>Type</th>
            </tr>
          </thead>
          <tbody>
            {schema.features.map((f, i) => (
              <tr key={f.name} className="border-b border-chassis-deep/40">
                <td className={`${td} text-etch-3`}>{i + 1}</td>
                <td className={td}>{f.name}</td>
                <td className={td}>{f.type}</td>
              </tr>
            ))}
            <tr>
              <td className={`${td} text-etch-3`}>label</td>
              <td className={`${td} font-semibold`}>{schema.label}</td>
              <td className={td}>0 | 1</td>
            </tr>
          </tbody>
        </table>
      </Slot>
    </Panel>
  );
}

export function SampleRows({
  schema,
  rows,
  extra,
}: {
  schema: SchemaContract;
  rows: SampleRow[];
  extra?: { header: string[]; cells: (i: number) => React.ReactNode[] };
}) {
  const columns = [...schema.features.map((f) => f.name), schema.label];
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <Engraved>Sample rows</Engraved>
        <span className="text-[13px] text-etch-3">Made up, not from the real data</span>
      </div>
      <Slot className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-chassis-deep/60">
              {[...columns, ...(extra?.header ?? [])].map((c) => (
                <th key={c} className={th}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-chassis-deep/40 last:border-0">
                {columns.map((c) => (
                  <td key={c} className={td}>{String(row[c] ?? "")}</td>
                ))}
                {extra?.cells(i).map((cell, j) => (
                  <td key={`x${j}`} className={td}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Slot>
    </Panel>
  );
}

function trustLabel(tier: 1 | 2): string {
  return tier === 1 ? "operator-set key" : "attested key";
}

export function EvaluatorPanel({ evaluator, expectedVersion }: { evaluator?: EvaluatorMetadata; expectedVersion: string }) {
  if (!evaluator) return <div className="h-[196px] animate-pulse rounded-[20px] bg-display/80" aria-label="Loading evaluator" />;
  const matches = evaluator.version === expectedVersion;
  return (
    <Display className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-engraved text-[13px] font-semibold uppercase tracking-[0.14em] text-display-dim">Evaluator</span>
        <span className="flex items-center gap-2 text-[13px]">
          <Led tone={matches ? "ok" : "signal"} />
          {matches ? "Matches listing" : `Listing needs ${expectedVersion}`}
        </span>
      </div>
      <dl className="flex flex-col gap-2 font-readout text-[12px] text-display-dim">
        <div className="flex justify-between gap-3"><dt>version</dt><dd className="text-flap-ink">{evaluator.version}</dd></div>
        <div className="flex items-center justify-between gap-3">
          <dt>build</dt>
          <dd className="flex items-center gap-1 text-flap-ink">{shortHash(evaluator.wasm_hash)}<CopyIconButton content={evaluator.wasm_hash} label="Copy evaluator build hash" dark /></dd>
        </div>
        <div className="flex justify-between gap-3"><dt>project</dt><dd className="truncate text-flap-ink">{evaluator.project_id}</dd></div>
        <div className="flex justify-between gap-3"><dt>trust</dt><dd className="text-flap-ink">{trustLabel(evaluator.trust_tier)}</dd></div>
      </dl>
      <p className="border-t border-display-line pt-3 text-[13px] text-display-dim">
        {matches ? "Files are locked to this evaluator. Only it can open them." : "Uploads are off until the evaluator matches this listing."}
      </p>
    </Display>
  );
}
