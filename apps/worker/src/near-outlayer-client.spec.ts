import { KeyPair } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import { Account } from "near-api-js";
import { InMemorySigner } from "near-api-js";
import { InMemoryKeyStore } from "near-api-js/lib/key_stores";
import { NearOutLayerClient, SigningAccount, parseTxResult, type RpcCall } from "./near-outlayer-client";

const HASH = "66cb5fc5995c8ae1696c73740c97fdf89ccd9954dcc714be6d284abecaf4b462";
const b64 = (s: string) => Buffer.from(s).toString("base64");

const OK_OUTPUT = { v: 1, ok: true, metrics: { accuracy: 0.89, auc: 0.96, f1: 0.92 }, n_bucket: "200-499", evaluator_version: "1.0.0" };

/** Shape captured from a real OutLayer testnet run. */
function completedEvent(hash: string, success = true): string {
  return (
    "EVENT_JSON:" +
    JSON.stringify({
      standard: "near-outlayer",
      event: "execution_completed",
      data: [{ success, code_source: { WasmUrl: { url: "https://test.fastfs.io/x.wasm", hash, build_target: "wasm32-wasip1" } } }],
    })
  );
}

function result(value: string | null, logs: string[]) {
  return { status: { SuccessValue: value }, receipts_outcome: [{ outcome: { executor_id: "outlayer.testnet", logs } }] };
}

describe("parseTxResult", () => {
  it("returns metrics and the wasm hash from the execution_completed event", () => {
    const status = parseTxResult(result(b64(JSON.stringify(OK_OUTPUT)), ["Resolved project: x", completedEvent(HASH)]));
    expect(status).toEqual({ kind: "completed", success: true, output: OK_OUTPUT, wasmHash: HASH });
  });

  it("treats a null return (OutLayer refunded after a failed execution) as a transient failure", () => {
    const status = parseTxResult(result(b64("null"), ["Execution promise failed: Failed. Refunded 1000100000000000000000 yoctoNEAR"]));
    expect(status).toMatchObject({ kind: "completed", success: false, transient: true, code: "RUN_TIMEOUT_UNKNOWN" });
    expect((status as { message: string }).message).toContain("Execution promise failed");
  });

  it("treats an empty return the same way", () => {
    expect(parseTxResult(result(null, []))).toMatchObject({ success: false, transient: true });
  });

  it("reports a deterministic evaluator error as non-transient", () => {
    const status = parseTxResult(result(b64(JSON.stringify({ v: 1, ok: false, error: "DATA_UNUSABLE" })), [completedEvent(HASH)]));
    expect(status).toMatchObject({ kind: "completed", success: false, transient: false, code: "DATA_UNUSABLE" });
  });

  it("treats an evaluator INTERNAL error as transient", () => {
    const status = parseTxResult(result(b64(JSON.stringify({ v: 1, ok: false, error: "INTERNAL" })), [completedEvent(HASH)]));
    expect(status).toMatchObject({ success: false, transient: true, code: "INTERNAL" });
  });

  it("does not trust output without a matching execution_completed event", () => {
    const status = parseTxResult(result(b64(JSON.stringify(OK_OUTPUT)), ["Resolved project: x"]));
    expect(status).toMatchObject({ success: false, transient: true, code: "INTERNAL" });
  });

  it("ignores an execution_completed event that reports failure", () => {
    const status = parseTxResult(result(b64(JSON.stringify(OK_OUTPUT)), [completedEvent(HASH, false)]));
    expect(status).toMatchObject({ success: false, code: "INTERNAL" });
  });

  it("rejects output that is not a valid evaluator result", () => {
    const status = parseTxResult(result(b64(JSON.stringify({ hello: "world" })), [completedEvent(HASH)]));
    expect(status).toMatchObject({ success: false, transient: true, code: "INTERNAL" });
  });

  it("treats a failed transaction as transient", () => {
    expect(parseTxResult({ status: { Failure: { ActionError: {} } } })).toMatchObject({ success: false, transient: true });
  });
});

