import { KeyPair, KeyType, PublicKey } from "@near-js/crypto";
import { NearRpcReader, signDelegatePayment, wrapNear } from "@securelambda/facilitator";
import type { PaymentSigner } from "./client";

export interface NearPaymentSignerOptions {
  /** The buyer's NEAR account, e.g. `buyer.testnet`. */
  accountId: string;
  /** `ed25519:<base58>` secret key of an access key on that account. Never leaves this process. */
  privateKey: string;
  rpcUrl?: string;
  networkId?: string;
  /** How many blocks (~1s each) the signed payment stays valid. Must outlast the run, since settlement happens afterwards. */
  ttlBlocks?: number;
  /**
   * When the buyer's balance of the quoted token is short, wrap native NEAR into it first (1:1, see `wrapNear`).
   * Only valid when the quoted token is a wNEAR contract. Off by default, because it spends the buyer's NEAR.
   */
  autoWrapNear?: boolean;
}

async function waitUntil(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the wrapped NEAR to become final");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * A real buyer-side signer. It reads the key's nonce and the chain height, then signs a NEP-366 delegate
 * action that calls `ft_transfer` on the quoted token for exactly the quoted amount. The buyer sends nothing
 * to the chain for the payment itself; the gateway's relayer submits it at settle time.
 */
export function createNearPaymentSigner(options: NearPaymentSignerOptions): PaymentSigner {
  const rpcUrl = options.rpcUrl ?? "https://test.rpc.fastnear.com";
  const reader = new NearRpcReader(rpcUrl);
  const keyPair = KeyPair.fromString(options.privateKey as `ed25519:${string}`);
  const publicKey = new PublicKey({ keyType: KeyType.ED25519, data: keyPair.getPublicKey().ed25519Key!.data }).toString();

  return async (quote) => {
    const token = quote.assetContract;
    if (!token) throw new Error("this quote has no assetContract, so it cannot be paid on NEAR");

    if (options.autoWrapNear) {
      const missing = BigInt(quote.maxAmountRequired) - (await reader.getTokenBalance(token, options.accountId));
      if (missing > 0n) {
        await wrapNear(
          { rpcUrl, networkId: options.networkId ?? "testnet", accountId: options.accountId, privateKey: options.privateKey },
          token,
          missing,
        );
        // The gateway reads balances at "final" finality, which trails the wrap by a few seconds. Signing before
        // the new balance is visible there would get the payment rejected as "insufficient balance".
        await waitUntil(async () => (await reader.getTokenBalance(token, options.accountId)) >= BigInt(quote.maxAmountRequired), 30_000);
      }
    }

    const [accessKeyNonce, currentBlockHeight] = await Promise.all([
      reader.getAccessKeyNonce(options.accountId, publicKey),
      reader.getBlockHeight(),
    ]);
    if (accessKeyNonce === null) throw new Error(`key ${publicKey} is not an access key on ${options.accountId}`);
    return signDelegatePayment({
      payerId: options.accountId,
      privateKey: options.privateKey,
      quote,
      accessKeyNonce,
      currentBlockHeight,
      ttlBlocks: options.ttlBlocks ?? 1200,
    });
  };
}
