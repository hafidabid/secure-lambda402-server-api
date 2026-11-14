# SecureLambda Endpoint Reference

Every endpoint of the SecureLambda API, with requests, responses and errors

Base URL: `https://secure-lambda-api.projectdeadwood.my.id`  ·  Companion document: *Integration Guide*

## All endpoints

| Method | Path | Access | Purpose |
|----|----|----|----|
| **GET** | `/healthz` | None | Liveness |
| **GET** | `/readyz` | None | Readiness (DB + Redis) |
| **GET** | `/v1/evaluator` | None | Evaluator version and public key |
| **POST** | `/v1/auth/challenge` | None | Start login |
| **POST** | `/v1/auth/login` | None | Finish login, get token |
| **POST** | `/v1/auth/logout` | Login | End session |
| **GET** | `/v1/listings` | None | Search published listings |
| **GET** | `/v1/listings/:id` | Optional login | One listing |
| **POST** | `/v1/listings` | Login + seller allow-list | Create draft listing |
| **PATCH** | `/v1/listings/:id` | Login + seller allow-list | Edit listing |
| **POST** | `/v1/listings/:id/dataset` | Login + seller allow-list | Upload encrypted dataset |
| **POST** | `/v1/listings/:id/publish` | Login + seller allow-list | Publish listing |
| **GET** | `/v1/seller/runs` | Login | Runs on my listings |
| **POST** | `/v1/listings/:id/models` | Login | Upload encrypted model |
| **POST** | `/v1/listings/:id/evaluate` | Login | Run a model (402 then pay) |
| **GET** | `/v1/runs/:id` | Login | Run state and result |
| **GET** | `/v1/runs/:id/receipt` | Login | Run receipt |
| **GET** | `/v1/runs/:id/events` | Login | Live run updates (SSE) |

### Access levels

| Access | What you need |
|----|----|
| **None** | Nothing. |
| **Optional login** | Works without login. A valid token lets owners see their own drafts. |
| **Login** | `Authorization: Bearer <token>` from `/v1/auth/login`. Otherwise `401 UNAUTHENTICATED`. |
| **Login + seller allow-list** | Login, and your account must be on the seller allow-list. Otherwise `403 FORBIDDEN`. |

> Do not send `x-account-id`. It is ignored. Identity comes only from the bearer token. A bad or expired token returns `401` on any route, even public ones.

### Common conventions

