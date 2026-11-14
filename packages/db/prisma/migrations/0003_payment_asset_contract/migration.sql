-- The NEP-141 token contract a payment was quoted in. The worker needs it to
-- rebuild the quote when it re-verifies a payment just before settling.
-- Nullable: sandbox-mode payments have no token contract.
ALTER TABLE "payments" ADD COLUMN "asset_contract" TEXT;
