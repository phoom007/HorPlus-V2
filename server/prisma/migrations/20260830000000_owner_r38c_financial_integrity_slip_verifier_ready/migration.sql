-- CreateTable combined_payment_group_bill_targets
CREATE TABLE IF NOT EXISTS "combined_payment_group_bill_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "payment_group_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "target_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combined_payment_group_bill_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable payment_evidence_verifications
CREATE TABLE IF NOT EXISTS "payment_evidence_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "payment_id" UUID,
    "payment_group_id" UUID,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'NONE',
    "status" VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED',
    "claimed_transfer_at" TIMESTAMPTZ,
    "verified_transfer_at" TIMESTAMPTZ,
    "verified_amount" DECIMAL(12,2),
    "provider_reference" VARCHAR(255),
    "payload_hash" VARCHAR(255),
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_evidence_verifications_pkey" PRIMARY KEY ("id")
);

-- Create unique index on receipts(payment_group_id) where payment_group_id is not null
CREATE UNIQUE INDEX IF NOT EXISTS "receipts_payment_group_id_unique" ON "receipts"("payment_group_id") WHERE "payment_group_id" IS NOT NULL;

-- Unique and Indexes on combined_payment_group_bill_targets
CREATE UNIQUE INDEX IF NOT EXISTS "cpg_target_group_bill_unique" ON "combined_payment_group_bill_targets"("payment_group_id", "bill_id");
CREATE INDEX IF NOT EXISTS "idx_cpg_target_dorm_group" ON "combined_payment_group_bill_targets"("dormitory_id", "payment_group_id");
CREATE INDEX IF NOT EXISTS "idx_cpg_target_dorm_bill" ON "combined_payment_group_bill_targets"("dormitory_id", "bill_id");

-- Unique and Indexes on payment_evidence_verifications
CREATE UNIQUE INDEX IF NOT EXISTS "payment_evidence_verifications_payment_id_key" ON "payment_evidence_verifications"("payment_id") WHERE "payment_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "payment_evidence_verifications_payment_group_id_key" ON "payment_evidence_verifications"("payment_group_id") WHERE "payment_group_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_verification_dorm_status" ON "payment_evidence_verifications"("dormitory_id", "status");

-- Foreign Keys for combined_payment_group_bill_targets
ALTER TABLE "combined_payment_group_bill_targets" ADD CONSTRAINT "combined_payment_group_bill_targets_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "combined_payment_group_bill_targets" ADD CONSTRAINT "combined_payment_group_bill_targets_payment_group_id_fkey" FOREIGN KEY ("payment_group_id") REFERENCES "combined_payment_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "combined_payment_group_bill_targets" ADD CONSTRAINT "combined_payment_group_bill_targets_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign Keys for payment_evidence_verifications
ALTER TABLE "payment_evidence_verifications" ADD CONSTRAINT "payment_evidence_verifications_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_evidence_verifications" ADD CONSTRAINT "payment_evidence_verifications_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_evidence_verifications" ADD CONSTRAINT "payment_evidence_verifications_payment_group_id_fkey" FOREIGN KEY ("payment_group_id") REFERENCES "combined_payment_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
