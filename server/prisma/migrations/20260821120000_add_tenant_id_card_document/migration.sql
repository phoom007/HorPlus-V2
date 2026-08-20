-- AlterTable
ALTER TABLE "tenants"
ADD COLUMN "id_card_object_key" VARCHAR(255),
ADD COLUMN "id_card_sha256" VARCHAR(64),
ADD COLUMN "id_card_mime_type" VARCHAR(50),
ADD COLUMN "id_card_byte_size" INTEGER,
ADD COLUMN "id_card_uploaded_at" TIMESTAMPTZ,
ADD COLUMN "id_card_uploaded_by_user_id" UUID;
