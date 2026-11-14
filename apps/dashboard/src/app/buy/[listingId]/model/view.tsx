"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { parseModelJsonSafe, validateModelJson, type ModelJson } from "@securelambda/schemas";
import { useEvaluator, useListing } from "@/lib/queries";
import { localScore } from "@/lib/csv";
import { sealAndUpload, type SealStep } from "@/lib/seal";
import { useWallet } from "@/lib/wallet";
import { ApiRequestError } from "@/lib/api";
import { userMessage } from "@/lib/format";
import { Btn, CheckRow, CopyIconButton, Crumb } from "@/components/ui";
import { SampleRows } from "@/components/listing";
import { EncryptProgress, FileDrop, type DropState } from "@/components/seal";

function exportSnippet(features: string[]) {
  return `import json

features = [${features.map((f) => `"${f}"`).join(", ")}]
json.dump({
  "features": features,
  "weights": clf.coef_[0].tolist(),
  "bias": float(clf.intercept_[0]),
}, open("model.json", "w"))`;
}

type Checked = { model: ModelJson; errors: string[] } | { model: null; errors: string[] };

function check(raw: string, featureNames: string[], schema: Parameters<typeof validateModelJson>[1]): Checked {
  let model: ModelJson;
  try {
    model = parseModelJsonSafe(raw);
  } catch {
    return { model: null, errors: ["Not a model file. Expected { features, weights, bias }."] };
  }
  const errors = validateModelJson(model, schema).map((e) =>
    "field" in e && e.field === "features" ? `Feature names do not match: expected ${featureNames.join(", ")}` : e.message,
  );
  return { model, errors };
}

function dropState(checked: Checked | null, valid: boolean): DropState {
  if (!checked) return "idle";
  return valid ? "valid" : "invalid";
}

export function BuyModelView() {
  const { listingId } = useParams<{ listingId: string }>();
  const router = useRouter();
  const wallet = useWallet();
  const { data: listing } = useListing(listingId);
  const { data: evaluator } = useEvaluator();

  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [step, setStep] = useState<SealStep | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  if (!listing) return <div className="mx-auto h-[400px] max-w-[1200px] animate-pulse px-6 py-8" aria-label="Loading" />;

  const featureNames = listing.schema.features.map((f) => f.name);
  const valid = !!checked?.model && checked.errors.length === 0;
  const predictions = valid && checked.model ? localScore(checked.model, listing.sample_rows, listing.schema.label) : null;
  const correct = predictions?.filter((p) => p.predicted === p.actual).length ?? 0;
  const evaluatorOk = evaluator?.version === listing.evaluator_version;

  const onFile = async (f: File) => {
    setFile(f);
    setStep(null);
    setFailed(null);
    setChecked(check(await f.text(), featureNames, listing.schema));
  };

  const upload = async () => {
    if (!file || !evaluator || !wallet.accountId) return;
    setFailed(null);
    try {
      const assetId = await sealAndUpload(file, listing.id, "model", evaluator, wallet.accountId, setStep);
      router.push(`/buy/${listing.id}/run?model=${assetId}`);
    } catch (e) {
      setFailed(e instanceof ApiRequestError ? userMessage(e.code) : "Upload failed. Nothing was saved. Retry.");
    }
  };

  const dropMeta = checked?.model
    ? `logistic · ${checked.model.weights.length} weights · read on this device`
    : "logistic regression JSON, exported below";

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-6 py-7">
      <Crumb href={`/listings/${listing.id}`}>{listing.name}</Crumb>
      <h1 className="text-[26px] font-semibold tracking-tight">Add your model</h1>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <FileDrop
            accept=".json,application/json"
            file={file}
            state={dropState(checked, valid)}
            meta={dropMeta}
            placeholder="Drop model.json"
            onFile={onFile}
          />

          {checked && checked.errors.length > 0 && (
            <div role="alert" className="flex flex-col gap-1 rounded-xl border border-[#F5C2BC] bg-danger-soft px-4 py-3">
              {checked.errors.map((e) => (
                <span key={e} className="font-mono text-xs text-danger-ink">{e}</span>
              ))}
            </div>
          )}

          {valid && checked.model && (
            <>
              <div className="rounded-[14px] border border-line bg-surface px-[18px] py-1">
                <CheckRow ok label="Features in schema order" detail={featureNames.join(", ")} />
                <CheckRow ok label="Weights and bias finite" detail={`max |w| ${Math.max(...checked.model.weights.map(Math.abs)).toFixed(2)}`} />
              </div>
              <SampleRows
                schema={listing.schema}
                rows={listing.sample_rows}
                extra={{
                  header: ["p", "pred"],
                  cells: (i) => {
                    const p = predictions?.[i];
                    if (!p) return ["", ""];
                    const icon = p.predicted === p.actual ? <Check className="inline size-3 text-seal" /> : <X className="inline size-3 text-danger" />;
                    return [p.probability.toFixed(2), <span key="p">{p.predicted} {icon}</span>];
                  },
                }}
              />
              <span className="font-mono text-xs text-muted">{correct} / {predictions?.length} correct on sample rows · local only</span>
            </>
          )}

          {step && evaluator && <EncryptProgress step={step} failed={failed} wasmHash={evaluator.wasm_hash} onRetry={upload} />}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {!evaluatorOk && <span className="text-[13px] text-danger">Evaluator does not match this listing.</span>}
            {wallet.status !== "connected" ? (
              <Btn onClick={() => wallet.connect()} disabled={!valid} className="h-11 text-[15px]">Connect wallet to continue</Btn>
            ) : (
              <Btn onClick={upload} disabled={!valid || !evaluatorOk || (step !== null && !failed)} className="h-11 text-[15px]">
                Encrypt and upload
              </Btn>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">Export from scikit-learn</span>
            <CopyIconButton content={exportSnippet(featureNames)} label="Copy export snippet" />
          </div>
          <pre className="m-0 overflow-x-auto rounded-xl bg-code px-5 py-[18px] font-mono text-[12.5px] leading-[1.75] text-code-text">{exportSnippet(featureNames)}</pre>
        </div>
      </div>
    </div>
  );
}
