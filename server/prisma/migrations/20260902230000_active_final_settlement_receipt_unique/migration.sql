-- Drop legacy full unique index on receipts(dormitory_id, settlement_scope_key)
DROP INDEX IF EXISTS "dormitory_settlement_scope_unique";

-- Create partial unique index for ACTIVE Final Settlement receipts per scope
-- Invariant: 0..N voided historical receipts, at most 1 active (is_voided = false) receipt
CREATE UNIQUE INDEX IF NOT EXISTS "receipts_active_final_settlement_unique"
ON "receipts" ("dormitory_id", "settlement_scope_key")
WHERE "receipt_kind" = 'FINAL_SETTLEMENT'
  AND "settlement_scope_key" IS NOT NULL
  AND "is_voided" = false;

-- Create standard index for settlement_scope_key lookups
CREATE INDEX IF NOT EXISTS "idx_receipts_dorm_settlement_scope"
ON "receipts" ("dormitory_id", "settlement_scope_key");
