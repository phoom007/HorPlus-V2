-- Forward-only migration: local07_referral_coin_quote_subscription_hardening

-- 1. Extend Room with deposit inheritance provenance
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "deposit_inherits_building_default" BOOLEAN NOT NULL DEFAULT true;

-- 2. Extend SubscriptionPackage with reference price
ALTER TABLE "subscription_packages" ADD COLUMN IF NOT EXISTS "reference_price" DECIMAL(12, 2);

-- 2b. Forward-only upgrade of known legacy PAID subscription packages to approved LOCAL-07 catalog
UPDATE "subscription_packages"
SET "price" = 189.00, "reference_price" = 990.00, "enabled" = true, "catalog_version" = 2
WHERE "duration_months" = 1 AND "plan_id" IN (SELECT "id" FROM "subscription_plans" WHERE "code" = 'PAID')
  AND ("reference_price" IS NULL OR "catalog_version" < 2);

UPDATE "subscription_packages"
SET "price" = 529.00, "reference_price" = 2990.00, "enabled" = true, "catalog_version" = 2
WHERE "duration_months" = 3 AND "plan_id" IN (SELECT "id" FROM "subscription_plans" WHERE "code" = 'PAID')
  AND ("price" IS NULL OR "reference_price" IS NULL OR "catalog_version" < 2);

UPDATE "subscription_packages"
SET "price" = 999.00, "reference_price" = 5990.00, "enabled" = true, "catalog_version" = 2
WHERE "duration_months" = 6 AND "plan_id" IN (SELECT "id" FROM "subscription_plans" WHERE "code" = 'PAID')
  AND ("price" IS NULL OR "reference_price" IS NULL OR "catalog_version" < 2);

UPDATE "subscription_packages"
SET "price" = 1799.00, "reference_price" = 10990.00, "enabled" = true, "catalog_version" = 2
WHERE "duration_months" = 12 AND "plan_id" IN (SELECT "id" FROM "subscription_plans" WHERE "code" = 'PAID')
  AND ("price" IS NULL OR "reference_price" IS NULL OR "catalog_version" < 2);

UPDATE "subscription_packages"
SET "price" = 2999.00, "reference_price" = 20000.00, "enabled" = true, "catalog_version" = 2
WHERE "duration_months" = 24 AND "plan_id" IN (SELECT "id" FROM "subscription_plans" WHERE "code" = 'PAID')
  AND ("price" IS NULL OR "reference_price" IS NULL OR "catalog_version" < 2);


-- 3. Extend PromoCode with global max redemptions and counter
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "global_max_redemptions" INTEGER;
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "current_redemptions_count" INTEGER NOT NULL DEFAULT 0;

-- 4. Extend SubscriptionPackageIntent with snapshot columns
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "reference_price_snapshot" DECIMAL(12, 2);
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "is_trial_eligible_snapshot" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "promo_code_snapshot" VARCHAR(50);
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "promo_bonus_months_snapshot" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "referral_code_snapshot" VARCHAR(6);
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "coin_requested" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "coin_applied" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "final_payable_amount" DECIMAL(12, 2);
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "checkout_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "is_zero_pay_validated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(255);
ALTER TABLE "subscription_package_intents" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ;

-- Backfill existing intents: final_payable_amount = price_snapshot (safe migration guard)
UPDATE "subscription_package_intents"
SET "final_payable_amount" = "price_snapshot"
WHERE "final_payable_amount" IS NULL AND "price_snapshot" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'subscription_package_intents_idempotency_key_key'
  ) THEN
    CREATE UNIQUE INDEX "subscription_package_intents_idempotency_key_key" ON "subscription_package_intents"("idempotency_key");
  END IF;
END $$;

-- Update RLS policy for subscription_package_intents to allow dormitory or user access
DROP POLICY IF EXISTS subscription_package_intents_isolation ON "subscription_package_intents";
CREATE POLICY subscription_package_intents_isolation ON "subscription_package_intents"
  USING (
    dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

-- 5. Create UserReferralCode table
CREATE TABLE IF NOT EXISTS "user_referral_codes" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "code" VARCHAR(6) NOT NULL,
  "max_usage" INTEGER NOT NULL DEFAULT 10,
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "user_referral_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_referral_codes_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "user_referral_codes_code_key" UNIQUE ("code"),
  CONSTRAINT "user_referral_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 6. Create ReferralAttribution table
CREATE TABLE IF NOT EXISTS "referral_attributions" (
  "id" UUID NOT NULL,
  "invitee_user_id" UUID NOT NULL,
  "inviter_user_id" UUID NOT NULL,
  "referral_code_id" UUID NOT NULL,
  "referral_code_snapshot" VARCHAR(6) NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  "provisional_coin_granted" INTEGER NOT NULL DEFAULT 10,
  "dormitory_id" UUID,
  "qualified_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "referral_attributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_attributions_invitee_user_id_key" UNIQUE ("invitee_user_id"),
  CONSTRAINT "referral_attributions_invitee_user_id_fkey" FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "referral_attributions_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "referral_attributions_referral_code_id_fkey" FOREIGN KEY ("referral_code_id") REFERENCES "user_referral_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "referral_attributions_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "referral_attributions_inviter_user_id_status_idx" ON "referral_attributions"("inviter_user_id", "status");

-- 7. Create CoinWallet table
CREATE TABLE IF NOT EXISTS "coin_wallets" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "coin_wallets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coin_wallets_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "coin_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 8. Create CoinLedgerEntry table
CREATE TABLE IF NOT EXISTS "coin_ledger_entries" (
  "id" UUID NOT NULL,
  "wallet_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "entry_type" VARCHAR(50) NOT NULL,
  "amount" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "reference_type" VARCHAR(50),
  "reference_id" VARCHAR(255),
  "description" TEXT,
  "idempotency_key" VARCHAR(255),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coin_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coin_ledger_entries_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "coin_ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "coin_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "coin_ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "coin_ledger_entries_user_id_created_at_idx" ON "coin_ledger_entries"("user_id", "created_at");

-- 9. Create ReferralProgramConfig table
CREATE TABLE IF NOT EXISTS "referral_program_configs" (
  "id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "reward_coin" INTEGER NOT NULL DEFAULT 10,
  "max_qualified_invitees" INTEGER NOT NULL DEFAULT 10,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "referral_program_configs_pkey" PRIMARY KEY ("id")
);

-- Insert default referral program config if not present
INSERT INTO "referral_program_configs" ("id", "enabled", "reward_coin", "max_qualified_invitees", "version", "updated_at")
SELECT gen_random_uuid(), true, 10, 10, 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "referral_program_configs");
