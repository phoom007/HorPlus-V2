-- CreateTable
CREATE TABLE "payment_upload_intents" (
    "id" UUID NOT NULL,
    "authenticated_user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'CREATED',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "expected_mime_type" VARCHAR(100),
    "expected_size" INTEGER,
    "verified_mime_type" VARCHAR(100),
    "verified_size" INTEGER,
    "object_key" TEXT,
    "sha256" VARCHAR(255),
    "uploaded_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_intent_status_expires" ON "payment_upload_intents"("status", "expires_at");

