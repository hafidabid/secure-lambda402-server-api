"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import type { SignedPayment, X402Accept } from "@securelambda/schemas";
// Deep import: the package index also pulls in ioredis and near-api-js, which cannot run in a browser.
import { signDelegatePayment } from "@securelambda/facilitator/dist/near-delegate";
import { api, setUnauthenticatedHandler } from "./api";
import { errorMessage } from "./format";
import { accessKeyNonce, blockHeight, PAYMENT_TTL_BLOCKS } from "./near";
import { useWallet, type Wallet } from "./wallet";

const StoredLoginSchema = z.object({ token: z.string(), account_id: z.string() });
type StoredLogin = z.infer<typeof StoredLoginSchema>;

const PrivateKeySchema = z.custom<KeyPairString>((v) => typeof v === "string" && v.startsWith("ed25519:"));

const LOGIN_KEY = "securelambda.login";
const payKeyStorage = (accountId: string) => `securelambda.payment-key.${accountId}`;

const storageListeners = new Set<() => void>();

function subscribeStorage(listener: () => void) {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

function rawStorage(key: string | null): string | null {
  try {
    return key ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function parseStored<S extends z.ZodTypeAny>(raw: string | null, schema: S): z.output<S> | null {
  try {
    return raw ? (schema.safeParse(JSON.parse(raw)).data ?? null) : null;
  } catch {
    return null;
  }
}

function useStored<S extends z.ZodTypeAny>(key: string | null, schema: S): z.output<S> | null {
  const raw = useSyncExternalStore(subscribeStorage, () => rawStorage(key), () => null);
  return parseStored(raw, schema);
}

function writeStorage(key: string, value: unknown | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the session then lasts only as long as this page.
  }
  storageListeners.forEach((listener) => listener());
}

export type SessionStatus = "signed-out" | "signing-in" | "signed-in";
export type PaymentKeyStatus = "none" | "adding" | "ready" | "removing";

interface Session {
  wallet: Wallet;
  status: SessionStatus;
  token: string | null;
  accountId: string | null;
  signInError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  paymentKey: PaymentKeyStatus;
  enablePayments: () => Promise<void>;
  removePaymentKey: () => Promise<void>;
  signPayment: (accept: X402Accept) => Promise<SignedPayment>;
}

const SessionContext = createContext<Session | null>(null);

function publicKeyOf(privateKey: KeyPairString): string {
  return KeyPair.fromString(privateKey).getPublicKey().toString();
}

function sessionStatus(active: boolean, signingIn: boolean): SessionStatus {
  if (active) return "signed-in";
  return signingIn ? "signing-in" : "signed-out";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState<"adding" | "removing" | null>(null);

  const accountId = wallet.accountId;
  const login = useStored(LOGIN_KEY, StoredLoginSchema);
  const privateKey = useStored(accountId ? payKeyStorage(accountId) : null, PrivateKeySchema);
  const active = login && login.account_id === accountId ? login : null;

  const expire = useCallback(() => writeStorage(LOGIN_KEY, null), []);

  useEffect(() => setUnauthenticatedHandler(expire), [expire]);

  const signIn = async () => {
    if (!accountId) return;
    setSigningIn(true);
    setSignInError(null);
    try {
      const challenge = await api.challenge(accountId);
      const signed = await wallet.signMessage({ message: challenge.message, nonce: challenge.nonce, recipient: challenge.recipient });
      const session = await api.login({ account_id: accountId, public_key: signed.publicKey, signature: signed.signature, nonce: challenge.nonce });
      const stored: StoredLogin = { token: session.token, account_id: session.account_id };
      writeStorage(LOGIN_KEY, stored);
    } catch (e) {
      setSignInError(errorMessage(e));
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    const token = active?.token;
    expire();
    if (token) await api.logout(token).catch(() => undefined);
    await wallet.disconnect();
  };

  const enablePayments = async () => {
    if (!accountId) throw new Error("Connect a wallet first");
    const key = KeyPair.fromRandom("ed25519").toString();
    setKeyBusy("adding");
    try {
      await wallet.addFullAccessKey(publicKeyOf(key));
      writeStorage(payKeyStorage(accountId), key);
    } finally {
      setKeyBusy(null);
    }
  };

  const removePaymentKey = async () => {
    if (!accountId || !privateKey) return;
    setKeyBusy("removing");
    try {
      await wallet.deleteKey(publicKeyOf(privateKey));
      writeStorage(payKeyStorage(accountId), null);
    } finally {
      setKeyBusy(null);
    }
  };

  const signPayment = async (accept: X402Accept): Promise<SignedPayment> => {
    if (!accountId || !privateKey) throw new Error("Browser payments are not enabled");
    const [nonce, height] = await Promise.all([accessKeyNonce(accountId, publicKeyOf(privateKey)), blockHeight()]);
    if (nonce === null) throw new Error("The payment key is no longer on your account. Enable payments again.");
    return signDelegatePayment({
      payerId: accountId,
      privateKey,
      quote: accept,
      accessKeyNonce: nonce,
      currentBlockHeight: height,
      ttlBlocks: PAYMENT_TTL_BLOCKS,
    });
  };

  const status = sessionStatus(!!active, signingIn);
  const paymentKey: PaymentKeyStatus = keyBusy ?? (privateKey ? "ready" : "none");

  return (
    <SessionContext.Provider
      value={{
        wallet,
        status,
        token: active?.token ?? null,
        accountId,
        signInError,
        signIn,
        signOut,
        paymentKey,
        enablePayments,
        removePaymentKey,
        signPayment,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
