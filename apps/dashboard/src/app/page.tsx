import Link from "next/link";
import { ArrowRight, Database, Network } from "lucide-react";

export default function RolePage() {
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-10 px-6 py-16 md:py-20">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight md:text-[44px]">Data to sell, or a model to test?</h1>
        <p className="text-base text-ink-2">Neither side sees the other&apos;s file. Only metrics leave the enclave.</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
        <Link href="/start?role=seller" className="flex min-h-[300px] flex-col gap-5 rounded-[18px] bg-ink p-7 text-white">
          <span className="flex size-11 items-center justify-center rounded-[10px] bg-code"><Database className="size-5 text-glow" /></span>
          <span className="flex flex-col gap-1.5">
            <span className="text-2xl font-semibold tracking-tight">I have data</span>
            <span className="text-[15px] text-code-dim">Earn per run. Rows stay sealed.</span>
          </span>
          <span className="font-mono text-xs leading-relaxed text-code-dim">CSV → 5 synthetic rows → price → encrypt → publish</span>
          <span className="mt-auto inline-flex items-center gap-2 font-medium text-glow">Start selling<ArrowRight className="size-4" /></span>
        </Link>

        <Link href="/start?role=buyer" className="flex min-h-[300px] flex-col gap-5 rounded-[18px] border border-line bg-surface p-7">
          <span className="flex size-11 items-center justify-center rounded-[10px] bg-surface-2"><Network className="size-5" /></span>
          <span className="flex flex-col gap-1.5">
            <span className="text-2xl font-semibold tracking-tight">I have a model</span>
            <span className="text-[15px] text-muted">Score it on data you never see.</span>
          </span>
          <span className="font-mono text-xs leading-relaxed text-muted">listing → model.json → test locally → encrypt → run</span>
          <span className="mt-auto inline-flex items-center gap-2 font-medium">Browse datasets<ArrowRight className="size-4" /></span>
        </Link>
      </div>
    </div>
  );
}
