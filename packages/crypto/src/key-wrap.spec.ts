import type { EnvelopeAadContext } from "@securelambda/schemas";
import { encryptFile } from "./file-cipher";
import { EnvelopeError, generateEvaluatorKeypair, unwrapKey, wrapKey } from "./key-wrap";
import { sha256Hex } from "./envelope-flow";

const ctx = (overrides: Partial<EnvelopeAadContext> = {}): EnvelopeAadContext => ({
  listing: "lst_01H",
  role: "dataset",
  ev: "1.0.0",
  ct_sha256: "a".repeat(64),
  ...overrides,
});

describe("wrapKey / unwrapKey", () => {
  it("CR-01 (wrap variant): round-trips K_file through wrap/unwrap with the matching context", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const { kFile, blob } = encryptFile(Buffer.from("dataset bytes"));
    const context = ctx({ ct_sha256: sha256Hex(blob) });
    const envelope = wrapKey(kFile, publicKey, context);
    expect(unwrapKey(envelope, privateKey, context)).toEqual(kFile);
  });

  it("CR-04: unwrapping with a different listing id in the expected context fails", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const kFile = Buffer.alloc(32, 9);
    const envelope = wrapKey(kFile, publicKey, ctx({ listing: "lst_A" }));
    expect(() => unwrapKey(envelope, privateKey, ctx({ listing: "lst_B" }))).toThrow(EnvelopeError);
  });

  it("CR-05: unwrapping a dataset envelope while expecting role model fails", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const kFile = Buffer.alloc(32, 9);
    const envelope = wrapKey(kFile, publicKey, ctx({ role: "dataset" }));
    expect(() => unwrapKey(envelope, privateKey, ctx({ role: "model" }))).toThrow(EnvelopeError);
  });

  it("CR-06: unwrapping with a different evaluator version fails", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const kFile = Buffer.alloc(32, 9);
    const envelope = wrapKey(kFile, publicKey, ctx({ ev: "1.0.0" }));
    expect(() => unwrapKey(envelope, privateKey, ctx({ ev: "1.0.1" }))).toThrow(EnvelopeError);
  });

  it("CR-08: flipping one bit in the wrapped key ciphertext fails", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const kFile = Buffer.alloc(32, 9);
    const envelope = wrapKey(kFile, publicKey, ctx());
    const tampered = Buffer.from(envelope.ct, "base64");
    tampered[0] = tampered[0]! ^ 0x01;
    const tamperedEnvelope = { ...envelope, ct: tampered.toString("base64") };
    expect(() => unwrapKey(tamperedEnvelope, privateKey, ctx())).toThrow(EnvelopeError);
  });

  it("CR-09: unwrapping with the wrong private key fails", () => {
    const { publicKey } = generateEvaluatorKeypair();
    const wrongKeypair = generateEvaluatorKeypair();
    const kFile = Buffer.alloc(32, 9);
    const envelope = wrapKey(kFile, publicKey, ctx());
    expect(() => unwrapKey(envelope, wrongKeypair.privateKey, ctx())).toThrow(EnvelopeError);
  });

  it("CR-11: rejects an envelope whose version is not 1", () => {
    const { publicKey, privateKey } = generateEvaluatorKeypair();
    const kFile = Buffer.alloc(32, 9);
    const envelope = wrapKey(kFile, publicKey, ctx());
    const badEnvelope = { ...envelope, v: 2 } as unknown as typeof envelope;
    expect(() => unwrapKey(badEnvelope, privateKey, ctx())).toThrow(/unsupported envelope version/);
  });

  it("CR-16: rejects a low-order (all-zero) ephemeral public key", () => {
    const { privateKey } = generateEvaluatorKeypair();
    const kFile = Buffer.alloc(32, 9);
    const lowOrderEpk = Buffer.alloc(32, 0).toString("base64");
    const envelope = {
      v: 1 as const,
      epk: lowOrderEpk,
      nonce: Buffer.alloc(12, 1).toString("base64"),
      ct: Buffer.alloc(48, 2).toString("base64"),
      aad_ctx: ctx(),
    };
    expect(() => unwrapKey(envelope, privateKey, ctx())).toThrow(/low-order/);
  });

  it("rejects an evaluator public key of the wrong length when wrapping", () => {
    const kFile = Buffer.alloc(32, 9);
    expect(() => wrapKey(kFile, Buffer.alloc(16), ctx())).toThrow(EnvelopeError);
  });
});
