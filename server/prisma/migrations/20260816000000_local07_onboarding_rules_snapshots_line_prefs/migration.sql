-- AlterTable: DormitoryPropertyDefaults
ALTER TABLE "dormitory_property_defaults" ADD COLUMN "pet_policy" JSONB NOT NULL DEFAULT '{"allowed":"none","allowedTypes":[]}';

-- AlterTable: TenantRegistrationRequest
ALTER TABLE "tenant_registration_requests" ADD COLUMN "acceptance_snapshot" JSONB,
ADD COLUMN "acceptance_snapshot_sha256" VARCHAR(64),
ADD COLUMN "accepted_at" TIMESTAMPTZ,
ADD COLUMN "tenant_signature_object_key" VARCHAR(255),
ADD COLUMN "tenant_signature_sha256" VARCHAR(64),
ADD COLUMN "tenant_signature_mime_type" VARCHAR(50),
ADD COLUMN "tenant_signature_byte_size" INTEGER;

-- AlterTable: DormitoryLineConfig
ALTER TABLE "dormitory_line_configs" ADD COLUMN "notify_repair_request" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notify_repair_completed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notify_payment_received" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notify_tenant_register" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notify_tenant_approved" BOOLEAN NOT NULL DEFAULT true;
