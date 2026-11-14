# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 (App Router), React 19, Tailwind v4, motion, radix-ui. Runs against MSW mocks (`npm run dev:mock`) until the API is wired.

## What it is

SecureLambda: pay per run to test a model on data you never see. A data owner seals a dataset, a model builder seals a model, and a Rust evaluator inside a hardware TEE (Intel TDX on OutLayer) scores one against the other. Only rounded metrics leave: `{ accuracy, auc, f1, n_bucket }`. Each run is paid over x402 on NEAR, from a wallet or a buyer agent.

## Users and jobs

- **Hackathon judges (primary for the landing page):** technical reviewers for the NEAR Privacy & Private AI track. They skim fast and need to grasp the mechanism and see that it is real engineering, not a mock-up.
- **Data owners (sellers):** hold data they cannot legally share; list it, set a price, earn per run.
- **Model builders and buyer agents:** score a model on private data; pay per run via wallet or `packages/agent-sdk` (402 → pay → poll).

## Mechanism and position

- Plaintext exists only in the browser that encrypted it and inside the enclave.
- Results are rationed: rounded to 2 dp, row counts bucketed, minimum rows/class, per-buyer daily limit and lifetime budget, degenerate models rejected before payment.
- Payment settles only after a successful, hash-verified run. A failed run is never charged.

## Evidence (true, citable)

- 199 passing tests (161 TS, 38 Rust), several against real Postgres/Redis via Testcontainers.
- Envelope encryption cross-checked byte-for-byte between TypeScript and Rust.
- Open source: github.com/hafidabid/secure-lambda402-server-api.
- OutLayer testnet experiment (docs/SecureLambda_01_Project_Report.pdf, Appendix A): 10 recorded runs with real tx hashes on NEAR testnet, real Intel TDX attestation; reproducible evaluator build, wasm hash `dbe1cdcb…08ac68`.
- Run lifecycle: REQUESTED → PAYMENT_VERIFIED → QUEUED → SUBMITTED → EXECUTING → RESULT_READY → SETTLED; every failure ends FAILED_NOT_CHARGED. User-facing stages: Authorised, Paid, Attested, Result.
- Canonical personas in the docs: "Hospital" (seller, diabetes risk dataset: age, glucose, hba1c, bmi → diabetes) and "MedAI" (buyer).

## Labelling rules (from docs/04)

- "Enclave mode (operator-set key)" only when attestation verified; replays are "Local mode" and never shown as attested.
- UI copy never says "key", "ciphertext" or "secret"; it says "Encrypt and upload" and "Locked to the evaluator".
- "A timeout is not a failure": slow runs say "Taking longer than usual".

## Honesty constraints

- Tier 1 trust: the operator generated the evaluator key once and destroyed the local copy; users must trust that. Tier 2 (in-enclave key) is planned, not built.
- Live NEAR RPC and live OutLayer execution are behind interfaces, not live-wired. The SDK is not on npm.
- Never claim customers, volume, benchmarks, or "100% private".

## Voice

Plain, specific, technically honest. Short sentences. States limitations openly.
