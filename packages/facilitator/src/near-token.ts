import { KeyPair } from "@near-js/crypto";
import { connect, keyStores } from "near-api-js";
import { NearRpcReader } from "./near-chain";

export interface NearAccountAccess {
  rpcUrl: string;
  networkId: string;
  accountId: string;
  /** `ed25519:<base58>` secret key of a full-access key on `accountId`. */
  privateKey: string;
}

const GAS = 100_000_000_000_000n; // 100 Tgas, generous for storage_deposit / near_deposit
/** 0.0125 NEAR. NEP-145 refunds anything above the real minimum when registration_only is set. */
const STORAGE_DEPOSIT = 12_500_000_000_000_000_000_000n;

async function accountOf(access: NearAccountAccess) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(access.networkId, access.accountId, KeyPair.fromString(access.privateKey as `ed25519:${string}`) as never);
  const near = await connect({ networkId: access.networkId, nodeUrl: access.rpcUrl, keyStore });
  return near.account(access.accountId);
}

/**
 * NEP-145 registration. A token contract refuses to credit an account that has not paid for its
 * storage, so a seller (and a buyer, before wrapping) must do this once per token. Idempotent.
 */
export async function ensureRegisteredOnToken(access: NearAccountAccess, tokenContract: string): Promise<void> {
  if (await new NearRpcReader(access.rpcUrl).isRegisteredOnToken(tokenContract, access.accountId)) return;
  const account = await accountOf(access);
  await account.functionCall({
    contractId: tokenContract,
    methodName: "storage_deposit",
    args: { account_id: access.accountId, registration_only: true },
    gas: GAS,
    attachedDeposit: STORAGE_DEPOSIT,
  });
}

/**
 * Turns native NEAR into wNEAR 1:1 (`near_deposit` on wrap.near / wrap.testnet). This is a wrap, not a
 * swap: no price, no slippage, no liquidity. It is what lets a buyer who only holds NEAR pay in the token
 * the facilitator settles.
 */
export async function wrapNear(access: NearAccountAccess, wrapContract: string, amountYocto: bigint): Promise<void> {
  await ensureRegisteredOnToken(access, wrapContract);
  const account = await accountOf(access);
  await account.functionCall({
    contractId: wrapContract,
    methodName: "near_deposit",
    args: {},
    gas: GAS,
    attachedDeposit: amountYocto,
  });
}

/** The reverse of `wrapNear`: burns wNEAR and returns the same amount of native NEAR (`near_withdraw`, needs 1 yoctoNEAR). */
export async function unwrapNear(access: NearAccountAccess, wrapContract: string, amountYocto: bigint): Promise<void> {
  const account = await accountOf(access);
  await account.functionCall({
    contractId: wrapContract,
    methodName: "near_withdraw",
    args: { amount: amountYocto.toString() },
    gas: GAS,
    attachedDeposit: 1n,
  });
}
