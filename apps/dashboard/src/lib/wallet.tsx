"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
import { internalActionToNaj, setupWalletSelector, type InternalAction, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { MOCKING, NEAR_NETWORK } from "./near";
import type { WrapPlan } from "./wrap-plan";

type WalletStatus = "loading" | "disconnected" | "connecting" | "connected";

export interface SignMessageInput {
  message: string;
  nonce: string;
  recipient: string;
}

export interface Wallet {
  status: WalletStatus;
  accountId: string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  signMessage: (input: SignMessageInput) => Promise<{ publicKey: string; signature: string }>;
  addFullAccessKey: (publicKey: string) => Promise<void>;
  deleteKey: (publicKey: string) => Promise<void>;
  sendNear: (receiverId: string, amountYocto: bigint) => Promise<void>;
  wrapNear: (tokenContract: string, plan: WrapPlan) => Promise<void>;
}

const WalletContext = createContext<Wallet | null>(null);

const DEMO_ACCOUNT = process.env.NEXT_PUBLIC_DEMO_ACCOUNT ?? "medai.testnet";
const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function useDemoWallet(): Wallet {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  return {
    status,
    accountId,
    connect: () => {
      setStatus("connecting");
      void tick(400).then(() => {
        setAccountId(new URLSearchParams(window.location.search).get("as") ?? DEMO_ACCOUNT);
        setStatus("connected");
      });
    },
    disconnect: async () => {
      setAccountId(null);
      setStatus("disconnected");
    },
    signMessage: async () => {
      await tick(500);
      return { publicKey: "ed25519:DemoKey1111111111111111111111111111111111111", signature: Buffer.alloc(64).toString("base64") };
    },
    addFullAccessKey: () => tick(700),
    deleteKey: () => tick(500),
    sendNear: () => tick(900),
    wrapNear: () => tick(900),
  };
}

function keyAction(action: InternalAction) {
  return [internalActionToNaj(action)];
}

const WRAP_GAS = "30000000000000";
// NEP-145 refunds whatever exceeds the token's real storage minimum when registration_only is set.
const STORAGE_DEPOSIT_YOCTO = "12500000000000000000000";

function wrapActions(accountId: string, { register, wrapYocto }: WrapPlan): InternalAction[] {
  const deposit: InternalAction = {
    type: "FunctionCall",
    params: { methodName: "near_deposit", args: {}, gas: WRAP_GAS, deposit: wrapYocto.toString() },
  };
  if (!register) return [deposit];
  const registration: InternalAction = {
    type: "FunctionCall",
    params: { methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, gas: WRAP_GAS, deposit: STORAGE_DEPOSIT_YOCTO },
  };
  return [registration, deposit];
}

function useSelectorWallet(enabled: boolean): Wallet {
  const selector = useRef<WalletSelector | null>(null);
  const modal = useRef<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("loading");

  useEffect(() => {
    if (!enabled) return;
    let unsubscribe = () => {};
    void setupWalletSelector({
      network: NEAR_NETWORK,
      modules: [setupMeteorWallet(), setupMyNearWallet(), setupIntearWallet(), setupHotWallet()],
    }).then((s) => {
      selector.current = s;
      modal.current = setupModal(s, { theme: "light", description: "Sign in with the NEAR account that owns your data or models." });
      const sub = s.store.observable.subscribe((state) => {
        const active = state.accounts.find((a) => a.active)?.accountId ?? null;
        setAccountId(active);
        setStatus(active ? "connected" : "disconnected");
      });
      unsubscribe = () => sub.unsubscribe();
    });
    return () => unsubscribe();
  }, [enabled]);

  const activeWallet = async () => {
    if (!selector.current) throw new Error("Wallet is still loading");
    return selector.current.wallet();
  };

  return {
    status,
    accountId,
    connect: () => modal.current?.show(),
    disconnect: async () => (await activeWallet()).signOut(),
    signMessage: async ({ message, nonce, recipient }) => {
      const signed = await (await activeWallet()).signMessage({ message, recipient, nonce: Buffer.from(nonce, "base64") });
      if (!signed) throw new Error("The wallet did not return a signature");
      return { publicKey: signed.publicKey, signature: signed.signature };
    },
    addFullAccessKey: async (publicKey) => {
      if (!accountId) throw new Error("Wallet not connected");
      await (await activeWallet()).signAndSendTransaction({
        receiverId: accountId,
        actions: keyAction({ type: "AddKey", params: { publicKey, accessKey: { permission: "FullAccess" } } }),
      });
    },
    deleteKey: async (publicKey) => {
      if (!accountId) throw new Error("Wallet not connected");
      await (await activeWallet()).signAndSendTransaction({
        receiverId: accountId,
        actions: keyAction({ type: "DeleteKey", params: { publicKey } }),
      });
    },
    sendNear: async (receiverId, amountYocto) => {
      await (await activeWallet()).signAndSendTransaction({
        receiverId,
        actions: keyAction({ type: "Transfer", params: { deposit: amountYocto.toString() } }),
      });
    },
    wrapNear: async (tokenContract, plan) => {
      if (!accountId) throw new Error("Wallet not connected");
      await (await activeWallet()).signAndSendTransaction({
        receiverId: tokenContract,
        actions: wrapActions(accountId, plan).map(internalActionToNaj),
      });
    },
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const demo = useDemoWallet();
  const real = useSelectorWallet(!MOCKING);
  return <WalletContext.Provider value={MOCKING ? demo : real}>{children}</WalletContext.Provider>;
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside WalletProvider");
  return wallet;
}
