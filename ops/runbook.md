# SecureLambda Operator Runbook

This runbook covers the operational steps needed to build, verify, and deploy the SecureLambda evaluator component and prepare the system for a production run.

## Table of Contents

1. [Build the Evaluator](#build-the-evaluator)
2. [Compute and Record the WASM Hash](#compute-and-record-the-wasm-hash)
3. [Generate and Store the Evaluator Key Pair](#generate-and-store-the-evaluator-key-pair)
4. [Update the EvaluatorVersion](#update-the-evaluatorversion)
5. [Configure OutLayer Deployment](#configure-outlayer-deployment)
6. [Pre-Deployment Verification](#pre-deployment-verification)
7. [Live testnet run](#live-testnet-run)

---

## Build the Evaluator

The SecureLambda evaluator is a Rust program compiled to WebAssembly for reproducible execution in a TEE.

### Prerequisites

- Rust toolchain (install via [rustup](https://rustup.rs/))
- `wasm32-wasip1` target: `rustup target add wasm32-wasip1`

### Build Steps

From the repository root:

```bash
cd crates/evaluator
cargo build --release --target wasm32-wasip1
```

The compiled WASM binary will be placed at:

```
crates/evaluator/target/wasm32-wasip1/release/securelambda_evaluator.wasm
```

**Note:** This build is reproducible; rebuilding on different machines with the same Rust version and dependencies should produce an identical (byte-for-byte) binary. This determinism is critical for attestation verification.

---

## Compute and Record the WASM Hash

After building, compute the SHA256 hash of the WASM binary:

```bash
WASM_PATH="crates/evaluator/target/wasm32-wasip1/release/securelambda_evaluator.wasm"
WASM_HASH=$(sha256sum "$WASM_PATH" | awk '{print $1}')
echo "WASM_HASH=$WASM_HASH"
```

The output will be a 64-character lowercase hex string, e.g.:
```
WASM_HASH=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6...
```

**Store this hash:** it will be recorded in the `EvaluatorVersion.wasmHash` column in the next step, and used during run execution to verify that the same evaluator code executed in the TEE.

---

## Generate and Store the Evaluator Key Pair

The evaluator needs an X25519 key pair for the envelope scheme (docs/03
B7) — this is unrelated to TDX attestation, which is a hardware property
of the enclave, not something this key produces:
- **Private key (`E_priv`):** Used only inside the TEE to unwrap each
  file's K_file from its envelope (`EVALUATOR_PRIVATE_KEY` env var below).
  Never leaves the TEE process.
- **Public key (`E_pub`):** Published in the `EvaluatorVersion.publicKey`
  column so browsers can wrap file keys to it (served at `GET /v1/evaluator`).

Both this system's TypeScript side (`packages/crypto`) and the Rust
evaluator use raw 32-byte X25519 keys, base64-encoded on the wire — not
PEM, and not the DER/SPKI wrapping `openssl genpkey`/`pkey` produce. Do
not use `openssl` for this key pair; it will not interoperate.

### Generate the Key Pair

Use `packages/crypto`'s own key generator, so the format matches exactly
what the Rust evaluator and the rest of the system expect:

```bash
node -e '
const { generateEvaluatorKeypair } = require("./packages/crypto/dist");
const { publicKey, privateKey } = generateEvaluatorKeypair();
console.log("EVALUATOR_PRIVATE_KEY (keep secret):", privateKey.toString("base64"));
console.log("EVALUATOR_PUBLIC_KEY (store in EvaluatorVersion.publicKey):", publicKey.toString("base64"));
'
```

(Run `npm run build --workspace=@securelambda/crypto` first if `packages/crypto/dist` does not exist yet.)

Set the private key as the `EVALUATOR_PRIVATE_KEY` environment variable
wherever the evaluator binary runs (a real OutLayer project secret in
production — see below). Store the public key, base64-decoded to raw
bytes, in the `EvaluatorVersion.publicKey` column (`ops/seed.ts` shows
the shape; replace its placeholder `Buffer.alloc(32, 0)` with
`Buffer.from(EVALUATOR_PUBLIC_KEY_BASE64, "base64")`).

---

## Update the EvaluatorVersion

Once you have the `WASM_HASH` and `E_pub` (as a 32-byte Buffer), update the `EvaluatorVersion` row in Postgres.

### Option 1: Update via Seed Script (Recommended for Development)

Edit `ops/seed.ts` and replace the placeholders:

```typescript
const placeholderWasmHash = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6..."; // Your computed hash
const placeholderPublicKey = Buffer.from(
  "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  "hex"
); // Your public key
```

Then re-run the seed script:

```bash
npx ts-node ops/seed.ts
```

### Option 2: Direct Database Update (Production)

Connect to the Postgres database and execute:

```sql
UPDATE evaluator_versions
SET wasm_hash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6...',
    public_key = decode('b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', 'hex'),
    active = true
WHERE version = '1.0.0';
```

---

## Configure OutLayer Deployment

The evaluator runs in OutLayer's TEE. This was done and verified end to end on NEAR testnet (project `hafidbuild.testnet/secure-lambda-evaluator`).

### Prerequisites

- The `outlayer` CLI, logged in (`outlayer login`, then `outlayer whoami`).
- A NEAR testnet account with a few NEAR (the owner), plus a separate funded **worker account** whose key will sit on the server (below).
- The evaluator key pair from the previous section.

### Steps

1. **Build, upload, deploy.** The program must be plain `wasm32-wasip1` and must not import `random_get`
   (OutLayer's runtime does not provide randomness, so a module that imports it fails with the generic
   `Execution promise failed: Failed.`). Rust's default `HashMap`/`HashSet` pull it in; use `BTreeMap`/`BTreeSet`.
   Check with `node -e 'console.log(WebAssembly.Module.imports(new WebAssembly.Module(require("fs").readFileSync("evaluator.wasm"))).map(i=>i.name).join(" "))'`.

   ```bash
   (cd crates/evaluator && cargo build --release --target wasm32-wasip1)
   outlayer upload crates/evaluator/target/wasm32-wasip1/release/evaluator.wasm   # prints the FastFS URL
   outlayer deploy secure-lambda-evaluator <FastFS URL> --target wasm32-wasip1    # new version, activated
   shasum -a 256 crates/evaluator/target/wasm32-wasip1/release/evaluator.wasm      # this is EvaluatorVersion.wasmHash
   ```

   FastFS can return 404 for a few seconds after an upload; wait and retry the deploy.

2. **Store the private key as a project secret.** Lock it to the **project** (`--project`). Locking to a wasm hash
   (`--wasm-hash`/`--build`) did not deliver the secret in our tests.

   ```bash
   outlayer secrets set '{"EVALUATOR_PRIVATE_KEY":"<base64 private key>"}' \
     --project <owner>/secure-lambda-evaluator --access allow-all
   ```

   Anyone who can deploy a new version of that project can read the secret, so keep the owner key private.

3. **Smoke test from the CLI.** Secrets are only attached when you ask for them:

   ```bash
   outlayer run <owner>/secure-lambda-evaluator --input input.json \
     --secrets-profile default --secrets-account <owner>
   ```

   The CLI often prints `the request failed with timeout error` even though the run succeeded. It is a client
   timeout, not a failure; the result is on chain (this is why the worker polls instead).

4. **Point the worker at it.** In the worker's environment (see `ops/.env.example`):
   `EVALUATOR_MODE=outlayer`, `OUTLAYER_PROJECT`, `OUTLAYER_SIGNER_ACCOUNT`, `OUTLAYER_SIGNER_KEY`.
   Create the signer as its own sub-account so the owner's full-access key never leaves your machine:
   `near account create-account fund-myself worker.<owner> '2 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as <owner> network-config testnet sign-with-keychain send`.
   Each run attaches 0.0021 NEAR; OutLayer keeps about 0.001 and refunds the rest.

5. **Seed the database** with the real values: `EVALUATOR_WASM_HASH`, `EVALUATOR_PUBLIC_KEY_B64`,
   `EVALUATOR_PROJECT_ID=<owner>/secure-lambda-evaluator`, then `npx ts-node ops/seed.ts`.
   Files already sealed to an older public key cannot be opened by a new key and must be re-uploaded.

6. **Prove it end to end:** `EVALUATOR_BACKEND=outlayer OUTLAYER_WASM_HASH=<sha256> ops/live-e2e.sh`.

### How the worker talks to OutLayer

`apps/worker/src/near-outlayer-client.ts` signs a `request_execution` call to `outlayer.testnet` and broadcasts it
with `broadcast_tx_async`, then polls the transaction. A run takes about 2 minutes. "Pending" is never a failure.
The metrics and the executed wasm hash are read from the chain (the transaction's return value and the contract's
`execution_completed` event); a hash that differs from `EvaluatorVersion.wasmHash` blocks settlement and pauses
the listing. OutLayer testnet occasionally fails a run with no detail; the worker retries it as a fresh request
(at most twice), and the buyer is charged only for a verified success.

Known limits: the whole input travels in the transaction (4 MB protocol limit), so large datasets need OutLayer's
state-based input; the default limits are 10 seconds, 128 MB and 1e9 instructions per run
(`OUTLAYER_MAX_SECONDS` raises the first).

---

## Pre-Deployment Verification

Before considering a deployment ready, run the preflight check script:

```bash
ops/preflight.sh
```

This script verifies:
- Required environment variables are set
- API health endpoints are reachable
- Docker compose services (Postgres, Redis, MinIO) are running
- Rust toolchain and wasm32-wasip1 target are available
- Exit codes: 0 = ready, non-zero = failures detected

**If preflight fails:** Review the error messages, fix the issue, and re-run.

Example output (success):
```
=== SecureLambda Preflight Checks ===

1. Environment Variables
PASS DATABASE_URL is set
PASS REDIS_URL is set
PASS STORAGE_ENDPOINT is set

2. API Health
PASS GET http://localhost:3000/healthz => 200
PASS GET http://localhost:3000/readyz => 200

3. Docker Compose Services
PASS postgres is running
PASS redis is running
PASS minio is running

4. Rust Toolchain (evaluator build)
PASS cargo is available
PASS wasm32-wasip1 target is installed

=== Summary ===
Passed:  8
Failed:  0
Warned:  0

✓ Preflight OK — deployment ready
```

---

## Live testnet run

`ops/live-e2e.sh` runs the whole product against real services and checks the results independently. It needs Docker and Rust, and a credentials file named `secret` in the repo root (gitignored; never commit it):

```bash
NEAR_ACCOUNT_PRIVATE_KEY="ed25519:..."        # full-access key of the relayer account, e.g. irjenpro.testnet
S3_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
S3_BUCKET=...  S3_ACCESS_KEY_ID=...  S3_SECRET_ACCESS_KEY=...  S3_REGION=auto
S3_KEY_PREFIX="my-folder"                      # optional
```

```bash
ops/live-e2e.sh                  # ~1 minute; cleans up its R2 objects
KEEP_OBJECTS=1 ops/live-e2e.sh   # keep the uploaded objects
```

The script runs the API with `AUTH_MODE=signed` and logs in as the seller and the buyer with real NEP-413 signatures, so it also checks that a typed `x-account-id` is refused.

What it does: starts throwaway Postgres and Redis on ports 55432/56379 (it never touches yours), builds the evaluator, creates a fresh evaluator keypair, seeds, starts the API (port 3917) and worker, then runs `ops/live-e2e.ts`.

**Accounts.** The relayer is the key's own account. The buyer and seller are sub-accounts (`buyer.<relayer>`, `seller.<relayer>`) sharing that key. Create them once:
`near account create-account fund-myself buyer.<relayer> ...`, or with `near-api-js` `account.createAccount`. The buyer needs a few NEAR; it wraps a little into wNEAR per run.

**Money.** A run costs 0.01 wNEAR. Buyers pay in wNEAR (`wrap.testnet`), not native NEAR: a native transfer inside a delegate action is charged to the relayer. The relayer only pays gas (about 0.0002 NEAR per settle). Keep the relayer above 0.05 NEAR or settlement pauses with "relayer has no gas".

**RPC.** `https://rpc.testnet.near.org` is deprecated and rejects some requests. The default is `https://test.rpc.fastnear.com`; override with `NEAR_RPC_URL`.

**Rust cache.** If `~/.cargo` is root-owned the script uses `.live/cargo-home` automatically.

**Tests that spend testnet funds** skip unless credentials are in the environment:

```bash
set -a; . ./secret; set +a
(cd packages/facilitator && npx jest near-live)
```

---

## Troubleshooting

### Issue: `cargo build` fails with "target not found: wasm32-wasip1"

**Solution:**
```bash
rustup target add wasm32-wasip1
```

### Issue: API /healthz returns 500

**Solution:**
- Check `DATABASE_URL`, `REDIS_URL`, `STORAGE_ENDPOINT` are correctly set
- Ensure Postgres, Redis, and MinIO services are running: `docker compose ps`
- Check API logs: `docker compose logs api`

### Issue: WASM binary size is unexpectedly large or small

**Solution:**
- Ensure you're building with `--release`: `cargo build --release --target wasm32-wasip1`
- Check that you're using the correct target binary file, not a debug build

---

## References

- [Rust WebAssembly (wasm32-wasip1)](https://docs.rust-embedded.org/book/)
- [X25519 Key Exchange](https://en.wikipedia.org/wiki/Elliptic-curve_Diffie%E2%80%93Hellman#X25519)
- [NEAR Protocol Documentation](https://docs.near.org/)
