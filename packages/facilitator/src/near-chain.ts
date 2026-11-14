import { KeyPair } from "@near-js/crypto";
import { SCHEMA, actionCreators } from "@near-js/transactions";
import { connect, keyStores } from "near-api-js";
import { deserialize } from "borsh";

/** The few chain operations the facilitator needs. A fake of this is what the unit tests use. */
export interface NearChain {
  /** The access key's on-chain nonce, or null if that key does not exist on the account. */
  getAccessKeyNonce(accountId: string, publicKey: string): Promise<bigint | null>;
  getBalance(accountId: string): Promise<bigint>;
  /** NEP-141 `ft_balance_of`, in the token's base units. */
  getTokenBalance(tokenContract: string, accountId: string): Promise<bigint>;
  /** NEP-145: has this account paid storage on the token contract? An ft_transfer to an unregistered receiver fails. */
  isRegisteredOnToken(tokenContract: string, accountId: string): Promise<boolean>;
  getBlockHeight(): Promise<number>;
  /** Submits the buyer's signed delegate inside a relayer-paid transaction and waits for it to finish. */
  submitDelegate(signedDelegateBase64: string, buyerId: string): Promise<{ ok: true; txHash: string } | { ok: false; reason: string }>;
  relayerBalance(): Promise<bigint>;
}

/** Keep roughly this much in the relayer for gas before refusing to settle (0.05 NEAR). */
export const RELAYER_MIN_BALANCE_YOCTO = 50_000_000_000_000_000_000_000n;

export interface NearRpcChainOptions {
  rpcUrl: string;
  networkId: string;
  relayerAccountId: string;
  /** `ed25519:<base58>` secret key of the relayer. */
  relayerPrivateKey: string;
}

/** Read-only chain access. Buyers use this to sign payments; it needs no relayer credentials. */
export class NearRpcReader {
  constructor(protected readonly rpcUrl: string) {}

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    // Public RPC nodes rate-limit and hiccup. Retry only failures that say nothing about the chain
    // (network error, 429/5xx, non-JSON); a real answer such as UNKNOWN_ACCESS_KEY is returned as-is.
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
      try {
        const response = await fetch(this.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "securelambda", method, params }),
        });
        if (response.status === 429 || response.status >= 500) throw new Error(`NEAR RPC ${method}: HTTP ${response.status}`);
        const body = (await response.json()) as { result?: T; error?: { cause?: { name?: string }; message?: string } };
        if (body.error) {
          const name = body.error.cause?.name;
          if (!name) throw new Error(`NEAR RPC ${method} failed: ${body.error.message ?? "RPC_ERROR"}`);
          throw Object.assign(new Error(`NEAR RPC ${method} failed: ${name}`), { rpcErrorName: name, final: true });
        }
        return body.result as T;
      } catch (err) {
        if ((err as { final?: boolean }).final) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  async getAccessKeyNonce(accountId: string, publicKey: string): Promise<bigint | null> {
    try {
      const result = await this.rpc<{ nonce?: number | string; error?: string }>("query", {
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      });
      // For a missing key the node answers with a normal result carrying an `error` string, not an RPC error.
      if (result.error !== undefined || result.nonce === undefined) return null;
      return BigInt(result.nonce);
    } catch (err) {
      const name = (err as { rpcErrorName?: string }).rpcErrorName;
      if (name === "UNKNOWN_ACCESS_KEY" || name === "UNKNOWN_ACCOUNT") return null;
      throw err;
    }
  }

  /**
   * Is this key a full-access key on the account? Logging in needs one: a function-call key can be handed to
   * a dapp for narrow purposes and must not be enough to act as the account here. Missing key or account is false.
   */
  async isFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
    try {
      const result = await this.rpc<{ permission?: unknown; error?: string }>("query", {
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      });
      return result.error === undefined && result.permission === "FullAccess";
    } catch (err) {
      const name = (err as { rpcErrorName?: string }).rpcErrorName;
      if (name === "UNKNOWN_ACCESS_KEY" || name === "UNKNOWN_ACCOUNT") return false;
      throw err;
    }
  }

  async getBalance(accountId: string): Promise<bigint> {
    try {
      const result = await this.rpc<{ amount: string }>("query", {
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      });
      return BigInt(result.amount);
    } catch (err) {
      if ((err as { rpcErrorName?: string }).rpcErrorName === "UNKNOWN_ACCOUNT") return 0n;
      throw err;
    }
  }

  private async callView<T>(contract: string, methodName: string, args: unknown): Promise<T> {
    const result = await this.rpc<{ result?: number[]; error?: string }>("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contract,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    if (result.error !== undefined || !result.result) throw new Error(`view ${contract}.${methodName} failed: ${result.error ?? "no result"}`);
    return JSON.parse(Buffer.from(result.result).toString("utf8")) as T;
  }

  async getTokenBalance(tokenContract: string, accountId: string): Promise<bigint> {
    return BigInt(await this.callView<string>(tokenContract, "ft_balance_of", { account_id: accountId }));
  }

  async isRegisteredOnToken(tokenContract: string, accountId: string): Promise<boolean> {
    return (await this.callView<unknown | null>(tokenContract, "storage_balance_of", { account_id: accountId })) !== null;
  }

  async getBlockHeight(): Promise<number> {
    const result = await this.rpc<{ header: { height: number } }>("block", { finality: "final" });
    return result.header.height;
  }

}

export class NearRpcChain extends NearRpcReader implements NearChain {
  constructor(private readonly opts: NearRpcChainOptions) {
    super(opts.rpcUrl);
  }

  relayerBalance(): Promise<bigint> {
    return this.getBalance(this.opts.relayerAccountId);
  }

  async submitDelegate(signedDelegateBase64: string, buyerId: string) {
    const keyPair = KeyPair.fromString(this.opts.relayerPrivateKey as `ed25519:${string}`);
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(this.opts.networkId, this.opts.relayerAccountId, keyPair as never);
    const near = await connect({ networkId: this.opts.networkId, nodeUrl: this.opts.rpcUrl, keyStore });
    const relayer = await near.account(this.opts.relayerAccountId);

    const signedDelegate = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegateBase64, "base64"));
    try {
      const outcome = await relayer.signAndSendTransaction({
        receiverId: buyerId,
        actions: [actionCreators.signedDelegate(signedDelegate as never) as never],
      });
      // The outer transaction can succeed while the delegated transfer inside it fails, so inspect every receipt.
      const failure = outcome.receipts_outcome.find((r) => "Failure" in (r.outcome.status as object));
      if (failure) {
        return { ok: false as const, reason: `delegated transfer failed: ${JSON.stringify((failure.outcome.status as { Failure: unknown }).Failure).slice(0, 300)}` };
      }
      return { ok: true as const, txHash: outcome.transaction.hash as string };
    } catch (err) {
      return { ok: false as const, reason: `relayer submit failed: ${(err as Error).message}` };
    }
  }
}
