import { ReceiptSchema } from "@securelambda/schemas";
import { loadReceipt, type ReceiptSource } from "./receipt";

const PINNED = "a".repeat(64);

type Row<K extends keyof ReceiptSource> = Awaited<ReturnType<ReceiptSource[K]["findUnique"]>>;

function fakePrisma(opts: { attestation?: Row<"attestation">; payment?: Row<"payment">; listing?: Row<"listing"> }): ReceiptSource {
  return {
    attestation: { findUnique: async () => opts.attestation ?? null },
    payment: { findUnique: async () => opts.payment ?? null },
    listing: { findUnique: async () => opts.listing ?? null },
  };
}

const run = (mode: "enclave" | "local") => ({ id: "run_1", listingId: "lst_1", mode, execTxHash: "tx_exec" });

describe("loadReceipt", () => {
  it("carries the listing's pinned wasm hash next to the executed one", async () => {
    const prisma = fakePrisma({
      attestation: { wasmHash: PINNED, verified: true },
      payment: { settleTxHash: "tx_settle" },
      listing: { evaluator: { wasmHash: PINNED } },
    });

    const receipt = await loadReceipt(prisma, run("enclave"));

    expect(receipt).toEqual({ exec_tx: "tx_exec", settle_tx: "tx_settle", wasm_hash: PINNED, pinned_wasm_hash: PINNED, attested: true });
    expect(ReceiptSchema.parse(receipt)).toEqual(receipt);
  });

  it("never reports a local run as attested", async () => {
    const prisma = fakePrisma({ attestation: { wasmHash: PINNED, verified: true }, listing: { evaluator: { wasmHash: PINNED } } });

    expect((await loadReceipt(prisma, run("local"))).attested).toBe(false);
  });

  it("defaults while the run is still in progress", async () => {
    const prisma = fakePrisma({ listing: { evaluator: { wasmHash: PINNED } } });

    expect(await loadReceipt(prisma, { ...run("enclave"), execTxHash: null })).toEqual({
      exec_tx: "",
      settle_tx: null,
      wasm_hash: "",
      pinned_wasm_hash: PINNED,
      attested: false,
    });
  });
});
