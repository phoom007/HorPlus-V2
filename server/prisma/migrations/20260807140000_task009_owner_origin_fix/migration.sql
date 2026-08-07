-- AlterTable
ALTER TABLE "dormitory_members" ALTER COLUMN "membership_origin" SET DEFAULT 'LEGACY_MEMBER';

-- Backfill non-owner legacy members to LEGACY_MEMBER
UPDATE "dormitory_members"
SET "membership_origin" = 'LEGACY_MEMBER'
WHERE "id" NOT IN (
  SELECT m.id
  FROM "dormitory_members" m
  JOIN "dormitories" d ON m.dormitory_id = d.id AND m.user_id = d.created_by_user_id
  JOIN "roles" r ON m.role_id = r.id AND r.code = 'OWNER'
);

-- Backfill true permanent Google Owners to GOOGLE_BOOTSTRAP
UPDATE "dormitory_members" m
SET "membership_origin" = 'GOOGLE_BOOTSTRAP'
FROM "dormitories" d, "roles" r
WHERE m.dormitory_id = d.id
  AND m.user_id = d.created_by_user_id
  AND m.role_id = r.id
  AND r.code = 'OWNER';
