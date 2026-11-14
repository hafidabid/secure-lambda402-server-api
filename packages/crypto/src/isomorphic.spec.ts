import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EnvelopeAadContextSchema, EnvelopeSchema } from "@securelambda/schemas";
import { generateEvaluatorKeypair } from "./key-wrap";
import { openFile, sealFile } from "./envelope-flow";

const VectorsSchema = z.array(
  z.object({
    evaluator_private_key_hex: z.string(),
    ctx: EnvelopeAadContextSchema,
    envelope: EnvelopeSchema,
    file_blob_hex: z.string(),
    plaintext_hex: z.string(),
  }),
);

const vectors = VectorsSchema.parse(
  JSON.parse(readFileSync(join(__dirname, "../../../crates/evaluator/tests/vectors.json"), "utf8")),
);

describe("browser compatibility", () => {
  it("seals without a global Buffer, as in a browser", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const plaintext = new TextEncoder().encode("age,glucose,y\n45,98.2,0\n");
    const ctx = { listing: "lst_1", role: "dataset" as const, ev: "1.0.0" };

    const saved = globalThis.Buffer;
    let sealed: ReturnType<typeof sealFile>;
    try {
      // @ts-expect-error simulating a browser global scope
      delete globalThis.Buffer;
      sealed = sealFile(plaintext, publicKey, ctx);
    } finally {
      globalThis.Buffer = saved;
    }

    expect(Buffer.from(openFile(sealed.blob, sealed.envelope, privateKey, ctx))).toEqual(Buffer.from(plaintext));
  });

  it.each(vectors.map((v, i) => [i, v] as const))("opens committed cross-language vector %i", (_, v) => {
    const { listing, role, ev } = v.ctx;
    const opened = openFile(
      Buffer.from(v.file_blob_hex, "hex"),
      v.envelope,
      Buffer.from(v.evaluator_private_key_hex, "hex"),
      { listing, role, ev },
    );
    expect(Buffer.from(opened).toString("hex")).toBe(v.plaintext_hex);
  });
});
