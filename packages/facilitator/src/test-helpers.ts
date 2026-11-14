import { ed25519 } from "@noble/curves/ed25519";
import { buildPaymentSigningPayload, type SignedPayment, type X402Accept } from "@securelambda/schemas";

/** Test-only fixture helpers for building validly-signed SignedPayment objects against the sandbox scheme. */
export function generatePayerKeypair(): { privateKey: Uint8Array; publicKeyBase64: string } {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKeyBase64: Buffer.from(publicKey).toString("base64") };
}

export function signPayment(
  privateKey: Uint8Array,
  unsigned: Omit<SignedPayment, "signedDelegate">,
): SignedPayment {
  const payload = buildPaymentSigningPayload(unsigned);
  const signature = ed25519.sign(payload, privateKey);
  return { ...unsigned, signedDelegate: Buffer.from(signature).toString("base64") };
}

export function buildQuote(overrides: Partial<X402Accept> = {}): X402Accept {
  return {
    scheme: "exact",
    network: "near:testnet",
    asset: "near",
    maxAmountRequired: "1000",
    payTo: "seller.testnet",
    resource: "/v1/listings/lst_1/evaluate",
    validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: "n_1",
    ...overrides,
  };
}
