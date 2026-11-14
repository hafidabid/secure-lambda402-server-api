"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, RefreshCw } from "lucide-react";
import { MAX_UPLOAD_BYTES_TONIGHT, type Listing, type ListingRules, type SchemaContract } from "@securelambda/schemas";
import { api, ApiRequestError } from "@/lib/api";
import { useEvaluator } from "@/lib/queries";
import { useWallet } from "@/lib/wallet";
import { classCounts, inferSchema, parseCsv, synthRows, validateCsv, type ParsedCsv, type SampleRow } from "@/lib/csv";
import { nearToYocto, userMessage } from "@/lib/format";
import { sealAndUpload, type SealStep } from "@/lib/seal";
import { Btn, CheckRow, LinkBtn, PageError, cn } from "@/components/ui";
import { SampleRows, SchemaTable } from "@/components/listing";
import { EncryptProgress, FileDrop } from "@/components/seal";

const STEPS = ["Describe", "Samples", "Price", "Upload", "Publish"];

function Stepper({ at }: { at: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          {i > 0 && <span className={cn("h-px w-5", i <= at ? "bg-ink" : "bg-line-strong")} />}
          <span
            aria-current={i === at ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 text-[13px]",
              i === at ? "rounded-full border border-line bg-surface py-[3px] pl-[3px] pr-3 font-semibold" : "text-ink-2",
            )}
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full font-mono text-[11px] font-semibold",
                i < at && "bg-ink text-white",
                i === at && "bg-seal text-white",
                i > at && "border border-line-strong text-muted",
              )}
            >
              {i < at ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium">
      {label}
      {children}
    </label>
  );
}

const input = "h-10 rounded-md border border-line-strong bg-surface px-3 font-mono text-[13px] outline-none focus:border-seal";

const DEFAULT_RULES: ListingRules = { min_rows: 500, min_class_count: 50, round: 2, metrics: ["accuracy", "auc", "f1"], runs_per_day: 10, lifetime_budget: 200 };

