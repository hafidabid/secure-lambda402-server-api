"use client";

import { Check, Lock, TriangleAlert } from "lucide-react";
import type { EvaluatorMetadata, SchemaContract } from "@securelambda/schemas";
import type { SampleRow } from "@/lib/csv";
import { shortHash } from "@/lib/format";
import { Badge, Card, CopyIconButton } from "./ui";

export function SchemaTable({ schema }: { schema: SchemaContract }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
        <span className="text-sm font-semibold">Schema</span>
        <span className="font-mono text-xs text-muted">model.json features follow this order</span>
      </div>
      <table className="w-full border-collapse font-mono text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">feature</th>
            <th className="px-4 py-2 font-medium">type</th>
          </tr>
        </thead>
        <tbody>
          {schema.features.map((f, i) => (
            <tr key={f.name} className="border-b border-surface-2">
              <td className="px-4 py-2 text-muted">{i + 1}</td>
              <td className="px-4 py-2">{f.name}</td>
              <td className="px-4 py-2">{f.type}</td>
            </tr>
          ))}
          <tr>
            <td className="px-4 py-2 text-muted">label</td>
            <td className="px-4 py-2 text-seal-strong">{schema.label}</td>
            <td className="px-4 py-2">0 | 1</td>
          </tr>
        </tbody>
      </table>
    </Card>
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
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5">
        <span className="text-sm font-semibold">Sample rows</span>
        <Badge className="bg-warn-soft text-warn">synthetic</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              {[...columns, ...(extra?.header ?? [])].map((c) => (
                <th key={c} className="whitespace-nowrap px-4 py-2 font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-surface-2 last:border-0">
                {columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-4 py-2">{String(row[c] ?? "")}</td>
                ))}
                {extra?.cells(i).map((cell, j) => (
                  <td key={`x${j}`} className="whitespace-nowrap px-4 py-2">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function trustLabel(tier: 1 | 2): string {
  return tier === 1 ? "tier 1 · operator-set key" : "tier 2 · attested key";
}

export function EvaluatorPanel({ evaluator, expectedVersion }: { evaluator?: EvaluatorMetadata; expectedVersion: string }) {
  if (!evaluator) {
    return <div className="h-[178px] animate-pulse rounded-[14px] bg-ink/90" aria-label="Loading evaluator" />;
  }
  const matches = evaluator.version === expectedVersion;
  return (
    <section className="flex flex-col gap-3 rounded-[14px] bg-ink p-[18px] text-white">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Evaluator</span>
        {matches ? (
          <Badge className="bg-seal-deep text-glow"><Check className="size-3" strokeWidth={3} />matches listing</Badge>
        ) : (
          <Badge className="bg-danger text-white"><TriangleAlert className="size-3" />hash mismatch</Badge>
        )}
      </div>
      <dl className="flex flex-col gap-2 font-mono text-xs text-code-dim">
        <div className="flex justify-between"><dt>version</dt><dd className="text-code-text">{evaluator.version}</dd></div>
        <div className="flex items-center justify-between">
          <dt>wasm</dt>
          <dd className="flex items-center gap-2 text-code-text">{shortHash(evaluator.wasm_hash)}<CopyIconButton content={evaluator.wasm_hash} label="Copy wasm hash" dark /></dd>
        </div>
        <div className="flex justify-between gap-3"><dt>project</dt><dd className="truncate text-code-text">{evaluator.project_id}</dd></div>
        <div className="flex justify-between"><dt>trust</dt><dd className="text-code-text">{trustLabel(evaluator.trust_tier)}</dd></div>
      </dl>
      <div className="flex items-center gap-2.5 border-t border-code-line pt-3 text-[13px] text-code-text">
        <Lock className="size-3.5 text-glow" />
        {matches ? "Files are locked to this evaluator" : "Encryption is disabled until the evaluator matches"}
      </div>
    </section>
  );
}
