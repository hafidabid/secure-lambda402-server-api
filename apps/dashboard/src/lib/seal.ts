import type { AssetRole, EvaluatorMetadata } from "@securelambda/schemas";
import { api } from "./api";

export type SealStep = "encrypting" | "uploading" | "locking" | "done";

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ponytail: the real path (encryptFile + wrapKey from @securelambda/crypto) lands with the integration; mock mode uploads random bytes, never the file
export async function sealAndUpload(
  file: File,
  listingId: string,
  role: AssetRole,
  evaluator: EvaluatorMetadata,
  account: string,
  onStep: (step: SealStep) => void,
): Promise<string> {
  if (!MOCKING) throw new Error("Browser encryption is not wired yet");

  onStep("encrypting");
  await tick(500);
  const stand_in = new Blob([crypto.getRandomValues(new Uint8Array(Math.min(file.size, 65_536)))]);

  onStep("uploading");
  const { asset_id } = await api.uploadAsset(
    listingId,
    role,
    stand_in,
    {
      v: 1,
      epk: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      nonce: "AAAAAAAAAAAAAAAA",
      ct: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      aad_ctx: { listing: listingId, role, ev: evaluator.version, ct_sha256: "0".repeat(64) },
    },
    account,
  );

  onStep("locking");
  await tick(500);
  onStep("done");
  return asset_id;
}
