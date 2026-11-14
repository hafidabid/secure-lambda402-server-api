-- Adds fields needed to reconstruct a full SignedPayment for
-- facilitator.settle() in the worker, without re-parsing the signed
-- payload (see schema.prisma comment on Payment.payerPublicKey).
ALTER TABLE "payments" ADD COLUMN "payer_public_key" TEXT;
ALTER TABLE "payments" ADD COLUMN "max_block_height" BIGINT;

-- Backfill is not needed: no payments exist yet in any deployed
-- environment of this build. Make both columns required going forward.
UPDATE "payments" SET "payer_public_key" = '' WHERE "payer_public_key" IS NULL;
UPDATE "payments" SET "max_block_height" = 0 WHERE "max_block_height" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "payer_public_key" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "max_block_height" SET NOT NULL;
