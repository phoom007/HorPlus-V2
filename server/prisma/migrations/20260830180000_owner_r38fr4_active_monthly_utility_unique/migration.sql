-- Create partial unique index for active MONTHLY_UTILITY bills per room & cycle
CREATE UNIQUE INDEX IF NOT EXISTS "bills_active_monthly_utility_unique"
ON "bills" ("dormitory_id", "billing_cycle_id", "room_id")
WHERE "bill_kind" = 'MONTHLY_UTILITY'
  AND LOWER("status") NOT IN ('cancelled', 'void', 'voided');
