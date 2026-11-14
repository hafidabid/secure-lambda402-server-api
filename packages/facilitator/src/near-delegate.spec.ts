import { KeyPair } from "@near-js/crypto";
import type { SignedPayment } from "@securelambda/schemas";
import { buildQuote } from "./test-helpers";
import { decodeSignedDelegate, signDelegatePayment, verifyDelegateSignature } from "./near-delegate";

describe("signDelegatePayment", () => {
  it("signs without a global Buffer, as in a browser", () => {
    const key = KeyPair.fromRandom("ed25519");
    const quote = buildQuote({ assetContract: "wrap.testnet" });

    const saved = globalThis.Buffer;
    let payment: SignedPayment;
    try {
      // @ts-expect-error simulating a browser global scope
      delete globalThis.Buffer;
      payment = signDelegatePayment({
        payerId: "buyer.testnet",
        privateKey: key.toString(),
        quote,
        accessKeyNonce: 5n,
        currentBlockHeight: 1_000,
        ttlBlocks: 600,
      });
    } finally {
      globalThis.Buffer = saved;
    }

    const decoded = decodeSignedDelegate(payment.signedDelegate);
    expect(verifyDelegateSignature(decoded)).toBe(true);
    expect(decoded.nonce).toBe(6n);
    expect(decoded.receiverId).toBe("wrap.testnet");
    expect(payment.payerPublicKey).toBe(Buffer.from(key.getPublicKey().data).toString("base64"));
  });
});
