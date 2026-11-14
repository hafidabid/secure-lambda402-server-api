"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { MAX_UPLOAD_BYTES_TONIGHT, type Listing, type ListingRules, type SchemaContract } from "@securelambda/schemas";
import { api } from "@/lib/api";
import { useEvaluator } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { classCounts, inferSchema, parseCsv, synthRows, validateCsv, type ParsedCsv, type SampleRow } from "@/lib/csv";
import { errorMessage, nearToYocto } from "@/lib/format";
import { sealAndUpload, type SealStep } from "@/lib/seal";
import { Btn, CheckRow, Engraved, Led, LinkBtn, PageError, Panel, Slot, cn, type LedTone } from "@/components/ui";
import { SampleRows, SchemaTable } from "@/components/listing";
import { EncryptProgress, FileDrop } from "@/components/seal";
import { SignInGate } from "@/components/gate";

const STEPS = ["Describe", "Samples", "Price", "Upload", "Publish"];

function stepLed(i: number, at: number): LedTone {
  if (i < at) return "ok";
  return i === at ? "signal" : "off";
}

function Stepper({ at }: { at: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === at ? "step" : undefined} className="flex items-center gap-2">
          <Led tone={stepLed(i, at)} />
          <span className={cn("font-engraved text-[13px] font-semibold uppercase tracking-[0.12em]", i === at ? "text-etch" : "text-etch-3")}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <Engraved>{label}</Engraved>
      {children}
    </label>
  );
}

const input =
  "h-11 rounded-[14px] bg-slot px-3.5 font-readout text-[14px] shadow-[inset_0_2px_4px_rgba(40,36,28,0.14)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

const DEFAULT_RULES: ListingRules = { min_rows: 500, min_class_count: 50, round: 2, metrics: ["accuracy", "auc", "f1"], runs_per_day: 10, lifetime_budget: 200 };

function StepTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-balance text-[clamp(1.75rem,3.4vw,2.25rem)] font-bold leading-[1.05] tracking-[-0.02em]">{children}</h1>;
}

