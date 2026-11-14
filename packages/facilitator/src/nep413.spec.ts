import { randomBytes } from "node:crypto";
import { NEP413_TAG, nep413Hash, signNep413, verifyNep413 } from "./nep413";
import { randomNearPrivateKey } from "./near-delegate";

describe("NEP-413", () => {
  const payload = { message: "hello", nonce: randomBytes(32), recipient: "app.example" };

  it("uses the 2^31 + 413 tag", () => {
    expect(NEP413_TAG).toBe(2 ** 31 + 413);
  });

  it("signs and verifies", () => {
    const key = randomNearPrivateKey();
    const { publicKey, signature } = signNep413(key, payload);
    expect(verifyNep413(publicKey, signature, payload)).toBe(true);
  });

  it.each([
    ["message", { ...payload, message: "hellp" }],
    ["recipient", { ...payload, recipient: "evil.example" }],
    ["nonce", { ...payload, nonce: randomBytes(32) }],
    ["callbackUrl", { ...payload, callbackUrl: "https://evil.example" }],
  ])("rejects a changed %s", (_name, changed) => {
    const { publicKey, signature } = signNep413(randomNearPrivateKey(), payload);
    expect(verifyNep413(publicKey, signature, changed)).toBe(false);
  });

  it("rejects another key's signature, and garbage", () => {
    const a = signNep413(randomNearPrivateKey(), payload);
    const b = signNep413(randomNearPrivateKey(), payload);
    expect(verifyNep413(a.publicKey, b.signature, payload)).toBe(false);
    expect(verifyNep413(a.publicKey, "AAAA", payload)).toBe(false);
    expect(verifyNep413("not-a-key", a.signature, payload)).toBe(false);
  });

  it("is deterministic, and rejects a nonce that is not 32 bytes", () => {
    expect(nep413Hash(payload).equals(nep413Hash(payload))).toBe(true);
    expect(() => nep413Hash({ ...payload, nonce: Buffer.alloc(8) })).toThrow();
  });
});