describe("NearOutLayerClient.txStatus", () => {
  const opts = {
    rpcUrl: "http://unused",
    networkId: "testnet",
    contractId: "outlayer.testnet",
    signerAccountId: "signer.testnet",
    signerPrivateKey: "ed25519:unused",
    project: "owner.testnet/evaluator",
    secretsAccountId: "owner.testnet",
  };

  it("asks for the signer's transaction at FINAL finality", async () => {
    const rpc = jest.fn<ReturnType<RpcCall>, Parameters<RpcCall>>().mockResolvedValue(result(b64(JSON.stringify(OK_OUTPUT)), [completedEvent(HASH)]));
    const status = await new NearOutLayerClient(opts, rpc).txStatus("TXHASH");
    expect(status).toMatchObject({ kind: "completed", success: true, wasmHash: HASH });
    expect(rpc).toHaveBeenCalledWith("EXPERIMENTAL_tx_status", { tx_hash: "TXHASH", sender_account_id: "signer.testnet", wait_until: "FINAL" });
  });

  it.each([
    ["an RPC error while the run is still executing", { rpcError: { name: "HANDLER_ERROR", cause: { info: { cause: "PENDING" } } } }],
    ["a transaction the node has not indexed yet", { rpcError: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } } }],
    ["an RPC timeout", { rpcError: { name: "TIMEOUT_ERROR" } }],
    ["a network failure", new Error("fetch failed")],
  ])("reports pending, never failure, for %s", async (_label, error) => {
    const rpc: RpcCall = async () => {
      throw error;
    };
    expect(await new NearOutLayerClient(opts, rpc).txStatus("TXHASH")).toEqual({ kind: "pending" });
  });

  describe("a transaction the network never observed", () => {
    const notObserved: RpcCall = async () => {
      throw { rpcError: { name: "HANDLER_ERROR", cause: { info: { cause: "NOT_OBSERVED" } } } };
    };

    it("is pending during the grace period, then a transient failure so the worker resubmits", async () => {
      let clock = 1_000_000;
      const client = new NearOutLayerClient({ ...opts, notObservedGraceMs: 120_000, now: () => clock }, notObserved);
      expect(await client.txStatus("DROPPED")).toEqual({ kind: "pending" });
      clock += 119_000;
      expect(await client.txStatus("DROPPED")).toEqual({ kind: "pending" });
      clock += 2_000;
      expect(await client.txStatus("DROPPED")).toMatchObject({ kind: "completed", success: false, transient: true, code: "RUN_TIMEOUT_UNKNOWN" });
    });

    it("counts UNKNOWN_TRANSACTION the same way", async () => {
      let clock = 0;
      const rpc: RpcCall = async () => {
        throw { rpcError: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } } };
      };
      const client = new NearOutLayerClient({ ...opts, notObservedGraceMs: 10, now: () => clock }, rpc);
      expect(await client.txStatus("T")).toEqual({ kind: "pending" });
      clock = 11;
      expect(await client.txStatus("T")).toMatchObject({ success: false, transient: true });
    });

    it("never gives up on a transaction that is known to be executing", async () => {
      let clock = 0;
      const pending: RpcCall = async () => {
        throw { rpcError: { name: "HANDLER_ERROR", cause: { info: { cause: "PENDING" } } } };
      };
      const client = new NearOutLayerClient({ ...opts, notObservedGraceMs: 10, now: () => clock }, pending);
      expect(await client.txStatus("T")).toEqual({ kind: "pending" });
      clock = 10_000_000;
      expect(await client.txStatus("T")).toEqual({ kind: "pending" });
    });
  });

  it("refuses a listing whose evaluator project is not the configured one", async () => {
    await expect(new NearOutLayerClient(opts, jest.fn()).requestExecution("someone-else.testnet/evil", {} as never)).rejects.toThrow(/does not match OUTLAYER_PROJECT/);
  });
});

describe("SigningAccount nonces", () => {
  async function makeAccount(chainNonce: () => number) {
    const keyStore = new InMemoryKeyStore();
    const keyPair = KeyPair.fromRandom("ed25519");
    await keyStore.setKey("testnet", "signer.testnet", keyPair as never);
    const provider = {
      query: async () => ({ nonce: chainNonce(), permission: "FullAccess", block_height: 1, block_hash: "x" }),
      block: async () => ({ header: { hash: "11111111111111111111111111111111" } }),
    };
    const connection = { networkId: "testnet", provider, signer: new InMemorySigner(keyStore) };
    return new SigningAccount(connection as unknown as ConstructorParameters<typeof Account>[0], "signer.testnet");
  }
  const actions = [actionCreators.transfer(1n)];
  const nonceOf = (signed: Awaited<ReturnType<SigningAccount["sign"]>>) => Number(signed[1].transaction.nonce);

  it("signs consecutive transactions with increasing nonces even when the chain has not moved", async () => {
    const account = await makeAccount(() => 100);
    const first = nonceOf(await account.sign("outlayer.testnet", actions));
    const second = nonceOf(await account.sign("outlayer.testnet", actions));
    const third = nonceOf(await account.sign("outlayer.testnet", actions));
    expect([first, second, third]).toEqual([101, 102, 103]);
  });

  it("follows the chain when another process has moved the nonce ahead", async () => {
    let chain = 100;
    const account = await makeAccount(() => chain);
    expect(nonceOf(await account.sign("outlayer.testnet", actions))).toBe(101);
    chain = 500;
    expect(nonceOf(await account.sign("outlayer.testnet", actions))).toBe(501);
  });
});
