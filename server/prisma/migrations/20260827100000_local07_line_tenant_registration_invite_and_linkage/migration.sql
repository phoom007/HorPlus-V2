-- Migration: 20260827100000_local07_line_tenant_registration_invite_and_linkage

-- 1. AlterTable: Add line_friend_id to tenants
ALTER TABLE "tenants"
  ADD COLUMN "line_friend_id" UUID;

-- 2. CreateIndex for tenants(dormitory_id, line_friend_id)
CREATE INDEX "tenants_dormitory_id_line_friend_id_idx" ON "tenants"("dormitory_id", "line_friend_id");

-- 3. AddForeignKey: tenants.line_friend_id -> dormitory_line_friends.id
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_line_friend_id_fkey"
  FOREIGN KEY ("line_friend_id") REFERENCES "dormitory_line_friends"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. CreateTable: tenant_registration_invites
CREATE TABLE "tenant_registration_invites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dormitory_id" UUID NOT NULL,
  "line_friend_id" UUID NOT NULL,
  "token_hash" VARCHAR(255) NOT NULL,
  "purpose" VARCHAR(50) NOT NULL DEFAULT 'TENANT_REGISTRATION',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_registration_invites_pkey" PRIMARY KEY ("id")
);

-- 5. CreateIndex for tenant_registration_invites.token_hash (UNIQUE)
CREATE UNIQUE INDEX "tenant_registration_invites_token_hash_key" ON "tenant_registration_invites"("token_hash");

-- 6. CreateIndexes for tenant_registration_invites
CREATE INDEX "tenant_registration_invites_dormitory_id_line_friend_id_pur_idx" ON "tenant_registration_invites"("dormitory_id", "line_friend_id", "purpose");
CREATE INDEX "tenant_registration_invites_dormitory_id_expires_at_idx" ON "tenant_registration_invites"("dormitory_id", "expires_at");

-- 7. AddForeignKeys for tenant_registration_invites
ALTER TABLE "tenant_registration_invites"
  ADD CONSTRAINT "tenant_registration_invites_dormitory_id_fkey"
  FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_registration_invites"
  ADD CONSTRAINT "tenant_registration_invites_line_friend_id_fkey"
  FOREIGN KEY ("line_friend_id") REFERENCES "dormitory_line_friends"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
