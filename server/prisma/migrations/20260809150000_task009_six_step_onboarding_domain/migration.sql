-- Task-009: 6-Step Owner Onboarding, Signature Storage, LINE OAuth & Unified Promo/Package Domain Migration

-- 0. Update Dormitory status column default
ALTER TABLE "dormitories" ALTER COLUMN "status" SET DEFAULT 'setup_pending';

-- 1. Update OnboardingDraft table
ALTER TABLE "onboarding_drafts" ADD COLUMN "provisional_dormitory_id" UUID;
ALTER TABLE "onboarding_drafts" ADD COLUMN "finalized_at" TIMESTAMPTZ;
ALTER TABLE "onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_provisional_dormitory_id_fkey" FOREIGN KEY ("provisional_dormitory_id") REFERENCES "dormitories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Update SubscriptionPackage table
ALTER TABLE "subscription_packages" ADD COLUMN "catalog_version" INTEGER NOT NULL DEFAULT 1;

-- 3. Update PromoCode & PromoRedemption tables
ALTER TABLE "promo_codes" ADD COLUMN "benefit_type" VARCHAR(50) NOT NULL DEFAULT 'TRIAL_EXTENSION';
ALTER TABLE "promo_codes" ADD COLUMN "benefit_unit" VARCHAR(20) NOT NULL DEFAULT 'MONTH';
ALTER TABLE "promo_codes" ADD COLUMN "benefit_value" INTEGER NOT NULL DEFAULT 2;

CREATE UNIQUE INDEX "promo_user_unique" ON "promo_redemptions"("promo_code_id", "redeemed_by");

-- 4. Create owner_signatures table
CREATE TABLE "owner_signatures" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "signed_by_user_id" UUID NOT NULL,
    "object_key" VARCHAR(255) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL DEFAULT 'image/png',
    "byte_size" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "signed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_signatures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "owner_signatures_dormitory_id_is_current_idx" ON "owner_signatures"("dormitory_id", "is_current");
CREATE INDEX "owner_signatures_signed_by_user_id_idx" ON "owner_signatures"("signed_by_user_id");

ALTER TABLE "owner_signatures" ADD CONSTRAINT "owner_signatures_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_signatures" ADD CONSTRAINT "owner_signatures_signed_by_user_id_fkey" FOREIGN KEY ("signed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Create account_benefit_claims table
CREATE TABLE "account_benefit_claims" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "benefit_key" VARCHAR(100) NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "subscription_id" UUID,
    "granted_months" INTEGER NOT NULL,
    "previous_expires_at" TIMESTAMPTZ,
    "new_expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_benefit_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_benefit_unique" ON "account_benefit_claims"("user_id", "benefit_key");
CREATE INDEX "account_benefit_claims_user_id_idx" ON "account_benefit_claims"("user_id");
CREATE INDEX "account_benefit_claims_dormitory_id_idx" ON "account_benefit_claims"("dormitory_id");

ALTER TABLE "account_benefit_claims" ADD CONSTRAINT "account_benefit_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_benefit_claims" ADD CONSTRAINT "account_benefit_claims_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_benefit_claims" ADD CONSTRAINT "account_benefit_claims_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "dormitory_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Create subscription_package_intents table
CREATE TABLE "subscription_package_intents" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING_PAYMENT',
    "duration_months_snapshot" INTEGER NOT NULL,
    "price_snapshot" DECIMAL(12,2),
    "currency_snapshot" VARCHAR(10) NOT NULL DEFAULT 'THB',
    "catalog_version" INTEGER NOT NULL DEFAULT 1,
    "activated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscription_package_intents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscription_package_intents_dormitory_id_idx" ON "subscription_package_intents"("dormitory_id");
CREATE INDEX "subscription_package_intents_user_id_idx" ON "subscription_package_intents"("user_id");
CREATE INDEX "subscription_package_intents_package_id_idx" ON "subscription_package_intents"("package_id");

ALTER TABLE "subscription_package_intents" ADD CONSTRAINT "subscription_package_intents_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_package_intents" ADD CONSTRAINT "subscription_package_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_package_intents" ADD CONSTRAINT "subscription_package_intents_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "subscription_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Enable RLS & Security Policies
ALTER TABLE "owner_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_benefit_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_package_intents" ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_signatures_isolation ON "owner_signatures"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

CREATE POLICY account_benefit_claims_isolation ON "account_benefit_claims"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

CREATE POLICY subscription_package_intents_isolation ON "subscription_package_intents"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

ALTER TABLE "owner_signatures" FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_benefit_claims" FORCE ROW LEVEL SECURITY;
ALTER TABLE "subscription_package_intents" FORCE ROW LEVEL SECURITY;
