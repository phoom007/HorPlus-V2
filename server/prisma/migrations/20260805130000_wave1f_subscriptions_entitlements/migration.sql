-- CreateEnum
CREATE TYPE "SubscriptionPlanType" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "DormitorySubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateTable "subscription_plans"
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "SubscriptionPlanType" NOT NULL DEFAULT 'FREE',
    "room_limit" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_subscription_plans_room_limit" CHECK ("room_limit" > 0)
);

-- CreateTable "subscription_packages"
CREATE TABLE "subscription_packages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "price" DECIMAL(12,2),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'THB',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_packages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_subscription_packages_duration" CHECK ("duration_months" IN (1, 3, 6, 12, 24)),
    CONSTRAINT "chk_subscription_packages_price" CHECK ("price" IS NULL OR "price" >= 0)
);

-- CreateTable "dormitory_subscriptions"
CREATE TABLE "dormitory_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "DormitorySubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "trial_started_at" TIMESTAMPTZ,
    "trial_expires_at" TIMESTAMPTZ,
    "promo_extended_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dormitory_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable "subscription_status_histories"
CREATE TABLE "subscription_status_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "previous_status" "DormitorySubscriptionStatus",
    "new_status" "DormitorySubscriptionStatus" NOT NULL,
    "previous_plan_id" UUID,
    "new_plan_id" UUID NOT NULL,
    "effective_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "reason" VARCHAR(255) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable "promo_codes"
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "normalized_code" VARCHAR(50) NOT NULL,
    "extension_days" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "maximum_redemptions_per_dormitory" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_promo_codes_extension_days" CHECK ("extension_days" > 0)
);

-- CreateTable "promo_redemptions"
CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "promo_code_id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "redeemed_by" UUID NOT NULL,
    "previous_expires_at" TIMESTAMPTZ NOT NULL,
    "new_expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_packages_plan_id_duration_months_key" ON "subscription_packages"("plan_id", "duration_months");

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_subscriptions_dormitory_id_key" ON "dormitory_subscriptions"("dormitory_id");

-- CreateIndex
CREATE INDEX "dormitory_subscriptions_dormitory_id_idx" ON "dormitory_subscriptions"("dormitory_id");

-- CreateIndex
CREATE INDEX "dormitory_subscriptions_expires_at_idx" ON "dormitory_subscriptions"("expires_at");

-- CreateIndex
CREATE INDEX "dormitory_subscriptions_status_idx" ON "dormitory_subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscription_status_histories_subscription_id_idx" ON "subscription_status_histories"("subscription_id");

-- CreateIndex
CREATE INDEX "subscription_status_histories_dormitory_id_idx" ON "subscription_status_histories"("dormitory_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_normalized_code_key" ON "promo_codes"("normalized_code");

-- CreateIndex
CREATE INDEX "promo_redemptions_dormitory_id_idx" ON "promo_redemptions"("dormitory_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_subscription_id_idx" ON "promo_redemptions"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_promo_code_id_dormitory_id_key" ON "promo_redemptions"("promo_code_id", "dormitory_id");

-- Foreign key constraints with ON DELETE RESTRICT
ALTER TABLE "subscription_packages" ADD CONSTRAINT "subscription_packages_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dormitory_subscriptions" ADD CONSTRAINT "dormitory_subscriptions_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dormitory_subscriptions" ADD CONSTRAINT "dormitory_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_status_histories" ADD CONSTRAINT "subscription_status_histories_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "dormitory_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "dormitory_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
