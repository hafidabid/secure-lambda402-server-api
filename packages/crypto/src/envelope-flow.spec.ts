import { Base64Schema } from "@securelambda/schemas";
import { generateEvaluatorKeypair } from "./key-wrap";
import { openFile, sealFile } from "./envelope-flow";

describe("sealFile / openFile", () => {
  it("round-trips a 1 MB dataset end to end through the full envelope flow", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const plaintext = Buffer.alloc(1024 * 1024, 0x5a);
    const ctx = { listing: "lst_01H", role: "dataset" as const, ev: "1.0.0" };

    const { blob, envelope } = sealFile(plaintext, publicKey, ctx);
    expect(openFile(blob, envelope, privateKey, ctx)).toEqual(plaintext);
  });

  it("SC-04 / CR-04: a wrapped key sealed for one listing cannot be opened under another", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const plaintext = Buffer.from("model.json contents");
    const { blob, envelope } = sealFile(plaintext, publicKey, { listing: "lst_A", role: "model", ev: "1.0.0" });

    expect(() => openFile(blob, envelope, privateKey, { listing: "lst_B", role: "model", ev: "1.0.0" })).toThrow();
  });
});

describe("Base64Schema on envelope fields (CR-17)", () => {
  it("rejects URL-safe base64 (- and _) as non-canonical", () => {
    expect(Base64Schema.safeParse("abc-123_456=").success).toBe(false);
  });

  it("rejects base64 missing required padding", () => {
    // 5 chars is not a multiple of 4 and cannot be validly padded.
    expect(Base64Schema.safeParse("abcde").success).toBe(false);
  });

  it("accepts standard padded base64 of the same byte length", () => {
    expect(Base64Schema.safeParse(Buffer.alloc(32).toString("base64")).success).toBe(true);
  });
});
