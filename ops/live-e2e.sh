#!/usr/bin/env bash
# Full live run: real Postgres/Redis (throwaway containers), real R2, real NEAR testnet payment,
# real Rust evaluator. Reads credentials from ./secret (gitignored) and never prints them.
#
#   ops/live-e2e.sh            # run everything
#   KEEP_OBJECTS=1 ops/live-e2e.sh   # leave the uploaded R2 objects in place
set -euo pipefail
cd "$(dirname "$0")/.."

SECRET_FILE="${SECRET_FILE:-secret}"
[ -f "$SECRET_FILE" ] || { echo "missing $SECRET_FILE (see ops/runbook.md, 'Live testnet run')"; exit 1; }
command -v docker >/dev/null || { echo "docker is required"; exit 1; }
[ "${EVALUATOR_BACKEND:-local}" = "outlayer" ] || command -v cargo >/dev/null || { echo "cargo (Rust) is required for the local evaluator"; exit 1; }

set -a; . "./$SECRET_FILE"; set +a
mkdir -p .live

# --- throwaway infra on unusual ports, so nothing local is touched ---------------------------
PG_PORT=55432; REDIS_PORT=56379; API_PORT="${API_PORT:-3917}"
docker rm -f sl-e2e-postgres sl-e2e-redis >/dev/null 2>&1 || true
docker run -d --name sl-e2e-postgres -e POSTGRES_USER=securelambda -e POSTGRES_PASSWORD=securelambda \
  -e POSTGRES_DB=securelambda -p "$PG_PORT:5432" postgres:16-alpine >/dev/null
docker run -d --name sl-e2e-redis -p "$REDIS_PORT:6379" redis:7-alpine >/dev/null
API_PID=""; WORKER_PID=""
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null || true
  docker rm -f sl-e2e-postgres sl-e2e-redis >/dev/null 2>&1 || true
}
trap cleanup EXIT
for _ in $(seq 1 40); do docker exec sl-e2e-postgres pg_isready -U securelambda >/dev/null 2>&1 && break; sleep 1; done

# --- configuration (values come from ./secret; none are echoed) -------------------------------
RELAYER="${NEAR_RELAYER_ACCOUNT:-irjenpro.testnet}"
export NODE_ENV=development PORT="$API_PORT" API_URL="http://localhost:$API_PORT"
export DATABASE_URL="postgres://securelambda:securelambda@localhost:$PG_PORT/securelambda"
export REDIS_URL="redis://localhost:$REDIS_PORT"
export STORAGE_ENDPOINT="$S3_ENDPOINT_URL" STORAGE_ACCESS_KEY="$S3_ACCESS_KEY_ID" STORAGE_SECRET_KEY="$S3_SECRET_ACCESS_KEY"
export STORAGE_BUCKET="$S3_BUCKET" STORAGE_REGION="${S3_REGION:-auto}"
export STORAGE_KEY_PREFIX="${S3_KEY_PREFIX:-securelambda}/live-e2e/$(date +%s)"
export NEAR_NETWORK=testnet NEAR_RPC_URL="${NEAR_RPC_URL:-https://test.rpc.fastnear.com}"
export FACILITATOR_MODE=near RELAYER_ACCOUNT="$RELAYER" RELAYER_KEY="$NEAR_ACCOUNT_PRIVATE_KEY"
export PAYMENT_TOKEN_CONTRACT="${PAYMENT_TOKEN_CONTRACT:-wrap.testnet}"
export SEED_RELAYER_ID="$RELAYER" SEED_SELLER_ID="seller.$RELAYER" SEED_BUYER_ID="buyer.$RELAYER"
export AUTH_MODE=signed SELLER_ALLOW_LIST="$SEED_SELLER_ID" RATE_LIMIT_PER_IP_PER_MINUTE=600

