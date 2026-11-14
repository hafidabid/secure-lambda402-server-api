# AGENTS.md

How to check that SecureLambda runs and does what the README says. Requirements: Node.js 20+, npm, Docker; Rust only for the evaluator tests.

## Run it

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

A paid run needs funded NEAR testnet accounts and, for the enclave path, an OutLayer project. The committed defaults use mock evaluation and a sandbox payment ledger, and login (`AUTH_MODE=signed`) checks keys against NEAR RPC, so a paid run cannot be completed locally without those accounts. The evidence is committed instead:

- [`docs/pr-evidence/outlayer-enclave-run.md`](docs/pr-evidence/outlayer-enclave-run.md): a paid run evaluated in OutLayer, with execution and settlement transactions on NEAR testnet
- [`docs/pr-evidence/live-e2e-output.txt`](docs/pr-evidence/live-e2e-output.txt): the full end-to-end script output for a paid run with the local evaluator (32 checks)
- The public dashboard at https://secure-lambda402.vercel.app runs against the live testnet API
