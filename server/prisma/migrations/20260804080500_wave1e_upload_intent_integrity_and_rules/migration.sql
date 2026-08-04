-- AlterTable
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "previous_status" VARCHAR(50);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_intent_actor" ON "payment_upload_intents"("authenticated_user_id");
CREATE INDEX IF NOT EXISTS "idx_intent_tenant" ON "payment_upload_intents"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_intent_dormitory" ON "payment_upload_intents"("dormitory_id");
CREATE INDEX IF NOT EXISTS "idx_intent_bill" ON "payment_upload_intents"("bill_id");

-- Clean up any invalid dangling test intents prior to adding FKs
DELETE FROM "payment_upload_intents" WHERE "authenticated_user_id" NOT IN (SELECT "id" FROM "users");
DELETE FROM "payment_upload_intents" WHERE "tenant_id" NOT IN (SELECT "id" FROM "tenants");
DELETE FROM "payment_upload_intents" WHERE "dormitory_id" NOT IN (SELECT "id" FROM "dormitories");
DELETE FROM "payment_upload_intents" WHERE "bill_id" NOT IN (SELECT "id" FROM "bills");

-- Clean up duplicate test upload intents with same sha256 by setting duplicates to CANCELLED
UPDATE "payment_upload_intents"
SET "status" = 'CANCELLED'
WHERE "id" NOT IN (
    SELECT DISTINCT ON ("sha256") "id"
    FROM "payment_upload_intents"
    WHERE "sha256" IS NOT NULL AND "status" IN ('UPLOADED', 'CONSUMED')
    ORDER BY "sha256", "created_at" DESC
) AND "sha256" IS NOT NULL AND "status" IN ('UPLOADED', 'CONSUMED');

-- AddForeignKeys with ON DELETE RESTRICT
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_upload_intents_authenticated_user_id_fkey'
    ) THEN
        ALTER TABLE "payment_upload_intents" ADD CONSTRAINT "payment_upload_intents_authenticated_user_id_fkey" 
            FOREIGN KEY ("authenticated_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_upload_intents_tenant_id_fkey'
    ) THEN
        ALTER TABLE "payment_upload_intents" ADD CONSTRAINT "payment_upload_intents_tenant_id_fkey" 
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_upload_intents_dormitory_id_fkey'
    ) THEN
        ALTER TABLE "payment_upload_intents" ADD CONSTRAINT "payment_upload_intents_dormitory_id_fkey" 
            FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_upload_intents_bill_id_fkey'
    ) THEN
        ALTER TABLE "payment_upload_intents" ADD CONSTRAINT "payment_upload_intents_bill_id_fkey" 
            FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Status check constraint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_upload_intent_status'
    ) THEN
        ALTER TABLE "payment_upload_intents" ADD CONSTRAINT "chk_payment_upload_intent_status" 
            CHECK ("status" IN ('CREATED', 'UPLOADED', 'CONSUMED', 'EXPIRED', 'CANCELLED'));
    END IF;
END $$;

-- Unique partial index for non-null SHA-256 evidence hashes on active/consumed intents
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_upload_intents_sha256_active" 
    ON "payment_upload_intents"("sha256") 
    WHERE "status" IN ('UPLOADED', 'CONSUMED') AND "sha256" IS NOT NULL;

-- Metadata check constraint when status is UPLOADED or CONSUMED
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_intent_uploaded_metadata'
    ) THEN
        ALTER TABLE "payment_upload_intents" ADD CONSTRAINT "chk_intent_uploaded_metadata" 
            CHECK ("status" NOT IN ('UPLOADED', 'CONSUMED') OR ("verified_mime_type" IS NOT NULL AND "verified_size" IS NOT NULL AND "object_key" IS NOT NULL AND "sha256" IS NOT NULL));
    END IF;
END $$;

-- Consumed_at check constraint when status is CONSUMED
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_intent_consumed_at'
    ) THEN
        ALTER TABLE "payment_upload_intents" ADD CONSTRAINT "chk_intent_consumed_at" 
            CHECK ("status" != 'CONSUMED' OR "consumed_at" IS NOT NULL);
    END IF;
END $$;
