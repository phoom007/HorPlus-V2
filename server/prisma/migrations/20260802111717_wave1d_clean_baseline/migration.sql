-- CreateTable
CREATE TABLE "migration_meta" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "google_subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "email_normalized" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "avatar_url" TEXT,
    "phone" VARCHAR(50),
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dormitories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(100),
    "type" VARCHAR(100) NOT NULL DEFAULT 'apartment',
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "subdistrict" VARCHAR(100),
    "district" VARCHAR(100),
    "province" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country_code" VARCHAR(10) NOT NULL DEFAULT 'TH',
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "estimated_building_count" INTEGER NOT NULL DEFAULT 1,
    "estimated_room_count" INTEGER NOT NULL DEFAULT 10,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Bangkok',
    "currency" VARCHAR(10) NOT NULL DEFAULT 'THB',
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "dormitories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dormitory_billing_settings" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "billing_day" INTEGER NOT NULL DEFAULT 25,
    "due_day" INTEGER NOT NULL DEFAULT 5,
    "water_billing_type" VARCHAR(50) NOT NULL DEFAULT 'per_unit',
    "water_rate" DECIMAL(12,2) NOT NULL DEFAULT 18.00,
    "electricity_billing_type" VARCHAR(50) NOT NULL DEFAULT 'per_unit',
    "electricity_rate" DECIMAL(12,2) NOT NULL DEFAULT 7.00,
    "common_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "internet_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "late_fee_type" VARCHAR(50) NOT NULL DEFAULT 'fixed',
    "late_fee_value" DECIMAL(12,2) NOT NULL DEFAULT 50.00,
    "rent_billing_type" VARCHAR(50) NOT NULL DEFAULT 'monthly',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dormitory_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "permissions" JSONB NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dormitory_members" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "invited_at" TIMESTAMPTZ,
    "accepted_at" TIMESTAMPTZ,
    "suspended_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dormitory_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id_hash" VARCHAR(255) NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" VARCHAR(255),
    "user_agent_hash" VARCHAR(255),
    "ip_metadata" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "monthly_price" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'THB',
    "vat_included" BOOLEAN NOT NULL DEFAULT true,
    "room_limit" INTEGER,
    "message_quota_monthly" INTEGER NOT NULL DEFAULT 300,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_subscriptions" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'trialing',
    "billing_interval" VARCHAR(50) NOT NULL DEFAULT 'monthly',
    "trial_started_at" TIMESTAMPTZ,
    "trial_ends_at" TIMESTAMPTZ,
    "current_period_started_at" TIMESTAMPTZ,
    "current_period_ends_at" TIMESTAMPTZ,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_promo_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_normalized" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "trial_bonus_days" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMPTZ,
    "valid_until" TIMESTAMPTZ,
    "max_redemptions" INTEGER,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "bonus_days" INTEGER NOT NULL,
    "redeemed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_drafts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "current_step" VARCHAR(50) NOT NULL DEFAULT 'dormitory',
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onboarding_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_hash" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'processing',
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_type" VARCHAR(100),
    "resource_id" VARCHAR(255),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(100),
    "floor_count" INTEGER NOT NULL DEFAULT 1,
    "rooms_per_floor" INTEGER,
    "numbering_pattern" VARCHAR(100),
    "description" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "room_number" VARCHAR(100) NOT NULL,
    "normalized_room_number" VARCHAR(100) NOT NULL DEFAULT '',
    "floor" INTEGER NOT NULL DEFAULT 1,
    "room_type" VARCHAR(100) NOT NULL DEFAULT 'standard',
    "status" VARCHAR(50) NOT NULL DEFAULT 'vacant',
    "rent_cycle" VARCHAR(50) NOT NULL DEFAULT 'monthly',
    "monthly_rent" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "term_rent" DECIMAL(12,2),
    "daily_rent" DECIMAL(12,2),
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "parking_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "maximum_occupants" INTEGER NOT NULL DEFAULT 2,
    "water_meter_number" VARCHAR(100),
    "electricity_meter_number" VARCHAR(100),
    "initial_water_reading" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "initial_electricity_reading" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "amenities" JSONB,
    "images" JSONB,
    "notes" TEXT,
    "current_tenant_id" UUID,
    "current_contract_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "linked_user_id" UUID,
    "tenant_number" VARCHAR(100) NOT NULL,
    "first_name" VARCHAR(255) NOT NULL,
    "last_name" VARCHAR(255),
    "display_name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255),
    "national_id_encrypted" TEXT,
    "national_id_masked" VARCHAR(255),
    "date_of_birth" DATE,
    "gender" VARCHAR(50),
    "address" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "photo_url" TEXT,
    "pet_info" JSONB,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_co_occupants" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50),
    "relationship" VARCHAR(100),
    "national_id_encrypted" TEXT,
    "national_id_masked" VARCHAR(255),
    "date_of_birth" DATE,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "tenant_co_occupants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_emergency_contacts" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "relationship" VARCHAR(100) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_vehicles" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'car',
    "brand" VARCHAR(100),
    "model" VARCHAR(100),
    "color" VARCHAR(50),
    "license_plate" VARCHAR(100) NOT NULL,
    "province" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "tenant_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "contract_number" VARCHAR(100) NOT NULL,
    "room_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'draft',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "duration_months" INTEGER NOT NULL DEFAULT 1,
    "rent_billing_type" VARCHAR(50) NOT NULL DEFAULT 'monthly',
    "rent_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "advance_payment_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "terms" TEXT,
    "tenant_signature" TEXT,
    "owner_signature" TEXT,
    "signed_by_owner_at" TIMESTAMPTZ,
    "signed_by_tenant_at" TIMESTAMPTZ,
    "activated_at" TIMESTAMPTZ,
    "terminated_at" TIMESTAMPTZ,
    "termination_effective_date" DATE,
    "termination_reason" TEXT,
    "settlement_summary" JSONB,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_status_histories" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "from_status" VARCHAR(50),
    "to_status" VARCHAR(50) NOT NULL,
    "reason" TEXT,
    "effective_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_cycles" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "cycle_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "billing_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'draft',
    "generated_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "locked_at" TIMESTAMPTZ,
    "created_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "billing_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_rate_snapshots" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "billing_cycle_id" UUID NOT NULL,
    "water_billing_type" VARCHAR(50) NOT NULL DEFAULT 'per_unit',
    "water_rate" DECIMAL(12,2) NOT NULL DEFAULT 18.00,
    "electricity_billing_type" VARCHAR(50) NOT NULL DEFAULT 'per_unit',
    "electricity_rate" DECIMAL(12,2) NOT NULL DEFAULT 7.00,
    "common_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "internet_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "late_fee_type" VARCHAR(50) NOT NULL DEFAULT 'fixed',
    "late_fee_value" DECIMAL(12,2) NOT NULL DEFAULT 50.00,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'THB',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_rate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_devices" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "meter_number" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "installed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ,
    "initial_reading" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "current_reading" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "meter_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "billing_cycle_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "meter_device_id" UUID NOT NULL,
    "meter_type" VARCHAR(50) NOT NULL,
    "previous_reading" DECIMAL(12,2) NOT NULL,
    "current_reading" DECIMAL(12,2) NOT NULL,
    "usage_units" DECIMAL(12,2) NOT NULL,
    "is_replacement" BOOLEAN NOT NULL DEFAULT false,
    "replacement_id" UUID,
    "read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_by_user_id" UUID,
    "status" VARCHAR(50) NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_replacements" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "meter_type" VARCHAR(50) NOT NULL,
    "old_meter_device_id" UUID NOT NULL,
    "new_meter_device_id" UUID NOT NULL,
    "old_meter_final_reading" DECIMAL(12,2) NOT NULL,
    "new_meter_initial_reading" DECIMAL(12,2) NOT NULL,
    "replacement_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_replacements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "billing_cycle_id" UUID NOT NULL,
    "contract_id" UUID,
    "room_id" UUID NOT NULL,
    "tenant_id" UUID,
    "bill_number" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'draft',
    "billing_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "fine_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "outstanding_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'THB',
    "rate_snapshot_id" UUID,
    "generated_by_user_id" UUID,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by_user_id" UUID,
    "cancellation_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_items" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "code" VARCHAR(100),
    "description" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1.00,
    "unit" VARCHAR(50),
    "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "source_type" VARCHAR(50),
    "source_id" VARCHAR(255),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_status_histories" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "from_status" VARCHAR(50),
    "to_status" VARCHAR(50) NOT NULL,
    "reason" TEXT,
    "changed_by_user_id" UUID,
    "effective_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_registration_requests" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "line_follower_id" UUID,
    "requested_room_id" UUID NOT NULL,
    "first_name" VARCHAR(255) NOT NULL,
    "last_name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "note" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending_owner_approval',
    "submitted_at" TIMESTAMPTZ,
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by_user_id" UUID,
    "rejected_reason" TEXT,
    "approved_tenant_id" UUID,
    "approved_contract_id" UUID,
    "approved_room_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_registration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupancies" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "registration_id" UUID,
    "contract_id" UUID,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "ended_by_user_id" UUID,
    "ended_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "occupancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_move_out_requests" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "occupancy_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "submitted_line_identity_id" UUID,
    "intended_move_out_date" DATE NOT NULL,
    "refund_bank_name" VARCHAR(100),
    "refund_account_number" VARCHAR(100),
    "refund_account_name" VARCHAR(255),
    "reason" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "completed_by_user_id" UUID,
    "actual_ended_at" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenant_move_out_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "migration_meta_name_key" ON "migration_meta"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_billing_settings_dormitory_id_key" ON "dormitory_billing_settings"("dormitory_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_dormitory_id_code_key" ON "roles"("dormitory_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_members_user_id_dormitory_id_key" ON "dormitory_members"("user_id", "dormitory_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_id_hash_key" ON "sessions"("session_id_hash");

