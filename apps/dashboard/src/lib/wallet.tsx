"use client";

import { createContext, useContext, useState } from "react";
import type { SignedPayment, X402Accept } from "@securelambda/schemas";

type WalletStatus = "disconnected" | "connecting" | "connected";

interface Wallet {
  status: WalletStatus;
  accountId: string | null;
  connect: (accountId?: string) => Promise<void>;
  disconnect: () => void;
  signPayment: (accept: X402Accept) => Promise<SignedPayment>;
}

const WalletContext = createContext<Wallet | null>(null);

// ponytail: stand-in for @near-wallet-selector; the integration swaps connect/signPayment for the real modal and NEP-366 delegate
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [accountId, setAccountId] = useState<string | null>(null);

  const connect = async (id = process.env.NEXT_PUBLIC_DEMO_ACCOUNT ?? "medai.testnet") => {
    setStatus("connecting");
    await new Promise((r) => setTimeout(r, 400));
    setAccountId(id);
    setStatus("connected");
  };

  const disconnect = () => {
    setAccountId(null);
    setStatus("disconnected");
  };

  const signPayment = async (accept: X402Accept): Promise<SignedPayment> => {
    if (!accountId) throw new Error("Wallet not connected");
    return {
      nonce: accept.nonce,
      payerId: accountId,
      payerPublicKey: "ed25519:demo",
      payTo: accept.payTo,
      asset: accept.asset,
      amount: accept.maxAmountRequired,
      validUntil: accept.validUntil,
      maxBlockHeight: 1,
      signedDelegate: "ZGVtbw==",
    };
  };

  return (
    <WalletContext.Provider value={{ status, accountId, connect, disconnect, signPayment }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside WalletProvider");
  return wallet;
}
