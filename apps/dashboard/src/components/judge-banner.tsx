import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Led, Slot, cn } from "./ui";

export function JudgeBanner({ className }: { className?: string }) {
  return (
    <Slot className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-[15px]", className)}>
      <Led tone="signal" />
      <span className="min-w-[16ch] flex-1">
        <strong className="font-semibold">Trying SecureLambda for the first time?</strong> The 5-minute guide covers a testnet
        wallet and a ready-made model for every dataset.
      </span>
      <Link href="/docs#test-it-in-5-minutes" className="inline-flex h-11 items-center gap-1 font-semibold underline">
        Open the guide
        <ArrowRight className="size-3.5" />
      </Link>
      <a href="/samples/models/diabetes-model.json" download className="inline-flex h-11 items-center underline">
        Sample model
      </a>
    </Slot>
  );
}
