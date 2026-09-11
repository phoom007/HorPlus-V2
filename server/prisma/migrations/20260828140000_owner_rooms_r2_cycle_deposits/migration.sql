-- Migration: 20260828140000_owner_rooms_r2_cycle_deposits

-- 1. Add cycle deposit columns to rooms table
ALTER TABLE "rooms"
  ADD COLUMN "term_deposit" DECIMAL(12, 2),
  ADD COLUMN "monthly_deposit" DECIMAL(12, 2),
  ADD COLUMN "daily_deposit" DECIMAL(12, 2);

-- 2. Add optional deposit_amount column to provisional_rental_terms table
ALTER TABLE "provisional_rental_terms"
  ADD COLUMN "deposit_amount" DECIMAL(12, 2);

-- 3. Deterministic backfill for all existing rooms (including archived rooms) from exact legacy effective deposit
UPDATE "rooms" r
SET
  "term_deposit" = COALESCE(
    CASE WHEN r."deposit_inherits_building_default" = false AND r."deposit_amount" IS NOT NULL THEN r."deposit_amount" ELSE NULL END,
    b."deposit_amount",
    dpd."default_deposit",
    0.00
  ),
  "monthly_deposit" = COALESCE(
    CASE WHEN r."deposit_inherits_building_default" = false AND r."deposit_amount" IS NOT NULL THEN r."deposit_amount" ELSE NULL END,
    b."deposit_amount",
    dpd."default_deposit",
    0.00
  ),
  "daily_deposit" = COALESCE(
    CASE WHEN r."deposit_inherits_building_default" = false AND r."deposit_amount" IS NOT NULL THEN r."deposit_amount" ELSE NULL END,
    b."deposit_amount",
    dpd."default_deposit",
    0.00
  )
FROM "buildings" b
LEFT JOIN "dormitory_property_defaults" dpd ON dpd."dormitory_id" = b."dormitory_id"
WHERE r."building_id" = b."id";
