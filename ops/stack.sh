# Sourced by ops/live-e2e.sh and ops/demo.sh. Expects to run from the repo root.

stack_build_local_evaluator() {
  echo "== building the Rust evaluator (release)"
  # A root-owned ~/.cargo (e.g. rustup installed with sudo) can't hold the crate cache; use a local one instead.
  if [ -z "${CARGO_HOME:-}" ] && [ ! -w "${HOME}/.cargo" ]; then export CARGO_HOME="$PWD/.live/cargo-home"; fi
  cargo build --release --quiet --manifest-path crates/evaluator/Cargo.toml
  export EVALUATOR_MODE=local
  export EVALUATOR_BIN="$PWD/crates/evaluator/target/release/evaluator"
  EVALUATOR_WASM_HASH="$(shasum -a 256 "$EVALUATOR_BIN" | awk '{print $1}')"
  export EVALUATOR_WASM_HASH
}

stack_generate_evaluator_keys() {
  eval "$(node -e '
const { generateEvaluatorKeypair } = require("./packages/crypto/dist");
const { publicKey, privateKey } = generateEvaluatorKeypair();
console.log(`export EVALUATOR_PRIVATE_KEY=${privateKey.toString("base64")}`);
console.log(`export EVALUATOR_PUBLIC_KEY_B64=${publicKey.toString("base64")}`);
')"
}

stack_build_backend() {
  echo "== building packages"
  npm run build:libs --silent >/dev/null
  npm run build --silent -w @securelambda/api -w @securelambda/worker >/dev/null
}

stack_migrate_seed() {
  echo "== migrating and seeding"
  npm run prisma:migrate:deploy --silent --workspace=@securelambda/db >/dev/null
  export TS_NODE_PROJECT="$PWD/ops/tsconfig.json"
  npx ts-node ops/seed.ts >/dev/null
}

# Sets API_PID and WORKER_PID for the caller's cleanup trap.
stack_start_services() {
  echo "== starting API (:$API_PORT) and worker"
  node apps/api/dist/main.js >.live/api.log 2>&1 & API_PID=$!
  node apps/worker/dist/main.js >.live/worker.log 2>&1 & WORKER_PID=$!
  for _ in $(seq 1 40); do curl -sf "http://localhost:$API_PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf "http://localhost:$API_PORT/healthz" >/dev/null || { echo "API did not start; see .live/api.log"; tail -20 .live/api.log; exit 1; }
}