export default function SellWizard() {
  const wallet = useWallet();
  const { data: evaluator } = useEvaluator();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [label, setLabel] = useState("");
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [price, setPrice] = useState("2");
  const [rules, setRules] = useState<ListingRules>(DEFAULT_RULES);
  const [listing, setListing] = useState<Listing | null>(null);
  const [sealStep, setSealStep] = useState<SealStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const schema: SchemaContract | null = csv && label ? inferSchema(csv, label) : null;
  const csvErrors = csv && schema ? validateCsv(csv, schema, rules) : [];
  const tooLarge = !!file && file.size > MAX_UPLOAD_BYTES_TONIGHT;

  const onFile = async (f: File) => {
    const parsed = parseCsv(await f.text());
    setFile(f);
    setCsv(parsed);
    setLabel(parsed.header[parsed.header.length - 1] ?? "");
    setSealStep(null);
  };

  const fail = (e: unknown) => setError(userMessage(e instanceof ApiRequestError ? e.code : "NETWORK"));

  const createDraft = async () => {
    if (!schema || !wallet.accountId || !evaluator) return;
    setBusy(true);
    setError(null);
    try {
      const dto = { name, schema, sample_rows: samples, price_amount: nearToYocto(price), price_asset: "near", rules, evaluator_version: evaluator.version };
      const draft = listing ? await api.patchListing(listing.id, dto, wallet.accountId) : await api.createListing(dto, wallet.accountId);
      setListing(draft);
      setStep(3);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!file || !listing || !evaluator || !wallet.accountId) return;
    setError(null);
    try {
      await sealAndUpload(file, listing.id, "dataset", evaluator, wallet.accountId, setSealStep);
    } catch {
      setError("Upload failed. Nothing was saved. Retry.");
    }
  };

  const publish = async () => {
    if (!listing || !wallet.accountId) return;
    setBusy(true);
    setError(null);
    try {
      setListing(await api.publishListing(listing.id, wallet.accountId));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (wallet.status !== "connected") {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col items-start gap-4 px-6 py-16">
        <h1 className="text-[26px] font-semibold tracking-tight">Connect your wallet to sell</h1>
        <p className="text-sm text-ink-2">Your NEAR account receives payment for every run.</p>
        <Btn onClick={() => wallet.connect("hospital.testnet")}>Connect wallet</Btn>
      </div>
    );
  }

  const counts = csv && label ? classCounts(csv, label) : null;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 py-8">
      <Stepper at={step} />

      {step === 0 && (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight">Describe your dataset</h1>
          <Field label="Name">
            <input className={cn(input, "font-sans text-sm")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Diabetes risk, Hospital A" />
          </Field>
          <FileDrop
            accept=".csv,text/csv"
            file={file}
            state={csv ? "valid" : "idle"}
            meta={csv ? `${csv.rows.length} rows · ${csv.header.length} columns · read on this device` : "numeric features plus one 0/1 label column"}
            placeholder="Drop your CSV"
            onFile={onFile}
          />
          {csv && (
            <Field label="Label column">
              <select className={input} value={label} onChange={(e) => setLabel(e.target.value)}>
                {csv.header.map((h) => <option key={h}>{h}</option>)}
              </select>
            </Field>
          )}
          {schema && <SchemaTable schema={schema} />}
          <div className="flex justify-end">
            <Btn disabled={!name.trim() || !schema} onClick={() => { if (csv && schema) setSamples(synthRows(csv, schema)); setStep(1); }}>Next</Btn>
          </div>
        </>
      )}

      {step === 1 && schema && csv && (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight">Check the sample rows</h1>
          <p className="text-sm text-ink-2">Buyers test against these. They are generated, not taken from your file.</p>
          <SampleRows schema={schema} rows={samples} />
          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(0)}>Back</Btn>
            <div className="flex gap-2">
              <Btn variant="outline" onClick={() => setSamples(synthRows(csv, schema))}><RefreshCw />Regenerate</Btn>
              <Btn onClick={() => setStep(2)}>Next</Btn>
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight">Price and limits</h1>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price per run (NEAR)"><input className={input} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Round metrics to (decimals)"><input className={input} type="number" min={0} max={6} value={rules.round} onChange={(e) => setRules({ ...rules, round: Number(e.target.value) })} /></Field>
            <Field label="Min rows"><input className={input} type="number" value={rules.min_rows} onChange={(e) => setRules({ ...rules, min_rows: Number(e.target.value) })} /></Field>
            <Field label="Min rows per class"><input className={input} type="number" value={rules.min_class_count} onChange={(e) => setRules({ ...rules, min_class_count: Number(e.target.value) })} /></Field>
            <Field label="Runs per buyer per day"><input className={input} type="number" value={rules.runs_per_day} onChange={(e) => setRules({ ...rules, runs_per_day: Number(e.target.value) })} /></Field>
            <Field label="Lifetime run budget"><input className={input} type="number" value={rules.lifetime_budget} onChange={(e) => setRules({ ...rules, lifetime_budget: Number(e.target.value) })} /></Field>
          </div>
          {error && <PageError message={error} />}
          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(1)}>Back</Btn>
            <Btn disabled={busy || !(Number(price) > 0) || !evaluator} onClick={createDraft}>{busy ? "Saving…" : "Next"}</Btn>
          </div>
        </>
      )}

      {step === 3 && file && csv && schema && evaluator && (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight">Encrypt and upload</h1>
          <FileDrop
            accept=".csv,text/csv"
            file={file}
            state={csvErrors.length || tooLarge ? "invalid" : "valid"}
            meta={`${(file.size / 1024).toFixed(0)} KB of 1 MB · ${csv.rows.length} rows`}
            placeholder=""
            onFile={onFile}
          />
          <div className="rounded-[14px] border border-line bg-surface px-[18px] py-1">
            <CheckRow ok={!tooLarge} label="Size" detail={tooLarge ? "File is larger than the 1 MB limit." : "under 1 MB"} />
            <CheckRow ok={!csvErrors.some((e) => e.kind === "header")} label="Header matches schema" detail={[...schema.features.map((f) => f.name), schema.label].join(", ")} />
            <CheckRow ok={!csvErrors.some((e) => e.kind === "types")} label="Types and labels" />
            <CheckRow ok={!csvErrors.some((e) => e.kind === "rows")} label="Enough rows" detail={counts ? `${csv.rows.length} · class 0: ${counts.zeros} · class 1: ${counts.ones}` : undefined} />
          </div>
          {csvErrors.length > 0 && (
            <div role="alert" className="flex flex-col gap-1 rounded-xl border border-[#F5C2BC] bg-danger-soft px-4 py-3">
              {csvErrors.map((e) => <span key={e.message} className="font-mono text-xs text-danger-ink">{e.message}</span>)}
            </div>
          )}
          {sealStep && <EncryptProgress step={sealStep} failed={error} wasmHash={evaluator.wasm_hash} onRetry={upload} />}
          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(2)} disabled={sealStep !== null && sealStep !== "done"}>Back</Btn>
            {sealStep === "done" ? (
              <Btn onClick={() => setStep(4)}>Next</Btn>
            ) : (
              <Btn onClick={upload} disabled={csvErrors.length > 0 || tooLarge || (sealStep !== null && !error)}>Encrypt and upload</Btn>
            )}
          </div>
        </>
      )}

      {step === 4 && listing && (
        <>
          <h1 className="text-[26px] font-semibold tracking-tight">{listing.status === "published" ? "Published" : "Publish"}</h1>
          <div className="rounded-[14px] border border-line bg-surface px-[18px] py-1">
            <CheckRow ok label="Dataset locked to evaluator" detail={evaluator?.version} />
            <CheckRow ok label="Price" detail={`${price} NEAR per run`} />
            <CheckRow ok label="Limits" detail={`${rules.runs_per_day} / buyer / day · ${rules.lifetime_budget} total`} />
          </div>
          {error && <PageError message={error} />}
          <div className="flex justify-end gap-2">
            {listing.status === "published" ? (
              <>
                <LinkBtn variant="outline" href="/sell/runs">See runs</LinkBtn>
                <LinkBtn href={`/listings/${listing.id}`}>Open listing</LinkBtn>
              </>
            ) : (
              <Btn variant="seal" disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Publish"}</Btn>
            )}
          </div>
          {listing.status === "published" && <Link href="/listings" className="text-sm text-seal">Back to catalog</Link>}
        </>
      )}
    </div>
  );
}