# --- the evaluator: a local binary (default) or the real OutLayer TEE ------------------------
#   EVALUATOR_BACKEND=outlayer ops/live-e2e.sh
# needs the OutLayer project deployed (see ops/runbook.md, "Run the evaluator in OutLayer"), and
#   OUTLAYER_WASM_HASH   sha256 of the deployed evaluator.wasm
#   OUTLAYER_PROJECT     owner/name of the project            (default hafidbuild.testnet/secure-lambda-evaluator)
#   OUTLAYER_SIGNER_ACCOUNT / OUTLAYER_SIGNER_KEY   account that pays for requests (key read from ~/.near-credentials if unset)
#   EVALUATOR_KEYS_FILE  JSON with EVALUATOR_PUBLIC_KEY       (default ~/.secure-lambda/evaluator-testnet.json)
if [ "${EVALUATOR_BACKEND:-local}" = "outlayer" ]; then
  : "${OUTLAYER_WASM_HASH:?set OUTLAYER_WASM_HASH to the sha256 of the deployed evaluator.wasm}"
  KEYS_FILE="${EVALUATOR_KEYS_FILE:-$HOME/.secure-lambda/evaluator-testnet.json}"
  export EVALUATOR_MODE=outlayer
  export OUTLAYER_PROJECT="${OUTLAYER_PROJECT:-hafidbuild.testnet/secure-lambda-evaluator}"
  export OUTLAYER_SIGNER_ACCOUNT="${OUTLAYER_SIGNER_ACCOUNT:-worker.hafidbuild.testnet}"
  if [ -z "${OUTLAYER_SIGNER_KEY:-}" ]; then
    OUTLAYER_SIGNER_KEY="$(node -e 'console.log(require(process.env.HOME + "/.near-credentials/testnet/" + process.env.OUTLAYER_SIGNER_ACCOUNT + ".json").private_key)')"
    export OUTLAYER_SIGNER_KEY
  fi
  export EVALUATOR_WASM_HASH="$OUTLAYER_WASM_HASH" EVALUATOR_PROJECT_ID="$OUTLAYER_PROJECT"
  EVALUATOR_PUBLIC_KEY_B64="$(KEYS_FILE="$KEYS_FILE" node -e 'console.log(require(process.env.KEYS_FILE).EVALUATOR_PUBLIC_KEY)')"
  export EVALUATOR_PUBLIC_KEY_B64
else
  echo "== building the Rust evaluator (release)"
  # A root-owned ~/.cargo (e.g. rustup installed with sudo) can't hold the crate cache; use a local one instead.
  if [ -z "${CARGO_HOME:-}" ] && [ ! -w "${HOME}/.cargo" ]; then export CARGO_HOME="$PWD/.live/cargo-home"; fi
  cargo build --release --quiet --manifest-path crates/evaluator/Cargo.toml
  export EVALUATOR_MODE=local
  export EVALUATOR_BIN="$PWD/crates/evaluator/target/release/evaluator"
  export EVALUATOR_WASM_HASH="$(shasum -a 256 "$EVALUATOR_BIN" | awk '{print $1}')"
  eval "$(node -e '
const { generateEvaluatorKeypair } = require("./packages/crypto/dist");
const { publicKey, privateKey } = generateEvaluatorKeypair();
console.log(`export EVALUATOR_PRIVATE_KEY=${privateKey.toString("base64")}`);
console.log(`export EVALUATOR_PUBLIC_KEY_B64=${publicKey.toString("base64")}`);
')"
fi

echo "== building packages, migrating and seeding"
npm run build --silent >/dev/null
npm run prisma:migrate:deploy --silent --workspace=@securelambda/db >/dev/null
export TS_NODE_PROJECT="$PWD/ops/tsconfig.json"
npx ts-node ops/seed.ts >/dev/null

echo "== starting API (:$API_PORT) and worker"
node apps/api/dist/main.js >.live/api.log 2>&1 & API_PID=$!
node apps/worker/dist/main.js >.live/worker.log 2>&1 & WORKER_PID=$!
for _ in $(seq 1 40); do curl -sf "http://localhost:$API_PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://localhost:$API_PORT/healthz" >/dev/null || { echo "API did not start; see .live/api.log"; tail -20 .live/api.log; exit 1; }

NEAR_ACCOUNT_PRIVATE_KEY="$NEAR_ACCOUNT_PRIVATE_KEY" npx ts-node ops/live-e2e.ts
