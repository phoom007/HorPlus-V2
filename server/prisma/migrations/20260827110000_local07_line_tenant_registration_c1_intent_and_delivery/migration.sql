-- Migration: 20260827110000_local07_line_tenant_registration_c1_intent_and_delivery

-- 1. CreateTable: tenant_registration_intents
CREATE TABLE "tenant_registration_intents" (
  "id" UUID NOT NULL,
  "dormitory_id" UUID NOT NULL,
  "line_friend_id" UUID NOT NULL,
  "purpose" VARCHAR(50) NOT NULL DEFAULT 'TENANT_REGISTRATION',
  "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  "submitted_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "tenant_registration_intents_pkey" PRIMARY KEY ("id")
);

-- 2. CreateIndexes for tenant_registration_intents
CREATE INDEX "tenant_registration_intents_dormitory_id_line_friend_id_purp_idx" ON "tenant_registration_intents"("dormitory_id", "line_friend_id", "purpose");
CREATE INDEX "tenant_registration_intents_dormitory_id_status_idx" ON "tenant_registration_intents"("dormitory_id", "status");

-- 3. AddForeignKeys for tenant_registration_intents
ALTER TABLE "tenant_registration_intents"
  ADD CONSTRAINT "tenant_registration_intents_dormitory_id_fkey"
  FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_registration_intents"
  ADD CONSTRAINT "tenant_registration_intents_line_friend_id_fkey"
  FOREIGN KEY ("line_friend_id") REFERENCES "dormitory_line_friends"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. AlterTable: tenant_registration_invites (Add intent_id and delivery tracking fields)
ALTER TABLE "tenant_registration_invites"
  ADD COLUMN "intent_id" UUID,
  ADD COLUMN "delivery_status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "delivery_attempted_at" TIMESTAMPTZ(6),
  ADD COLUMN "delivered_at" TIMESTAMPTZ(6),
  ADD COLUMN "failed_at" TIMESTAMPTZ(6),
  ADD COLUMN "delivery_error_code" VARCHAR(100);

-- 5. CreateIndex and ForeignKey on tenant_registration_invites for intent_id
CREATE INDEX "tenant_registration_invites_dormitory_id_intent_id_idx" ON "tenant_registration_invites"("dormitory_id", "intent_id");

ALTER TABLE "tenant_registration_invites"
  ADD CONSTRAINT "tenant_registration_invites_intent_id_fkey"
  FOREIGN KEY ("intent_id") REFERENCES "tenant_registration_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
