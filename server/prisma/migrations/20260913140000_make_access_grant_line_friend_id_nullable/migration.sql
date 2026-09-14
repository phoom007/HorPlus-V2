-- AlterTable
ALTER TABLE "dormitory_access_grants" ALTER COLUMN "line_friend_id" DROP NOT NULL;

-- Update partial unique index to explicitly ignore nulls
DROP INDEX IF EXISTS "dormitory_access_grants_active_friend_idx";
CREATE UNIQUE INDEX "dormitory_access_grants_active_friend_idx" ON "dormitory_access_grants"("dormitory_id", "line_friend_id") WHERE "status" = 'ACTIVE' AND "line_friend_id" IS NOT NULL;