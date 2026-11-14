"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { parseModelJsonSafe, validateModelJson, type ModelJson } from "@securelambda/schemas";
import { useEvaluator, useListing } from "@/lib/queries";
import { localScore } from "@/lib/csv";
import { sealAndUpload, type SealStep } from "@/lib/seal";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { CheckRow, CopyIconButton, Crumb, Display, Engraved, Led, Page, PageTitle, Skeleton, Slot, Btn } from "@/components/ui";
import { SampleRows } from "@/components/listing";
import { EncryptProgress, FileDrop, type DropState } from "@/components/seal";
import { SignedInAction } from "@/components/gate";

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
    "field" in e && e.field === "features" ? `Feature names do not match. Expected ${featureNames.join(", ")}` : e.message,
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
  const { token } = useSession();
  const { data: listing } = useListing(listingId);
  const { data: evaluator } = useEvaluator();

  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [step, setStep] = useState<SealStep | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  if (!listing) return <Page><Skeleton className="h-[420px]" /></Page>;

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
    if (!file || !evaluator || !token) return;
    setFailed(null);
    try {
      const modelId = await sealAndUpload(
        file,
        listing.id,
        "model",
        evaluator,
        async (ciphertext, envelope) => (await api.uploadModel(listing.id, ciphertext, envelope, token)).model_id,
        setStep,
      );
      router.push(`/buy/${listing.id}/run?model=${modelId}`);
    } catch (e) {
      setFailed(errorMessage(e));
    }
  };

  const dropMeta = checked?.model
    ? `Logistic regression · ${checked.model.weights.length} weights · read on this device only`
    : "Logistic regression as JSON. Export it with the snippet.";

  return (
    <Page>
      <Crumb href={`/listings/${listing.id}`}>{listing.name}</Crumb>
      <PageTitle>Add your model</PageTitle>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <FileDrop accept=".json,application/json" file={file} state={dropState(checked, valid)} meta={dropMeta} placeholder="Drop model.json or choose a file" onFile={onFile} />

          {checked && checked.errors.length > 0 && (
            <Slot role="alert" className="flex flex-col gap-1.5 px-4 py-3">
              {checked.errors.map((e) => (
                <span key={e} className="flex items-center gap-3 text-[14px]"><Led tone="signal" />{e}</span>
              ))}
            </Slot>
          )}

          {valid && checked.model && (
            <>
              <Slot>
                <CheckRow ok label="Features in schema order" detail={featureNames.join(", ")} />
                <CheckRow ok label="Weights and bias are finite" detail={`max |w| ${Math.max(...checked.model.weights.map(Math.abs)).toFixed(2)}`} />
              </Slot>
              <SampleRows
                schema={listing.schema}
                rows={listing.sample_rows}
                extra={{
                  header: ["p", "pred"],
                  cells: (i) => {
                    const p = predictions?.[i];
                    if (!p) return ["", ""];
                    return [p.probability.toFixed(2), <span key="p" className="inline-flex items-center gap-2">{p.predicted}<Led tone={p.predicted === p.actual ? "ok" : "signal"} /></span>];
                  },
                }}
              />
              <span className="text-[13px] text-etch-3">{correct} of {predictions?.length} sample rows correct. Checked on this device only.</span>
            </>
          )}

          {step && evaluator && <EncryptProgress step={step} failed={failed} wasmHash={evaluator.wasm_hash} onRetry={upload} />}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {!evaluatorOk && <span className="text-[14px] text-etch-2">The evaluator does not match this listing. Uploads are off.</span>}
            <SignedInAction className="h-12 px-6">
              <Btn onClick={upload} disabled={!valid || !evaluatorOk || (step !== null && !failed)} className="h-12 px-6">
                Encrypt and upload
              </Btn>
            </SignedInAction>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <Engraved>Export from scikit-learn</Engraved>
            <CopyIconButton content={exportSnippet(featureNames)} label="Copy export snippet" />
          </div>
          <Display className="overflow-x-auto px-5 py-4">
            <pre className="m-0 font-readout text-[12.5px] leading-[1.75]">{exportSnippet(featureNames)}</pre>
          </Display>
        </div>
      </div>
    </Page>
  );
}