- JSON in and out, `snake_case` field names (except the payment objects, which keep the x402 standard's `camelCase`).
- Prices and amounts are integer **strings** in base units (wNEAR has 24 decimals).
- Errors: `{ "error": { "code", "message", "retryable" } }`. The full list of codes is in the Integration Guide, section 9.
- File uploads are limited to 1 MiB and must be sealed with the evaluator's public key (see the Integration Guide, sections 5 and 6).

## Health and discovery

### GET /healthz *(public)*

Liveness check. Use it for uptime monitors.

**Response**

``` json
{ "ok": true }
```

### GET /readyz *(public)*

Readiness check. Verifies the database and Redis are reachable.

**Response**

``` json
{ "ok": true }
```

**Errors:** `503` if a dependency is down.

### GET /v1/evaluator *(public)*

The active evaluator build. Encrypt datasets and models to its `public_key`.

**Response**

``` json
{ "version": "1.0.0", "project_id": "securelambda/local-evaluator",
  "wasm_hash": "3fed6aac...", "public_key": "ICkMWdD7...=", "trust_tier": 1 }
```

## Login

### POST /v1/auth/challenge *(public)*

Step 1 of login. Returns a one-time challenge to sign (NEP-413). Valid for 5 minutes, usable once.

**Request**

``` json
{ "account_id": "buyer.testnet" }
```

**Response**

``` json
{ "nonce": "<base64 of 32 bytes>", "message": "Log in to SecureLambda as buyer.testnet",
  "recipient": "securelambda-api", "expires_in": 300 }
```

**Errors:** `422 VALIDATION_FAILED` for a malformed account id.

### POST /v1/auth/login *(public)*

Step 2. Exchanges the signed challenge for a session token. The signing key must be a full-access key of the account (checked on the blockchain). The first login creates the account.

**Request**

``` json
{ "account_id": "buyer.testnet", "public_key": "ed25519:...",
  "signature": "<base64 of 64 bytes>", "nonce": "<nonce from step 1>" }
```

**Response**

``` json
{ "token": "<opaque string>", "account_id": "buyer.testnet", "expires_in": 3600 }
```

**Errors:** `401 UNAUTHENTICATED` for an unknown or used challenge, a wrong signature, or a key that is not a full-access key of that account.

### POST /v1/auth/logout *(login required)*

Ends the session behind the bearer token.

**Response**

`204 No Content`

## Listings (seller)

### POST /v1/listings *(login + seller allow-list)*

Creates a draft listing.

**Request**

``` json
{ "name": "Diabetes screening set",
  "schema": { "task": "binary_classification",
              "features": [{ "name": "age", "type": "int" }, { "name": "glucose", "type": "float" }],
              "label": "y" },
  "sample_rows": [ {"age":45,"glucose":98.2,"y":0}, ... exactly 5 synthetic rows ... ],
  "price_amount": "10000000000000000000000",
  "price_asset": "near",
  "rules": { "min_rows": 100, "min_class_count": 20, "round": 2,
             "metrics": ["accuracy","auc","f1"], "runs_per_day": 20, "lifetime_budget": 100 },
  "evaluator_version": "1.0.0" }
```

`price_amount` is a positive integer string in token base units. `sample_rows` must be exactly 5 made-up rows. `min_rows` is 50 to 1,000,000; `round` is 0 to 6.

**Response**

`201 Created`

``` json
{ "id": "lst_...", "seller_id": "seller.testnet", "name": "...", "schema": {...}, "sample_rows": [...],
  "price_amount": "10000000000000000000000", "price_asset": "near", "rules": {...},
  "evaluator_version": "1.0.0", "dataset_asset_id": null, "status": "draft",
  "created_at": "...", "published_at": null }
```

**Errors:** `401`, `403 FORBIDDEN` (not on the allow-list), `422 VALIDATION_FAILED`.

### PATCH /v1/listings/:id *(login + seller allow-list)*

Edits your own draft or paused listing. Send only the fields to change (same fields as create). A published listing must be paused first.

**Response**

`200` with the updated listing.

**Errors:** `403` not the owner, `404`, `409 CONFLICT` if it is published.

### POST /v1/listings/:id/dataset *(login + seller allow-list)*

Uploads the encrypted dataset. Multipart form with two fields: `ciphertext` (file, max 1 MiB) and `wrapped_key` (the JSON envelope from `sealFile`). Uploading the same file again is safe (idempotent).

**Request**

`Content-Type: multipart/form-data`

**Response**

``` json
{ "asset_id": "ast_..." }
```

**Errors:** `413 ASSET_TOO_LARGE`, `422 ENVELOPE_INVALID`, `403` not the owner, `404`.

### POST /v1/listings/:id/publish *(login + seller allow-list)*

Makes the listing public and runnable.

**Response**

`200` with the listing, `status: "published"`.

**Errors:** `409 CONFLICT` if no dataset is uploaded, `403` not the owner.

### GET /v1/seller/runs *(login required)*

Runs on your listings, newest first. Shows no results or models.

**Response**

``` json
[ { "id": "run_...", "buyer_id": "buyer.testnet", "state": "SETTLED", "created_at": "..." } ]
```

## Listings (browse)

### GET /v1/listings *(public)*

Search published listings. Query: `q` (text search), `limit` (1 to 100, default 20), `cursor` (from `next_cursor`).

**Response**

``` json
{ "items": [ { "id": "lst_...", "name": "...", "schema": {...}, "sample_rows": [...],
             "price_amount": "...", "price_asset": "near", "evaluator_version": "1.0.0", "status": "published" } ],
  "next_cursor": "..." | null }
```

### GET /v1/listings/:id *(login optional)*

One listing. Published listings are public. A draft is visible only to its owner (others get 404).

**Response**

`200` with the listing.

**Errors:** `404 LISTING_NOT_FOUND`.

## Buying and running

### POST /v1/listings/:id/models *(login required)*

Uploads your encrypted model. Multipart form with `ciphertext` (file, max 1 MiB) and `wrapped_key` (JSON envelope, sealed with `role: "model"`). The model file is JSON: `{ "features": [...], "weights": [...], "bias": 0 }`.

**Request**

`Content-Type: multipart/form-data`

**Response**

``` json
{ "model_id": "mdl_..." }
```

**Errors:** `401`, `404` listing not found, `409 LISTING_NOT_PUBLISHED`, `413`, `422 ENVELOPE_INVALID`.

### POST /v1/listings/:id/evaluate *(login required)*

Runs your model on the listing, with pay-per-run (x402). Call it twice: once to get a quote, once with the payment.

**Request**

**Call 1** (no payment) body, then **Call 2** with the same body plus header `X-Payment: <base64 of the signed payment JSON>`.

``` json
{ "model_id": "mdl_..." }
```

Signed payment JSON (built by the SDK's `createNearPaymentSigner`):

``` json
{ "nonce", "payerId", "payerPublicKey", "payTo", "asset", "amount",
  "validUntil", "maxBlockHeight", "signedDelegate" }
```

**Response**

| HTTP | Meaning | Body |
|----|----|----|
| **402** | Payment needed (call 1) or payment rejected (call 2) | Quote `{ x402Version, accepts: [ ... ] }`, or an error with the reason |
| **200** | Done immediately | `{ run_id, mode, result: { metrics, n_bucket }, receipt }` |
| **202** | Accepted, still running | `{ run_id, location: "/v1/runs/run_..." }`, and a `Location` header |

**Errors:** `401`, `404`, `409 LISTING_NOT_PUBLISHED`, `429 RATE_LIMITED`, `403 BUDGET_EXHAUSTED`, `402 PAYMENT_INVALID / PAYMENT_EXPIRED`, `409 PAYMENT_REUSED`. Sending the same payment again returns the same run and does not charge twice.

### GET /v1/runs/:id *(login required)*

State and result of a run. Only the buyer who started it can read it; anyone else gets 404.

**Response**

``` json
{ "id": "run_...", "listing_id": "lst_...", "buyer_id": "buyer.testnet", "model_id": "mdl_...",
  "state": "SETTLED", "payment_nonce": "...", "attempt": 0, "exec_tx_hash": "...",
  "result": { "metrics": { "accuracy": 0.89, "auc": 0.96, "f1": 0.92 }, "n_bucket": "200-499" },
  "error_code": null, "mode": "local", "created_at": "...", "updated_at": "..." }
```

**Errors:** `401`, `404`. Poll every 1 to 3 seconds until `state` is `SETTLED`, `FAILED_NOT_CHARGED` or `PAYMENT_REJECTED`.

### GET /v1/runs/:id/receipt *(login required)*

Proof of the run: the blockchain transaction that paid for it and the evaluator build that ran it. Buyer only.

**Response**

``` json
{ "exec_tx": "...", "settle_tx": "67fYJJ..." | null, "wasm_hash": "3fed6a...", "attested": false }
```

**Errors:** `settle_tx` is `null` until the payment settles.

### GET /v1/runs/:id/events *(login required)*

Server-Sent Events stream. Sends the run object each second until it reaches a final state, then closes. Buyer only. Browsers' `EventSource` cannot send the `Authorization` header; use `fetch` streaming or poll instead.

**Request**

`Accept: text/event-stream`

**Response**

```text
data: { "id": "run_...", "state": "EXECUTING", ... }

data: { "id": "run_...", "state": "SETTLED", "result": {...}, ... }
```
