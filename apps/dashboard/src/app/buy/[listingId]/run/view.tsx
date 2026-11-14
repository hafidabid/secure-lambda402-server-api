"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2, Play } from "lucide-react";
import { useListing } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { useHydrated } from "@/lib/hydrated";
import { API_URL, evaluate } from "@/lib/api";
import { errorMessage, formatNear } from "@/lib/format";
import { Btn, CopyIconButton, Crumb, Display, Engraved, Led, Page, PageError, PageTitle, Panel, Skeleton, Slot } from "@/components/ui";
import { SignedInAction } from "@/components/gate";

function agentSnippet(listingId: string, modelId: string, account: string) {
  return `import { BuyerAgentClient, createNearLogin, createNearPaymentSigner } from "@securelambda/agent-sdk";

const baseUrl = "${API_URL}";
const accountId = "${account}";
const privateKey = process.env.NEAR_PRIVATE_KEY!;

const agent = new BuyerAgentClient({
  baseUrl,
  headers: createNearLogin({ baseUrl, accountId, privateKey }),
  signer: createNearPaymentSigner({ accountId, privateKey, autoWrapNear: true }),
});

const { result, receipt } = await agent.evaluate("${listingId}", "${modelId}");
// result.metrics: { accuracy, auc, f1 }`;
}

type Phase = "idle" | "quoting" | "signing" | "starting";

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  quoting: "Getting the price…",
  signing: "Signing the payment…",
  starting: "Starting the run…",
};

function PaymentKeyRow() {
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Slot className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <Led tone={session.paymentKey === "ready" ? "ok" : "off"} />
        <span className="flex-1 text-[14px] font-medium">
          {session.paymentKey === "ready" ? "Browser payments on" : "Browser payments off"}
        </span>
        {session.paymentKey === "none" && (
          <Btn variant="outline" className="h-9 px-4 text-[14px]" onClick={() => void act(session.enablePayments)}>
            <KeyRound />
            Turn on
          </Btn>
        )}
        {session.paymentKey === "ready" && (
          <Btn variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => void act(session.removePaymentKey)}>
            Turn off
          </Btn>
        )}
        {(session.paymentKey === "adding" || session.paymentKey === "removing") && (
          <span className="flex items-center gap-2 text-[13px] text-etch-3"><Loader2 className="size-4 animate-spin" />Waiting for your wallet</span>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-etch-3">
        Your wallet approves one transaction that lets this tab sign run payments for you. That permission lives only in this
        tab and is forgotten when you close it. Turn it off to revoke it on your account.
      </p>
      {error && <span className="text-[13px] text-etch-2">{error}</span>}
    </Slot>
  );
}

export function BuyRunView() {
  const { listingId } = useParams<{ listingId: string }>();
  const modelId = useSearchParams().get("model") ?? "";
  const router = useRouter();
  const session = useSession();
  const hydrated = useHydrated();
  const { data: listing, error: listingError } = useListing(listingId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  if (listingError) return <Page><PageError message={errorMessage(listingError)} /></Page>;
  if (!listing) return <Page><Skeleton className="h-[420px]" /></Page>;

  if (!modelId) {
    return (
      <Page>
        <PageError message="Add your model first." action={<Link href={`/buy/${listing.id}/model`} className="text-[14px] font-semibold underline">Add your model</Link>} />
      </Page>
    );
  }

  const runOnce = async () => {
    if (!session.token) return;
    setError(null);
    setPhase("quoting");
    try {
      const first = await evaluate(listing.id, modelId, session.token);
      if (first.kind !== "quote") {
        router.push(`/runs/${first.runId}`);
        return;
      }
      const accept = first.quote.accepts[0];
      if (!accept) throw new Error("The server sent no price quote.");
      setPhase("signing");
      const payment = await session.signPayment(accept);
      setPhase("starting");
      const paid = await evaluate(listing.id, modelId, session.token, payment);
      if (paid.kind === "quote") throw new Error("The payment was not accepted. You were not charged.");
      router.push(`/runs/${paid.runId}`);
    } catch (e) {
      setPhase("idle");
      setError(errorMessage(e));
    }
  };

  const account = (hydrated && session.accountId) || "your-account.testnet";

  return (
    <Page>
      <Crumb href={`/listings/${listing.id}`}>{listing.name}</Crumb>
      <PageTitle
        aside={
          <span className="inline-flex h-8 items-center gap-2 rounded-full bg-slot px-3 text-[13px] shadow-[inset_0_1px_3px_rgba(40,36,28,0.16)]">
            <Led tone="ok" />
            Model {modelId} locked to the evaluator
          </span>
        }
      >
        Run it
      </PageTitle>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel className="flex flex-col gap-4">
          <Engraved>Run once from this browser</Engraved>
          <Display className="flex items-baseline justify-between gap-3 px-5 py-4">
            <span className="font-readout text-[40px] font-semibold leading-none">{formatNear(listing.price_amount)}</span>
            <span className="font-readout text-[14px] text-display-dim">wNEAR · near:testnet</span>
          </Display>

          <SignedInAction className="h-12 w-full">
            <PaymentKeyRow />
            {error && <PageError message={error} />}
            <Btn onClick={runOnce} disabled={phase !== "idle" || session.paymentKey !== "ready"} className="h-12 w-full">
              {phase === "idle" ? <Play /> : <Loader2 className="animate-spin" />}
              {phase === "idle" ? "Run once" : PHASE_LABEL[phase]}
            </Btn>
          </SignedInAction>
          <span className="text-center text-[13px] text-etch-3">You pay only when a score is delivered. Failed runs are free.</span>
        </Panel>

        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <Engraved>Or let your agent pay</Engraved>
            <CopyIconButton content={agentSnippet(listing.id, modelId, account)} label="Copy agent snippet" />
          </div>
          <Display className="overflow-x-auto px-5 py-4">
            <pre className="m-0 font-readout text-[12.5px] leading-[1.75]">{agentSnippet(listing.id, modelId, account)}</pre>
          </Display>
          <span className="px-1 text-[13px] text-etch-3">The SDK handles the price quote, signing, retry and polling.</span>
        </section>
      </div>
    </Page>
  );
}
