"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, Play } from "lucide-react";
import { useListing } from "@/lib/queries";
import { useWallet } from "@/lib/wallet";
import { API_URL, ApiRequestError, evaluate } from "@/lib/api";
import { formatNear, userMessage } from "@/lib/format";
import { Badge, Btn, CopyIconButton, Crumb, PageError } from "@/components/ui";

function agentSnippet(listingId: string, modelId: string, account: string) {
  return `import { BuyerAgentClient } from "@securelambda/agent-sdk";

const agent = new BuyerAgentClient({
  baseUrl: "${API_URL}",
  signer: nearSigner("${account}"),
});

const { result, receipt } = await agent.evaluate(
  "${listingId}",
  "${modelId}",
);
// result.metrics → { accuracy, auc, f1 }`;
}

type Phase = "idle" | "authorising" | "starting";

export function BuyRunView() {
  const { listingId } = useParams<{ listingId: string }>();
  const modelId = useSearchParams().get("model") ?? "";
  const router = useRouter();
  const wallet = useWallet();
  const { data: listing } = useListing(listingId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!listing) return <div className="mx-auto h-[400px] max-w-[1100px] animate-pulse px-6 py-8" aria-label="Loading" />;

  if (!modelId) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-6 py-8">
        <PageError message="Add your model first." />
        <Link href={`/buy/${listing.id}/model`} className="text-sm text-seal">Add your model</Link>
      </div>
    );
  }

  const runOnce = async () => {
    if (!wallet.accountId) return;
    setError(null);
    setPhase("authorising");
    try {
      const first = await evaluate(listing.id, modelId, wallet.accountId);
      if (first.kind !== "quote") {
        router.push(`/runs/${first.runId}`);
        return;
      }
      const accept = first.quote.accepts[0];
      if (!accept) throw new ApiRequestError("PAYMENT_INVALID", 402);
      const payment = await wallet.signPayment(accept);
      setPhase("starting");
      const paid = await evaluate(listing.id, modelId, wallet.accountId, payment);
      if (paid.kind === "quote") throw new ApiRequestError("PAYMENT_INVALID", 402);
      router.push(`/runs/${paid.runId}`);
    } catch (e) {
      setPhase("idle");
      setError(userMessage(e instanceof ApiRequestError ? e.code : "NETWORK"));
    }
  };

  const account = wallet.accountId ?? "your-account.testnet";

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-6 py-7">
      <Crumb href={`/listings/${listing.id}`}>{listing.name}</Crumb>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight">Run it</h1>
        <Badge className="bg-ink text-glow"><Lock className="size-3" strokeWidth={2.5} />model {modelId} uploaded</Badge>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-5">
        <section className="flex flex-col gap-[18px] rounded-2xl border border-line bg-surface p-[22px]">
          <span className="text-[15px] font-semibold">Run once from this browser</span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[40px] font-semibold tracking-tight">{formatNear(listing.price_amount)}</span>
            <span className="font-mono text-[15px] text-muted">{listing.price_asset.toUpperCase()}</span>
          </div>
          <div className="flex justify-between border-y border-surface-2 py-2.5 text-[13px]">
            <span className="text-muted">Network</span>
            <span className="font-mono">near:testnet</span>
          </div>

          {error && <PageError message={error} />}

          {wallet.status !== "connected" ? (
            <Btn onClick={() => wallet.connect()} className="h-12 text-[15px]">Connect wallet</Btn>
          ) : (
            <Btn variant="seal" onClick={runOnce} disabled={phase !== "idle"} className="h-12 text-[15px]">
              {phase === "idle" ? <Play /> : <Loader2 className="animate-spin" />}
              {phase === "idle" && "Run once"}
              {phase === "authorising" && "Authorising…"}
              {phase === "starting" && "Starting run…"}
            </Btn>
          )}
          <span className="text-center text-[13px] text-muted">Payment is taken only after a successful run.</span>
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">Or let your agent pay</span>
            <CopyIconButton content={agentSnippet(listing.id, modelId, account)} label="Copy agent snippet" />
          </div>
          <pre className="m-0 overflow-x-auto rounded-xl bg-code px-5 py-[18px] font-mono text-[12.5px] leading-[1.75] text-code-text">
            {agentSnippet(listing.id, modelId, account)}
          </pre>
          <span className="font-mono text-xs text-muted">402 → sign → retry → poll, handled for you</span>
        </section>
      </div>
    </div>
  );
}