function SellWizard() {
  const { token } = useSession();
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

  const createDraft = async () => {
    if (!schema || !token || !evaluator) return;
    setBusy(true);
    setError(null);
    try {
      const dto = { name, schema, sample_rows: samples, price_amount: nearToYocto(price), price_asset: "near", rules, evaluator_version: evaluator.version };
      const draft = listing ? await api.patchListing(listing.id, dto, token) : await api.createListing(dto, token);
      setListing(draft);
      setStep(3);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!file || !listing || !evaluator || !token) return;
    setError(null);
    try {
      await sealAndUpload(
        file,
        listing.id,
        "dataset",
        evaluator,
        async (ciphertext, envelope) => (await api.uploadDataset(listing.id, ciphertext, envelope, token)).asset_id,
        setSealStep,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const publish = async () => {
    if (!listing || !token) return;
    setBusy(true);
    setError(null);
    try {
      setListing(await api.publishListing(listing.id, token));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const counts = csv && label ? classCounts(csv, label) : null;

  return (
    <div className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
      <Stepper at={step} />

      {step === 0 && (
        <>
          <StepTitle>Describe your dataset</StepTitle>
          <Field label="Name">
            <input className={cn(input, "font-panel text-[15px]")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Diabetes risk, Hospital A" />
          </Field>
          <FileDrop
            accept=".csv,text/csv"
            file={file}
            state={csv ? "valid" : "idle"}
            meta={csv ? `${csv.rows.length} rows · ${csv.header.length} columns · read on this device only` : "Number columns plus one 0/1 label column"}
            placeholder="Drop your CSV or choose a file"
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
          <StepTitle>Check the sample rows</StepTitle>
          <p className="-mt-2 text-[15px] text-etch-2">Buyers see these to shape their model. They are made up, not copied from your file.</p>
          <SampleRows schema={schema} rows={samples} />
          <div className="flex flex-wrap justify-between gap-2">
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
          <StepTitle>Price and limits</StepTitle>
          <Panel className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Price per run (NEAR)"><input className={input} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Round scores to (decimals)"><input className={input} type="number" min={0} max={6} value={rules.round} onChange={(e) => setRules({ ...rules, round: Number(e.target.value) })} /></Field>
            <Field label="Minimum rows"><input className={input} type="number" value={rules.min_rows} onChange={(e) => setRules({ ...rules, min_rows: Number(e.target.value) })} /></Field>
            <Field label="Minimum rows per class"><input className={input} type="number" value={rules.min_class_count} onChange={(e) => setRules({ ...rules, min_class_count: Number(e.target.value) })} /></Field>
            <Field label="Runs per buyer per day"><input className={input} type="number" value={rules.runs_per_day} onChange={(e) => setRules({ ...rules, runs_per_day: Number(e.target.value) })} /></Field>
            <Field label="Total runs per buyer"><input className={input} type="number" value={rules.lifetime_budget} onChange={(e) => setRules({ ...rules, lifetime_budget: Number(e.target.value) })} /></Field>
          </Panel>
          {error && <PageError message={error} />}
          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(1)}>Back</Btn>
            <Btn disabled={busy || !(Number(price) > 0) || !evaluator} onClick={createDraft}>{busy ? "Saving…" : "Save draft"}</Btn>
          </div>
        </>
      )}

      {step === 3 && file && csv && schema && evaluator && (
        <>
          <StepTitle>Encrypt and upload</StepTitle>
          <FileDrop
            accept=".csv,text/csv"
            file={file}
            state={csvErrors.length || tooLarge ? "invalid" : "valid"}
            meta={`${(file.size / 1024).toFixed(0)} KB of 1 MB · ${csv.rows.length} rows`}
            placeholder=""
            onFile={onFile}
          />
          <Slot>
            <CheckRow ok={!tooLarge} label="Size" detail={tooLarge ? "Larger than the 1 MB limit" : "Under 1 MB"} />
            <CheckRow ok={!csvErrors.some((e) => e.kind === "header")} label="Header matches schema" detail={[...schema.features.map((f) => f.name), schema.label].join(", ")} />
            <CheckRow ok={!csvErrors.some((e) => e.kind === "types")} label="Types and labels" />
            <CheckRow ok={!csvErrors.some((e) => e.kind === "rows")} label="Enough rows" detail={counts ? `${csv.rows.length} · class 0: ${counts.zeros} · class 1: ${counts.ones}` : undefined} />
          </Slot>
          {csvErrors.length > 0 && (
            <Slot role="alert" className="flex flex-col gap-1.5 px-4 py-3">
              {csvErrors.map((e) => <span key={e.message} className="flex items-center gap-3 text-[14px]"><Led tone="signal" />{e.message}</span>)}
            </Slot>
          )}
          {sealStep && <EncryptProgress step={sealStep} failed={error} wasmHash={evaluator.wasm_hash} onRetry={upload} />}
          {!sealStep && error && <PageError message={error} />}
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
          <StepTitle>{listing.status === "published" ? "Published" : "Publish"}</StepTitle>
          <Slot>
            <CheckRow ok label="Dataset locked to the evaluator" detail={evaluator?.version} />
            <CheckRow ok label="Price" detail={`${price} NEAR per run`} />
            <CheckRow ok label="Limits" detail={`${rules.runs_per_day} per buyer per day · ${rules.lifetime_budget} total`} />
          </Slot>
          {error && <PageError message={error} />}
          <div className="flex flex-wrap justify-end gap-2">
            {listing.status === "published" ? (
              <>
                <LinkBtn variant="outline" href="/sell/runs">See runs</LinkBtn>
                <LinkBtn href={`/listings/${listing.id}`}>Open listing</LinkBtn>
              </>
            ) : (
              <Btn disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Publish"}</Btn>
            )}
          </div>
          {listing.status === "published" && <Link href="/listings" className="text-[14px] font-semibold underline">Back to datasets</Link>}
        </>
      )}
    </div>
  );
}

export default function SellPage() {
  return (
    <SignInGate title="Sign in to sell runs on your data" lead="Your NEAR account receives the payment for every successful run. Selling needs an account the operator has enabled.">
      <SellWizard />
    </SignInGate>
  );
}
