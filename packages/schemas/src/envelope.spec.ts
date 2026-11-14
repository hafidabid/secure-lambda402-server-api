import { Base64Schema, buildAad, EnvelopeSchema } from "./envelope";

describe("Base64Schema (CR-17)", () => {
  it("accepts standard padded base64", () => {
    expect(Base64Schema.safeParse(Buffer.from("hello world").toString("base64")).success).toBe(true);
  });

  it("rejects URL-safe characters (- and _)", () => {
    expect(Base64Schema.safeParse("abc-def_123").success).toBe(false);
  });

  it("rejects a length not a multiple of 4", () => {
    expect(Base64Schema.safeParse("abcde").success).toBe(false);
  });
});

describe("buildAad", () => {
  it("joins the AAD domain and context deterministically", () => {
    const aad = buildAad({ listing: "lst_1", role: "dataset", ev: "1.0.0", ct_sha256: "a".repeat(64) });
    expect(new TextDecoder().decode(aad)).toBe(`securelambda/v1||lst_1||dataset||1.0.0||${"a".repeat(64)}`);
  });

  it("produces a different AAD for a different listing (CR-04 depends on this)", () => {
    const a = buildAad({ listing: "lst_1", role: "dataset", ev: "1.0.0", ct_sha256: "a".repeat(64) });
    const b = buildAad({ listing: "lst_2", role: "dataset", ev: "1.0.0", ct_sha256: "a".repeat(64) });
    expect(a).not.toEqual(b);
  });
});

describe("EnvelopeSchema", () => {
  it("accepts a well-formed envelope", () => {
    const envelope = {
      v: 1,
      epk: Buffer.alloc(32, 1).toString("base64"),
      nonce: Buffer.alloc(12, 2).toString("base64"),
      ct: Buffer.alloc(48, 3).toString("base64"),
      aad_ctx: { listing: "lst_1", role: "dataset" as const, ev: "1.0.0", ct_sha256: "a".repeat(64) },
    };
    expect(EnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("CR-11: rejects an envelope version other than 1", () => {
    const envelope = {
      v: 2,
      epk: Buffer.alloc(32).toString("base64"),
      nonce: Buffer.alloc(12).toString("base64"),
      ct: Buffer.alloc(48).toString("base64"),
      aad_ctx: { listing: "lst_1", role: "dataset" as const, ev: "1.0.0", ct_sha256: "a".repeat(64) },
    };
    expect(EnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
