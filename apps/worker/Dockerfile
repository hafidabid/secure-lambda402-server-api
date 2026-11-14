# Build context is the repo root: docker build -f apps/worker/Dockerfile .
# The worker scores runs by launching the real Rust evaluator as a child process, so the image carries the binary.
FROM rust:1-slim-bookworm AS evaluator
WORKDIR /build
COPY crates/evaluator crates/evaluator
# Two jobs keeps the compile inside the memory of a small shared server.
RUN CARGO_BUILD_JOBS=2 cargo build --release --locked --manifest-path crates/evaluator/Cargo.toml

FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
COPY ops/deploy ops/deploy
RUN npm ci
RUN npm run build:libs && npm run build -w @securelambda/worker

FROM build AS run
ENV NODE_ENV=production
COPY --from=evaluator /build/crates/evaluator/target/release/evaluator /app/evaluator
USER node
# Local evaluator: its hash is read from the binary at start, so the recorded hash always matches what actually runs.
# EVALUATOR_MODE=outlayer: the evaluator runs in OutLayer, so there is no local hash to compute.
CMD ["sh", "-c", "if [ \"$EVALUATOR_MODE\" != outlayer ]; then export EVALUATOR_WASM_HASH=$(sha256sum /app/evaluator | cut -d' ' -f1); fi; exec node apps/worker/dist/main.js"]
