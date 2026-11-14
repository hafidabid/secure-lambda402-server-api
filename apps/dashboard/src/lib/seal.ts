import type { AssetRole, Envelope, EvaluatorMetadata } from "@securelambda/schemas";
import { sealFile } from "@securelambda/crypto";

export type SealStep = "encrypting" | "uploading" | "done";

type Upload = (ciphertext: Uint8Array, envelope: Envelope) => Promise<string>;

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function sealAndUpload(
  file: File,
  listingId: string,
  role: AssetRole,
  evaluator: EvaluatorMetadata,
  upload: Upload,
  onStep: (step: SealStep) => void,
): Promise<string> {
  onStep("encrypting");
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const { blob, envelope } = sealFile(plaintext, fromBase64(evaluator.public_key), {
    listing: listingId,
    role,
    ev: evaluator.version,
  });

  onStep("uploading");
  const id = await upload(blob, envelope);

  onStep("done");
  return id;
}
