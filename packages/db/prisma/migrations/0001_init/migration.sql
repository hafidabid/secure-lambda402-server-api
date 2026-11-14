-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "role_hint" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluator_versions" (
    "version" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "wasm_hash" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "trust_tier" SMALLINT NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluator_versions_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema_json" JSONB NOT NULL,
    "sample_rows" JSONB NOT NULL,
    "price_amount" DECIMAL(38,0) NOT NULL,
    "price_asset" TEXT NOT NULL,
    "rules_json" JSONB NOT NULL,
    "evaluator_version" TEXT NOT NULL,
    "dataset_asset_id" TEXT,
    "dataset_wrapped_key" JSONB,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "wrapped_key" JSONB NOT NULL,
    "evaluator_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "payment_nonce" TEXT NOT NULL,
    "attempt" SMALLINT NOT NULL DEFAULT 0,
    "exec_tx_hash" TEXT,
    "result_json" JSONB,
    "error_code" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'enclave',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_events" (
    "id" BIGSERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "detail" JSONB,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "run_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "pay_to" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(38,0) NOT NULL,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "settle_tx_hash" TEXT,
    "signed_payload" BYTEA NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "attestations" (
    "run_id" TEXT NOT NULL,
    "wasm_hash" TEXT NOT NULL,
    "quote_raw" BYTEA,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "attestations_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "detail" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_owner_id_sha256_key" ON "assets"("owner_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "runs_payment_nonce_key" ON "runs"("payment_nonce");

-- CreateIndex
CREATE INDEX "runs_state_idx" ON "runs"("state");

-- CreateIndex
CREATE UNIQUE INDEX "payments_nonce_key" ON "payments"("nonce");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_evaluator_version_fkey" FOREIGN KEY ("evaluator_version") REFERENCES "evaluator_versions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_evaluator_version_fkey" FOREIGN KEY ("evaluator_version") REFERENCES "evaluator_versions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (docs/03 B3). Prisma's schema.prisma cannot express
-- CHECK declaratively, so these are hand-appended here and must be kept in
-- sync with the Prisma schema's comments.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_role_hint_check" CHECK ("role_hint" IN ('seller', 'buyer', 'both'));
ALTER TABLE "evaluator_versions" ADD CONSTRAINT "evaluator_versions_trust_tier_check" CHECK ("trust_tier" IN (1, 2));
ALTER TABLE "listings" ADD CONSTRAINT "listings_price_amount_check" CHECK ("price_amount" > 0);
ALTER TABLE "listings" ADD CONSTRAINT "listings_status_check" CHECK ("status" IN ('draft', 'published', 'paused', 'retired'));
ALTER TABLE "assets" ADD CONSTRAINT "assets_kind_check" CHECK ("kind" IN ('dataset', 'model'));
ALTER TABLE "assets" ADD CONSTRAINT "assets_size_bytes_check" CHECK ("size_bytes" BETWEEN 1 AND 52428800);
ALTER TABLE "runs" ADD CONSTRAINT "runs_mode_check" CHECK ("mode" IN ('enclave', 'local'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check" CHECK ("status" IN ('verified', 'settled', 'expired', 'failed'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);

