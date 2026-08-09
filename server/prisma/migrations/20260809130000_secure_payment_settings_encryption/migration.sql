-- Add encrypted bank account number column to dormitory_billing_settings
ALTER TABLE "dormitory_billing_settings" ADD COLUMN IF NOT EXISTS "bank_account_number_encrypted" TEXT;
