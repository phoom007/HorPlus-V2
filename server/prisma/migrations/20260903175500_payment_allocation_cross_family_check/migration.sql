-- Cross-family check constraint for PaymentAllocation
-- Enforces:
-- 1. Monthly allocation: bill_id IS NOT NULL, daily_stay_invoice_id IS NULL, daily_stay_invoice_item_id IS NULL
-- 2. Daily allocation: daily_stay_invoice_id IS NOT NULL, daily_stay_invoice_item_id IS NOT NULL, payment_id IS NOT NULL, bill_id IS NULL, bill_item_id IS NULL
ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_cross_family_check"
  CHECK (
    ("bill_id" IS NOT NULL AND "daily_stay_invoice_id" IS NULL AND "daily_stay_invoice_item_id" IS NULL)
    OR
    ("bill_id" IS NULL AND "bill_item_id" IS NULL AND "daily_stay_invoice_id" IS NOT NULL AND "daily_stay_invoice_item_id" IS NOT NULL AND "payment_id" IS NOT NULL)
  );
