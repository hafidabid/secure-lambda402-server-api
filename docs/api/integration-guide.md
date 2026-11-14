# SecureLambda Integration Guide

How to connect a buyer agent, a seller tool or a frontend to the SecureLambda API

Base URL: `https://secure-lambda-api.projectdeadwood.my.id`  ·  Network: NEAR testnet  ·  Companion document: *Endpoint Reference*

## 1. What SecureLambda does

SecureLambda lets a **seller** offer a private dataset for model testing, and lets a **buyer** pay per run to find out how well their own model scores on it. Neither side sees the other's raw material: the dataset and the model are both uploaded **encrypted**, and only a sealed evaluator program can open them. The buyer gets back a few summary numbers (accuracy, AUC, F1) and a receipt. The seller gets paid.

| Role | What they do |
|----|----|
| **Seller** | Creates a listing, uploads an encrypted dataset, publishes it. Must be on the seller allow-list. |
| **Buyer** (usually an AI agent) | Browses listings, uploads an encrypted model, pays per run with NEAR, reads the score. |
| **Relayer** (the service) | Submits the buyer's signed payment to the blockchain after the score is ready and pays the network fee. |
| **Evaluator** | The program that decrypts both files, scores the model and returns only summary metrics. |

## 2. The whole flow at a glance

1.  **Log in** – prove you own a NEAR account by signing a one-time challenge (no gas, no transaction).
2.  **Seller:** create listing → seal and upload dataset → publish.
3.  **Buyer:** find a listing → seal and upload a model.
4.  **Buyer:** ask to run it → the service answers `402` with a price quote.
5.  **Buyer:** sign the payment locally and repeat the request with an `X-Payment` header.
6.  **Service:** verifies the payment, the evaluator scores the model, then the payment is settled on-chain.
7.  **Buyer:** receives the score and a receipt (immediately, or by polling a run).

> **The buyer is only charged when a score is delivered.** If a run fails, nothing is taken.

## 3. Basics

| Item | Value |
|----|----|
| Base URL | `https://secure-lambda-api.projectdeadwood.my.id`. All API routes start with `/v1`. Health checks are at `/healthz` and `/readyz` (no prefix). |
| Format | JSON, except file uploads (`multipart/form-data`). Field names are `snake_case`. |
| HTTPS | Required. Plain HTTP redirects to HTTPS. |
| CORS | Currently open to any origin. Allowed headers: `authorization`, `content-type`, `x-payment`. The `location` header is readable by browsers. |
| Upload limit | 1 MiB per file (the encrypted file). |
| Rate limits | Per IP: 60 evaluate requests per minute. Per listing: the seller sets `runs_per_day` and `lifetime_budget` per buyer. Over the limit gives `429 RATE_LIMITED` or `403 BUDGET_EXHAUSTED`. |
| Currency | wNEAR (`wrap.testnet`), 24 decimals. Prices are integer strings in base units: `"10000000000000000000000"` = 0.01 NEAR. |

## 4. Logging in (NEP-413)

There are no passwords or API keys. You prove you own a NEAR account by signing a message with that account's **full-access key**. Signing happens on your side and nothing is sent to the blockchain. The private key never leaves your machine.

1.  `POST /v1/auth/challenge` with `{"account_id":"buyer.testnet"}`. You get back a one-time `nonce`, the `message` to sign and the `recipient`. The challenge expires in 5 minutes and works once.
2.  Sign it using NEP-413 with those exact values.
3.  `POST /v1/auth/login` with `account_id`, `public_key` (`ed25519:...`), `signature` (base64) and the `nonce`. You get `{ "token", "account_id", "expires_in": 3600 }`.
4.  Send `Authorization: Bearer <token>` on every later request. When it expires (1 hour) or you get `401`, log in again.

> **Do not send an `x-account-id` header.** The server ignores it and decides who you are only from your token. The first successful login creates your account automatically.

### Easiest: use the SDK

``` ts
import { BuyerAgentClient, createNearLogin, createNearPaymentSigner } from "@securelambda/agent-sdk";

const baseUrl = "https://secure-lambda-api.projectdeadwood.my.id"; // no trailing /v1
const accountId = "buyer.testnet";
const privateKey = process.env.NEAR_PRIVATE_KEY!; // "ed25519:..." (keep it secret)

const client = new BuyerAgentClient({
  baseUrl,
  headers: createNearLogin({ baseUrl, accountId, privateKey }),   // logs in and renews the session
  signer: createNearPaymentSigner({ accountId, privateKey, autoWrapNear: true }),
});
const result = await client.evaluate(listingId, modelId);        // handles 402, payment and polling
console.log(result.result.metrics, result.receipt);
```

