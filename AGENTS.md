# AGENTS.md

How to check that SecureLambda runs and does what the README says. Requirements: Node.js 20+, npm, Docker; Rust only for the evaluator tests.

## See a paid run (one command)

```bash
npm install
npm run demo
```

Needs Docker and Rust (`cargo`), no NEAR account. It starts throwaway Postgres, Redis and MinIO containers on ports 55433, 56380 and 59000 (override with `DEMO_PG_PORT`, `DEMO_REDIS_PORT`, `DEMO_MINIO_PORT`; the API uses `DEMO_API_PORT`, default 3918), then drives one run through the public API:

- the seller encrypts a dataset client-side, uploads and publishes it; the object in MinIO is ciphertext
- the buyer encrypts and uploads a model
- the unpaid request gets an x402 `402` quote; a payment signed by the wrong key is refused
- a signed payment is accepted, the real Rust evaluator scores the run, and the payment settles to the seller once, even when replayed
- the metrics are recomputed independently in TypeScript

Expect `ALL 22 CHECKS PASSED` with `accuracy 0.89`, `auc 0.96`, `f1 0.92`, labelled `mode=local`. Payments here settle on a sandbox ledger in Redis instead of NEAR, and login uses the development header mode; the containers are removed when it exits.

## Run the services yourself

```bash
npm install
docker compose up -d postgres redis minio
cp ops/.env.example .env && set -a && . ./.env && set +a
npm run build --workspace=@securelambda/db
npm run prisma:migrate:deploy --workspace=@securelambda/db
npx ts-node ops/seed.ts
npm run build
```

If a host port (5432, 6379, 9000) is already taken, map the service to another port in a `docker-compose.override.yml` and change the matching URL in `.env`.

Then, each in its own shell with `.env` sourced:

| Command | Expect |
|---|---|
| `npm run start --workspace=@securelambda/api` | `Nest application successfully started`; `GET http://localhost:3000/healthz` returns 200 |
| `npm run start --workspace=@securelambda/worker` | `worker listening on queue "runs"` |
| `npm run dev:mock --workspace=@securelambda/dashboard` | Dashboard on http://localhost:3001 with mock listings |
| `bash ops/preflight.sh` | Every check runs; with the API up and the containers running, no `FAIL` lines |

## Test it

```bash
npm run test --workspaces --if-present
(cd crates/evaluator && cargo test)
```

Expect 345 passing tests: 304 TypeScript (3 more are skipped without a NEAR key) and 41 Rust.

## What needs testnet credentials

Settling on NEAR testnet needs funded accounts, and the enclave path needs an OutLayer project. The evidence for both is committed:

- [`docs/pr-evidence/outlayer-enclave-run.md`](docs/pr-evidence/outlayer-enclave-run.md): a paid run evaluated in OutLayer, with execution and settlement transactions on NEAR testnet
- [`docs/pr-evidence/live-e2e-output.txt`](docs/pr-evidence/live-e2e-output.txt): the full end-to-end script output for a paid run with the local evaluator (32 checks)
- The public dashboard at https://secure-lambda402.vercel.app runs against the live testnet API