-- CreateIndex
CREATE UNIQUE INDEX "platform_plans_code_key" ON "platform_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_promo_codes_code_key" ON "platform_promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_promo_codes_code_normalized_key" ON "platform_promo_codes"("code_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "platform_promo_redemptions_promo_code_id_dormitory_id_key" ON "platform_promo_redemptions"("promo_code_id", "dormitory_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_drafts_user_id_key" ON "onboarding_drafts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_operation_idempotency_key_key" ON "idempotency_keys"("user_id", "operation", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_dormitory_id_code_key" ON "buildings"("dormitory_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_dormitory_id_name_key" ON "buildings"("dormitory_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_dormitory_id_normalized_room_number_key" ON "rooms"("dormitory_id", "normalized_room_number");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_dormitory_id_tenant_number_key" ON "tenants"("dormitory_id", "tenant_number");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_dormitory_id_contract_number_key" ON "contracts"("dormitory_id", "contract_number");

-- CreateIndex
CREATE UNIQUE INDEX "billing_cycles_dormitory_id_cycle_code_key" ON "billing_cycles"("dormitory_id", "cycle_code");

-- CreateIndex
CREATE UNIQUE INDEX "meter_readings_billing_cycle_id_room_id_meter_type_key" ON "meter_readings"("billing_cycle_id", "room_id", "meter_type");

-- CreateIndex
CREATE UNIQUE INDEX "bills_dormitory_id_bill_number_key" ON "bills"("dormitory_id", "bill_number");

-- CreateIndex
CREATE INDEX "occupancies_room_status_idx" ON "occupancies"("room_id", "status");

-- AddForeignKey
ALTER TABLE "dormitory_billing_settings" ADD CONSTRAINT "dormitory_billing_settings_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormitory_members" ADD CONSTRAINT "dormitory_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormitory_members" ADD CONSTRAINT "dormitory_members_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormitory_members" ADD CONSTRAINT "dormitory_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_promo_redemptions" ADD CONSTRAINT "platform_promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "platform_promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_co_occupants" ADD CONSTRAINT "tenant_co_occupants_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_co_occupants" ADD CONSTRAINT "tenant_co_occupants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_emergency_contacts" ADD CONSTRAINT "tenant_emergency_contacts_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_emergency_contacts" ADD CONSTRAINT "tenant_emergency_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_vehicles" ADD CONSTRAINT "tenant_vehicles_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_vehicles" ADD CONSTRAINT "tenant_vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_status_histories" ADD CONSTRAINT "contract_status_histories_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rate_snapshots" ADD CONSTRAINT "billing_rate_snapshots_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rate_snapshots" ADD CONSTRAINT "billing_rate_snapshots_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "billing_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_devices" ADD CONSTRAINT "meter_devices_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_devices" ADD CONSTRAINT "meter_devices_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "billing_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_device_id_fkey" FOREIGN KEY ("meter_device_id") REFERENCES "meter_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_replacements" ADD CONSTRAINT "meter_replacements_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_replacements" ADD CONSTRAINT "meter_replacements_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "billing_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_rate_snapshot_id_fkey" FOREIGN KEY ("rate_snapshot_id") REFERENCES "billing_rate_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_status_histories" ADD CONSTRAINT "bill_status_histories_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_registration_requests" ADD CONSTRAINT "tenant_registration_requests_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancies" ADD CONSTRAINT "occupancies_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancies" ADD CONSTRAINT "occupancies_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancies" ADD CONSTRAINT "occupancies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancies" ADD CONSTRAINT "occupancies_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancies" ADD CONSTRAINT "occupancies_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "tenant_registration_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_move_out_requests" ADD CONSTRAINT "tenant_move_out_requests_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_move_out_requests" ADD CONSTRAINT "tenant_move_out_requests_occupancy_id_fkey" FOREIGN KEY ("occupancy_id") REFERENCES "occupancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_move_out_requests" ADD CONSTRAINT "tenant_move_out_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_move_out_requests" ADD CONSTRAINT "tenant_move_out_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- CreateIndex
CREATE UNIQUE INDEX "billing_cycle_room_current_unique" ON "bills"("billing_cycle_id", "room_id") WHERE status NOT IN ('cancelled', 'void');