### Without the SDK (any language)

The signed bytes are `sha256( borsh(u32 tag = 2147484061) ++ borsh(payload) )` where the payload is `{ message: string, nonce: [u8;32], recipient: string, callbackUrl: Option<string> }` (callbackUrl is `None`). Sign the 32-byte hash with ed25519 and send the signature as base64. This is the standard NEP-413 format, so existing NEAR wallet libraries can produce it.

## 5. Seller guide

1.  **Get the evaluator's public key:** `GET /v1/evaluator` returns `version`, `public_key` (base64, 32 bytes) and `wasm_hash`. You will encrypt to this key.

2.  **Create a draft listing:** `POST /v1/listings` with the name, the data schema, 5 synthetic sample rows, the price, the rules and the evaluator version. Details are in the Endpoint Reference.

3.  **Seal your dataset** (a CSV: feature columns plus the label column) with the crypto package, then upload it:

    ``` ts
    import { sealFile } from "@securelambda/crypto";

    const evPub = Buffer.from(evaluator.public_key, "base64");
    const sealed = sealFile(Buffer.from(csvText), evPub,
      { listing: listingId, role: "dataset", ev: evaluator.version });

    const form = new FormData();
    form.set("ciphertext", new Blob([sealed.blob]), "dataset.bin");
    form.set("wrapped_key", JSON.stringify(sealed.envelope));
    await fetch(`${baseUrl}/v1/listings/${listingId}/dataset`,
      { method: "POST", headers: auth, body: form });
    ```

4.  **Publish:** `POST /v1/listings/:id/publish`. A listing cannot be published without a dataset. To edit a published listing you must pause it first.

5.  **Get paid:** payments go straight to your NEAR account in wNEAR, after each successful run. See *Payments* below for the one-time setup.

6.  **See activity:** `GET /v1/seller/runs` lists runs on your listings: id, buyer, state and time. You never see the buyer's model or the result.

> Seller routes only work for accounts on the **seller allow-list**. Others get `403 FORBIDDEN`. To be added, ask the operator.

## 6. Buyer guide

1.  **Browse:** `GET /v1/listings?q=...&limit=20&cursor=...` returns `{ items, next_cursor }`. Each item shows the schema, sample rows, price and evaluator version.

2.  **Prepare a model.** A model is a small JSON file for logistic regression:

    ``` json
    { "features": ["age", "glucose"], "weights": [0.03, 0.04], "bias": -5.1 }
    ```

    The feature names must match the listing's schema. Extra keys are rejected.

3.  **Seal and upload it** the same way as the dataset, with `role: "model"`, to `POST /v1/listings/:id/models`. The response contains your `model_id`.

4.  **Run it:** `POST /v1/listings/:id/evaluate` with `{"model_id":"..."}`.
    - First call (no payment) returns **402** with a quote.
    - Sign the payment for exactly that quote and call again with `X-Payment: <base64 JSON>`.
    - You get **200** with the result, or **202** with a `location` to poll.

5.  **Read the result:** `GET /v1/runs/:id` until `state` is final (`SETTLED`, `FAILED_NOT_CHARGED` or `PAYMENT_REJECTED`), then `GET /v1/runs/:id/receipt`.

### The 402 quote

``` json
{ "x402Version": 1,
  "accepts": [{
    "scheme": "exact", "network": "near:testnet", "asset": "near",
    "maxAmountRequired": "10000000000000000000000",
    "payTo": "seller.testnet",
    "assetContract": "wrap.testnet",
    "resource": "/v1/listings/lst_123/evaluate",
    "validUntil": "2026-11-14T12:15:00.000Z",
    "nonce": "..." }] }
```

The quote is valid for 15 minutes. The `nonce` is single-use, so a payment can never be applied twice.

### The result

``` json
{ "run_id": "run_...", "mode": "local",
  "result": { "metrics": { "accuracy": 0.89, "auc": 0.96, "f1": 0.92 }, "n_bucket": "200-499" },
  "receipt": { "exec_tx": "...", "settle_tx": "67fYJJ...", "wasm_hash": "3fed6a...", "attested": false } }
```

The exact number of rows is hidden on purpose; you only see a size bucket. `settle_tx` is the real blockchain transaction you can look up in a NEAR explorer.

## 7. Payments

