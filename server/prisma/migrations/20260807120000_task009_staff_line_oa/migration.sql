-- AlterTable
ALTER TABLE "dormitory_members" ADD COLUMN     "membership_origin" VARCHAR(50) NOT NULL DEFAULT 'GOOGLE_BOOTSTRAP';

-- Backfill existing members to GOOGLE_BOOTSTRAP
UPDATE "dormitory_members"
SET "membership_origin" = 'GOOGLE_BOOTSTRAP'
WHERE "membership_origin" IS NULL OR "membership_origin" = '';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "access_grant_id" UUID,
ADD COLUMN     "principal_type" VARCHAR(50) NOT NULL DEFAULT 'GOOGLE_USER',
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "dormitory_line_friends" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "line_user_id_hash" VARCHAR(255) NOT NULL,
    "line_user_id_encrypted" TEXT NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "picture_url" TEXT,
    "friendStatus" VARCHAR(50) NOT NULL DEFAULT 'FOLLOWING',
    "followed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unfollowed_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dormitory_line_friends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dormitory_access_grants" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "line_friend_id" UUID NOT NULL,
    "role_code" VARCHAR(50) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "token_prefix" VARCHAR(20),
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_principal" VARCHAR(255) NOT NULL,
    "revoked_by_principal" VARCHAR(255),
    "revoked_at" TIMESTAMPTZ,
    "last_role_changed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dormitory_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dormitory_line_configs" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "line_oa_id" VARCHAR(100),
    "channel_id" VARCHAR(100),
    "channel_secret_encrypted" TEXT,
    "channel_access_token_encrypted" TEXT,
    "encryption_key_version" INTEGER NOT NULL DEFAULT 1,
    "webhook_key_hash" VARCHAR(255) NOT NULL,
    "webhook_key_encrypted" TEXT,
    "is_connected" BOOLEAN NOT NULL DEFAULT false,
    "last_verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dormitory_line_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_webhook_event_receipts" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "webhook_event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "line_webhook_event_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_line_friends_dormitory_id_line_user_id_hash_key" ON "dormitory_line_friends"("dormitory_id", "line_user_id_hash");

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_access_grants_token_hash_key" ON "dormitory_access_grants"("token_hash");

-- CreateIndex
CREATE INDEX "dormitory_access_grants_dormitory_id_status_idx" ON "dormitory_access_grants"("dormitory_id", "status");

-- Partial Unique Index: Only 1 ACTIVE access grant permitted per Dormitory + LINE Friend
CREATE UNIQUE INDEX "dormitory_access_grants_active_friend_idx" ON "dormitory_access_grants"("dormitory_id", "line_friend_id") WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_line_configs_dormitory_id_key" ON "dormitory_line_configs"("dormitory_id");

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_line_configs_webhook_key_hash_key" ON "dormitory_line_configs"("webhook_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "line_webhook_event_receipts_webhook_event_id_key" ON "line_webhook_event_receipts"("webhook_event_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_access_grant_id_fkey" FOREIGN KEY ("access_grant_id") REFERENCES "dormitory_access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormitory_line_friends" ADD CONSTRAINT "dormitory_line_friends_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormitory_access_grants" ADD CONSTRAINT "dormitory_access_grants_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormitory_access_grants" ADD CONSTRAINT "dormitory_access_grants_line_friend_id_fkey" FOREIGN KEY ("line_friend_id") REFERENCES "dormitory_line_friends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormitory_line_configs" ADD CONSTRAINT "dormitory_line_configs_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_webhook_event_receipts" ADD CONSTRAINT "line_webhook_event_receipts_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "dormitory_line_friends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dormitory_access_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dormitory_line_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "line_webhook_event_receipts" ENABLE ROW LEVEL SECURITY;

-- RLS Isolation Policies
CREATE POLICY dormitory_line_friends_isolation ON "dormitory_line_friends"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

CREATE POLICY dormitory_access_grants_isolation ON "dormitory_access_grants"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

CREATE POLICY dormitory_line_configs_isolation ON "dormitory_line_configs"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

CREATE POLICY line_webhook_event_receipts_isolation ON "line_webhook_event_receipts"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

-- Public Webhook Resolver Function (SECURITY DEFINER, narrow outputs, fixed search_path)
CREATE OR REPLACE FUNCTION public.resolve_line_webhook_config(p_webhook_key_hash text)
RETURNS TABLE (
  id uuid,
  dormitory_id uuid,
  channel_secret_encrypted text,
  is_connected boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.dormitory_id,
    c.channel_secret_encrypted,
    c.is_connected
  FROM public.dormitory_line_configs c
  WHERE c.webhook_key_hash = p_webhook_key_hash
  LIMIT 1;
END;
$$;
