import type { Receipt } from "@securelambda/schemas";

export interface ReceiptSource {
  attestation: { findUnique(args: { where: { runId: string } }): Promise<{ wasmHash: string; verified: boolean } | null> };
  payment: { findUnique(args: { where: { runId: string } }): Promise<{ settleTxHash: string | null } | null> };
  listing: {
    findUnique(args: {
      where: { id: string };
      select: { evaluator: { select: { wasmHash: true } } };
    }): Promise<{ evaluator: { wasmHash: string } } | null>;
  };
}

export async function loadReceipt(
  prisma: ReceiptSource,
  run: { id: string; listingId: string; mode: string; execTxHash: string | null },
): Promise<Receipt> {
  const [attestation, payment, listing] = await Promise.all([
    prisma.attestation.findUnique({ where: { runId: run.id } }),
    prisma.payment.findUnique({ where: { runId: run.id } }),
    prisma.listing.findUnique({ where: { id: run.listingId }, select: { evaluator: { select: { wasmHash: true } } } }),
  ]);
  return {
    exec_tx: run.execTxHash ?? "",
    settle_tx: payment?.settleTxHash ?? null,
    wasm_hash: attestation?.wasmHash ?? "",
    pinned_wasm_hash: listing?.evaluator.wasmHash,
    // Only a verified TEE run counts. A "local" run matched the wasm hash but never ran in an enclave.
    attested: run.mode === "enclave" && (attestation?.verified ?? false),
  };
}
