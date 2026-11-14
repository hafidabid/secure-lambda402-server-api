#!/usr/bin/env bash
# One paid evaluation run on this machine, no testnet account needed: throwaway Postgres, Redis and
# MinIO containers, the real Rust evaluator, header auth and the sandbox payment ledger.
set -euo pipefail
cd "$(dirname "$0")/.."
. ops/stack.sh

command -v docker >/dev/null || { echo "docker is required"; exit 1; }
command -v cargo >/dev/null || { echo "cargo (Rust) is required for the local evaluator: https://rustup.rs"; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund
mkdir -p .live

PG_PORT="${DEMO_PG_PORT:-55433}"; REDIS_PORT="${DEMO_REDIS_PORT:-56380}"; MINIO_PORT="${DEMO_MINIO_PORT:-59000}"; API_PORT="${DEMO_API_PORT:-3918}"
CONTAINERS="sl-demo-postgres sl-demo-redis sl-demo-minio"
docker rm -f $CONTAINERS >/dev/null 2>&1 || true
docker run -d --name sl-demo-postgres -e POSTGRES_USER=securelambda -e POSTGRES_PASSWORD=securelambda \
  -e POSTGRES_DB=securelambda -p "$PG_PORT:5432" postgres:16-alpine >/dev/null
docker run -d --name sl-demo-redis -p "$REDIS_PORT:6379" redis:7-alpine >/dev/null
docker run -d --name sl-demo-minio -e MINIO_ROOT_USER=securelambda -e MINIO_ROOT_PASSWORD=securelambda123 \
  -p "$MINIO_PORT:9000" pgsty/minio:RELEASE.2026-08-04T00-00-00Z server /data >/dev/null
API_PID=""; WORKER_PID=""
cleanup() {
  for pid in $API_PID $WORKER_PID; do kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null || true; done
  docker rm -f $CONTAINERS >/dev/null 2>&1 || true
}
trap cleanup EXIT
for _ in $(seq 1 40); do docker exec sl-demo-postgres pg_isready -U securelambda >/dev/null 2>&1 && break; sleep 1; done
for _ in $(seq 1 40); do docker exec sl-demo-minio mc ready local >/dev/null 2>&1 && break; sleep 1; done

unset NODE_ENV
export PORT="$API_PORT" API_URL="http://localhost:$API_PORT"
export DATABASE_URL="postgres://securelambda:securelambda@localhost:$PG_PORT/securelambda"
export REDIS_URL="redis://localhost:$REDIS_PORT"
export STORAGE_ENDPOINT="http://localhost:$MINIO_PORT" STORAGE_ACCESS_KEY=securelambda STORAGE_SECRET_KEY=securelambda123
export STORAGE_BUCKET=securelambda-demo STORAGE_REGION=us-east-1
export AUTH_MODE=header FACILITATOR_MODE=sandbox RATE_LIMIT_PER_IP_PER_MINUTE=600
export SEED_SELLER_ID=clinic.demo SEED_BUYER_ID=lab.demo SEED_RELAYER_ID=relayer.demo

stack_build_local_evaluator
stack_build_backend
stack_generate_evaluator_keys
stack_migrate_seed
stack_start_services

npx ts-node ops/demo.ts
