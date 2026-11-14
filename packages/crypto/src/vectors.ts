/**
 * Generates cross-language crypto test vectors (docs/03 B7, I1 seam in
 * docs/05 section 7.1). Run via `npm run vectors:generate` at the repo
 * root. The Rust evaluator crate's `tests/vectors.rs` reads the output file
 * and must unwrap + decrypt every vector to the recorded plaintext.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EnvelopeAadContext } from "@securelambda/schemas";
import { encryptFile } from "./file-cipher";
import { generateEvaluatorKeypair, wrapKey } from "./key-wrap";
import { sha256Hex } from "./envelope-flow";

interface Vector {
  description: string;
  evaluator_private_key_hex: string;
  evaluator_public_key_hex: string;
  ctx: EnvelopeAadContext;
  k_file_hex: string;
  envelope: ReturnType<typeof wrapKey>;
  file_blob_hex: string;
  plaintext_hex: string;
}

function buildVector(description: string, plaintext: Buffer, ctx: Omit<EnvelopeAadContext, "ct_sha256">): Vector {
  const { publicKey, privateKey } = generateEvaluatorKeypair();
  const { blob, kFile } = encryptFile(plaintext);
  const fullCtx: EnvelopeAadContext = { ...ctx, ct_sha256: sha256Hex(blob) };
  const envelope = wrapKey(kFile, publicKey, fullCtx);
  return {
    description,
    evaluator_private_key_hex: privateKey.toString("hex"),
    evaluator_public_key_hex: publicKey.toString("hex"),
    ctx: fullCtx,
    k_file_hex: kFile.toString("hex"),
    envelope,
    file_blob_hex: blob.toString("hex"),
    plaintext_hex: plaintext.toString("hex"),
  };
}

export function generateVectors(): Vector[] {
  return [
    buildVector("tiny dataset, 16 bytes", Buffer.from("0123456789abcdef"), {
      listing: "lst_01HVECTOR0001",
      role: "dataset",
      ev: "1.0.0",
    }),
    buildVector("small model.json payload", Buffer.from(JSON.stringify({ features: ["age"], weights: [0.5], bias: 0.1 })), {
      listing: "lst_01HVECTOR0001",
      role: "model",
      ev: "1.0.0",
    }),
    buildVector("1 KB dataset", Buffer.alloc(1024, 0x41), {
      listing: "lst_01HVECTOR0002",
      role: "dataset",
      ev: "1.0.0",
    }),
  ];
}

function main(): void {
  const vectors = generateVectors();
  const outDir = join(__dirname, "..", "..", "..", "crates", "evaluator", "tests");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "vectors.json");
  writeFileSync(outFile, JSON.stringify(vectors, null, 2) + "\n");
  // eslint-disable-next-line no-console
  console.log(`wrote ${vectors.length} vectors to ${outFile}`);
}

if (require.main === module) {
  main();
}
