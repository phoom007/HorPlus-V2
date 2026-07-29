-- Migration: Identity Foundation and RLS Policies
-- Created At: 2026-07-24T00:00:00.000Z

-- Create Table users
CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "google_subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "email_normalized" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "avatar_url" TEXT,
    "phone" VARCHAR(50),
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- Create Table dormitories
CREATE TABLE IF NOT EXISTS "dormitories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dormitories_pkey" PRIMARY KEY ("id")
);

-- Create Table roles
CREATE TABLE IF NOT EXISTS "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "permissions" JSONB NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- Create Table dormitory_members
CREATE TABLE IF NOT EXISTS "dormitory_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "invited_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dormitory_members_pkey" PRIMARY KEY ("id")
);

-- Create Table sessions
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "session_id_hash" VARCHAR(255) NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(255),
    "user_agent_hash" VARCHAR(255),
    "ip_metadata" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_subject_key" ON "users"("google_subject");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_normalized_key" ON "users"("email_normalized");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_dormitory_id_code_key" ON "roles"("dormitory_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "dormitory_members_user_id_dormitory_id_key" ON "dormitory_members"("user_id", "dormitory_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_session_id_hash_key" ON "sessions"("session_id_hash");

-- Foreign Keys
ALTER TABLE "roles" ADD CONSTRAINT "roles_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dormitory_members" ADD CONSTRAINT "dormitory_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dormitory_members" ADD CONSTRAINT "dormitory_members_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dormitory_members" ADD CONSTRAINT "dormitory_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- System Roles Seeding
INSERT INTO "roles" ("id", "code", "name", "permissions", "is_system", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'OWNER', 'เจ้าของหอพัก', '{"*": ["*"]}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MANAGER', 'ผู้จัดการ', '{"rooms": ["view", "create", "update"], "tenants": ["view", "create", "update"], "contracts": ["view", "create", "update"], "bills": ["view", "generate"], "maintenance": ["view", "update"]}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FINANCE', 'การเงิน', '{"bills": ["view", "generate", "update"], "payments": ["view", "approve", "reject"], "receipts": ["view"]}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'STAFF', 'พนักงานทั่วไป', '{"rooms": ["view"], "tenants": ["view"], "meters": ["view", "record"], "maintenance": ["view", "update"]}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TECH', 'ช่างเทคนิค', '{"maintenance": ["view", "update"], "meters": ["view", "record"]}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ROW LEVEL SECURITY FOUNDATION SQL
ALTER TABLE "dormitory_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dormitories" ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "dormitory_members_isolation_policy" ON "dormitory_members";
CREATE POLICY "dormitory_members_isolation_policy" ON "dormitory_members"
    FOR ALL
    USING (
        "dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), '')
        OR "user_id"::text = NULLIF(current_setting('app.current_user_id', true), '')
    );

DROP POLICY IF EXISTS "dormitories_isolation_policy" ON "dormitories";
CREATE POLICY "dormitories_isolation_policy" ON "dormitories"
    FOR ALL
    USING (
        "id"::text IN (
            SELECT "dormitory_id"::text FROM "dormitory_members"
            WHERE "user_id"::text = NULLIF(current_setting('app.current_user_id', true), '')
            AND "status" = 'active'
        )
    );
