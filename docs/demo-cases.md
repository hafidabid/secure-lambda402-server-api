# Demo cases

What to show, and where the data for it comes from. Two sources:

- **Mock mode** (`npm run dev:mock` in `apps/dashboard`): no backend, no wallet, nothing real. Everything below marked **mock** works offline, and on a Vercel preview with `NEXT_PUBLIC_API_MOCKING=enabled`.
- **Real backend** (`ops/seed-demo.ts`): listings and runs created through the live API, scored in the real OutLayer enclave, paid in testnet NEAR. Everything marked **real** is a true record.

## Catalogue (the `/listings` page)

| Listing | Seller | Price | Why it is there |
|---|---|---|---|
| Diabetes risk, Hospital A | hospital | 0.02 NEAR | The canonical persona and the best first demo |
| Sepsis early warning, ICU cohort | hospital | 0.05 NEAR | Most expensive; rare positive class (20%); tight limits (5 runs a day) |
| Diabetic retinopathy screening | hospital | 0.03 NEAR | A second dataset from the same seller |
| Heart failure readmission | clinic | 0.03 NEAR | A second seller |
| COPD 30-day readmission | clinic | 0.015 NEAR | Cheapest; generous limits (20 runs a day) |

Search for "diabetes" to show that the filter returns two listings. All data is synthetic and generated from a fixed seed (`ops/demo-data.ts`).

## Cases

| # | Case | Show | Mock | Real |
|---|---|---|---|---|
| 1 | **Happy path** | Pick a listing, upload a model, pay, watch Authorised → Paid → Attested → Result | `?scenario=happy` (about 8 s) | Run 1: medai on Diabetes, accuracy 0.88, AUC 0.94 |
| 2 | **Good model vs weak model** | Same data, two buyers, very different scores. The seller never sees either model | not shown (mock scores are fixed per run) | Runs 1 and 2: 0.88 vs 0.59 accuracy |
| 3 | **Enclave attested** | "Enclave mode" and the attested badge, only when the wasm hash matched | `?scenario=enclave`; `run_demo_settled_enclave` | Every real run (`mode=enclave`, hash `66cb5fc5…`) |
| 4 | **Local mode, never attested** | A replay on the operator's machine is labelled local, not attested | `run_demo_settled_local` | not reproducible on the live server |
| 5 | **Slow run** | "Taking longer than usual" is a status, not a failure | `?scenario=slow`; `run_demo_slow` (polling, retried once) | Real runs take 1-2 minutes, so this shows naturally |
| 6 | **Failed run, never charged** | The evaluator rejected the model; the buyer pays nothing | `?scenario=fail`; `run_demo_failed` | n/a (a real failure would need a bad model) |
| 7 | **Payment refused** | A payment that does not match the quote is refused before any work | `?scenario=rejected`; `run_demo_rejected` | The live E2E proves a forged payment gets HTTP 402 |
| 8 | **Rate limited** | A buyer over the per-day limit is told to wait | `?scenario=ratelimited` | n/a |
| 9 | **Instant result** | The 200 response with the result inline, no polling | `?scenario=instant` | n/a |
| 10 | **Run in progress** | A run that is executing right now, and one queued | `run_demo_running`, `run_bioscore_02` | n/a |
| 11 | **Payment settling** | Result is ready, the on-chain settlement is still being retried | `run_cardiocode_01` (`SETTLE_PENDING`) | n/a |
| 12 | **Seller view** | "Runs on your data": who ran what and when, never their model or score. Sign in as `hospital.testnet` (8 runs, 5 states) or `clinic.testnet` (3 runs) | yes | The seller's runs after the seed |
| 13 | **Buyer history** | The demo buyer's own runs, one in every state. Sign in as `medai.testnet` | 6 runs | The buyer's runs after the seed |
| 14 | **Empty state** | "No runs yet" for a seller with no history | not shown (both mock sellers have history) | a seller account before its first run |
| 15 | **Sell flow** | Seal a dataset in the browser and publish. `samples/glucose/` is ready to upload | works in mock | works against the live API |
| 16 | **Access control** | A typed account header is refused; one buyer cannot read another's run | n/a | The live E2E checks all of this (32 checks) |

Mock accounts: sellers are `hospital.testnet` and `clinic.testnet` (the mock allow-list); the demo buyer is `medai.testnet`.

## Seeding the real backend

```bash
# 1. See the plan without touching anything
DRY_RUN=1 npx ts-node ops/seed-demo.ts

# 2. Listings only (no payments)
API_URL=https://secure-lambda-api.projectdeadwood.my.id SEED_RUNS=0 npx ts-node ops/seed-demo.ts

# 3. Listings and the four paid runs (about 8 minutes; each run is 1-2 minutes in the enclave)
API_URL=https://secure-lambda-api.projectdeadwood.my.id npx ts-node ops/seed-demo.ts
```

What it needs:

- Four NEAR testnet accounts with full-access keys: two sellers (`DEMO_HOSPITAL`, `DEMO_CLINIC`) and two buyers (`DEMO_MEDAI`, `DEMO_PHARMALAB`). Defaults are `<name>.hafidbuild.testnet`; keys are read from `~/.near-credentials/testnet/<account>.json`, or from `NEAR_ACCOUNT_PRIVATE_KEY` when one key controls all four.
- Both sellers on the API's `SELLER_ALLOW_LIST`.
- Buyers funded with native NEAR: each run costs the listing price plus about 0.01 NEAR of gas and wrapping, so 1 NEAR per buyer is plenty.

Safe to re-run. A listing whose name already exists is reused and runs are only made for listings the invocation created (`FORCE_RUNS=1` overrides). Nothing is deleted. If a run fails partway, the script reports it and continues; the exit code is non-zero.

Each real run is checked against metrics computed independently in TypeScript (tolerance 0.0101, from the evaluator's 2-decimal rounding). A mismatch is reported as a problem.

## Honest limits

- Real runs are real testnet payments and real enclave executions, so they are slow (1-2 minutes) and use testnet NEAR.
- The real backend has no way to produce a "failed run" or "rate limited" state on demand; those cases are mock-only.
- Mock history is fixed: its states never advance, and "2 minutes ago" is relative to page load.
