-- AlterTable: drop default from due_day column in dormitory_billing_settings
ALTER TABLE "dormitory_billing_settings"
  ALTER COLUMN "due_day" DROP DEFAULT;