- **Token:** payment is made in **wNEAR** (wrapped NEAR, `wrap.testnet`). It is 1:1 with NEAR. It exists because the buyer's money must be taken from their token balance, not from the service.
- **What you sign:** a NEP-366 *delegate action* that calls `ft_transfer` on wNEAR for exactly the quoted amount to the seller. You do not submit anything. The service submits it **after** the score is ready and pays the gas (about 0.0002 NEAR).
- **Buyer needs wNEAR.** If you only hold NEAR, the SDK can wrap it for you (`autoWrapNear: true`); this spends your NEAR. Otherwise call `near_deposit` on `wrap.testnet` yourself.
- **Seller one-time setup:** the seller account must be registered on the token contract (NEP-145 `storage_deposit` on `wrap.testnet`). Otherwise payments to it fail verification.
- **Safety:** the service checks the signature, that your key is really on your account, your balance, the seller's registration and the expiry before doing any work. Replaying a payment returns the same run and does not charge again.
- **Failed runs are free.** You are only charged once a result exists.

> **Not supported yet:** Sepolia/EVM USDC. Only NEAR testnet payments work today.

## 8. Run states and honesty labels

| State | Meaning |
|----|----|
| `REQUESTED` … `QUEUED` … `EXECUTING` | Payment accepted and the run is in progress. Keep polling. |
| `RESULT_READY`, `SETTLE_PENDING` | Score is ready; the payment is being settled. |
| `SETTLED` | **Success.** Result and receipt are available. |
| `FAILED_NOT_CHARGED` | The run failed. Nothing was charged. See `error_code`. |
| `PAYMENT_REJECTED` | The payment did not verify. Nothing was charged. |

`mode` is `local` today: the evaluator is a normal program on the operator's server. Runs are only labelled `attested` (`true`) when a hardware-secured enclave produced them. Today `attested` is always `false`, so trust the operator accordingly.

## 9. Errors

Every error has the same shape: `{ "error": { "code": "...", "message": "...", "retryable": true|false } }`. Branch on `code`, not on the message.

| HTTP | Code | What to do |
|----|----|----|
| 401 | `UNAUTHENTICATED` | Log in again. Token missing, bad or expired, or the login proof failed. |
| 403 | `FORBIDDEN` / `NOT_OWNER` | Not allowed: not on the seller allow-list, or not the owner of the listing. |
| 403 | `BUDGET_EXHAUSTED` | You used this listing's lifetime run budget. |
| 404 | `LISTING_NOT_FOUND` / `MODEL_NOT_FOUND` | Wrong id. Runs of other users also return 404. |
| 402 | `PAYMENT_REQUIRED` / `PAYMENT_INVALID` / `PAYMENT_EXPIRED` | Pay the quote, or fix the payment (the message says why, for example insufficient balance). Expired: ask for a new quote. |
| 409 | `PAYMENT_REUSED`, `CONFLICT`, `LISTING_NOT_PUBLISHED`, `MODEL_BOUND_TO_OTHER_LISTING` | The request conflicts with current state. |
| 413 | `ASSET_TOO_LARGE` | File over 1 MiB. |
| 422 | `VALIDATION_FAILED`, `ENVELOPE_INVALID`, `UNWRAP_FAILED`, `DECRYPT_FAILED` | Bad request body or bad encryption. Re-seal with the right listing, role and evaluator version. |
| 429 | `RATE_LIMITED` | Slow down; retry later. |
| 500 | `INTERNAL` | Retry; if it persists, contact the operator. |

A run can also end with `error_code` such as `DATA_UNUSABLE` or `MODEL_UNUSABLE` (the files decrypted but could not be scored, for example the model's features do not match). These are never charged.

## 10. Building a frontend

- The API allows browser calls from any origin for now. Once your frontend has a domain, ask the operator to restrict it.
- Do the NEP-413 signing with a NEAR wallet (for example via wallet selector's `signMessage`); never ask users to paste private keys.
- Keep the token in memory or session storage, and send it as `Authorization: Bearer`.
- **Live progress:** `GET /v1/runs/:id/events` streams updates (Server-Sent Events). The browser's built-in `EventSource` cannot send an `Authorization` header, so read the stream with `fetch` and a stream reader, or simply poll `GET /v1/runs/:id` every 1–3 seconds.
- The browser must never contain the evaluator's private key, only its public key.

## 11. Going live checklist

| Who | Check |
|----|----|
| Everyone | NEAR account with a full-access key; testnet NEAR from a faucet. |
| Seller | Account on the allow-list · registered on `wrap.testnet` · dataset CSV matches the schema · sealed with the current evaluator version. |
| Buyer | wNEAR balance ≥ price (or `autoWrapNear`) · model JSON uses the listing's feature names · sealed with `role: "model"`. |
| Both | Never log or send a private key. Handle `401` by logging in again. Treat `retryable: false` errors as final. |

Questions about the allow-list, limits or restricting CORS go to the service operator.
