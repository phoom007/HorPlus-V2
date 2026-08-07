-- Forward-only Corrective Migration: Foreign Keys, Indexes, and Check Constraints for Wave 1G

-- 1. Foreign Keys for ContractSnapshots
ALTER TABLE "contract_snapshots" 
  ADD CONSTRAINT "fk_contract_snapshots_building" 
  FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_snapshots" 
  ADD CONSTRAINT "fk_contract_snapshots_room" 
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_snapshots" 
  ADD CONSTRAINT "fk_contract_snapshots_tenant" 
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_snapshots" 
  ADD CONSTRAINT "fk_contract_snapshots_user" 
  FOREIGN KEY ("locked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Foreign Key for AuditLogs
ALTER TABLE "audit_logs" 
  ADD CONSTRAINT "fk_audit_logs_user" 
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Indexes for Contract Overlap, Occupancy Overlap, Snapshots, and Audit Logs
CREATE INDEX IF NOT EXISTS "idx_contracts_overlap" ON "contracts"("dormitory_id", "room_id", "status", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "idx_occupancies_overlap" ON "occupancies"("dormitory_id", "room_id", "status", "started_at", "ended_at");
CREATE INDEX IF NOT EXISTS "idx_contract_snapshots_room_tenant" ON "contract_snapshots"("room_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_dorm_entity_time" ON "audit_logs"("dormitory_id", "entity_type", "created_at");

-- 4. Financial & Operational Check Constraints for Building Overrides
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_monthly_rent_non_negative" CHECK ("monthly_rent" IS NULL OR "monthly_rent" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_term_rent_non_negative" CHECK ("term_rent" IS NULL OR "term_rent" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_daily_rent_non_negative" CHECK ("daily_rent" IS NULL OR "daily_rent" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_deposit_non_negative" CHECK ("deposit_amount" IS NULL OR "deposit_amount" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_advance_payment_non_negative" CHECK ("advance_payment_amount" IS NULL OR "advance_payment_amount" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_water_rate_non_negative" CHECK ("water_rate" IS NULL OR "water_rate" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_electricity_rate_non_negative" CHECK ("electricity_rate" IS NULL OR "electricity_rate" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_common_fee_non_negative" CHECK ("common_fee" IS NULL OR "common_fee" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_internet_fee_non_negative" CHECK ("internet_fee" IS NULL OR "internet_fee" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_parking_fee_non_negative" CHECK ("parking_fee" IS NULL OR "parking_fee" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_max_occupants_positive" CHECK ("maximum_occupants" IS NULL OR "maximum_occupants" > 0);

-- 5. Financial & Operational Check Constraints for Room Overrides
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_monthly_rent_non_negative" CHECK ("monthly_rent" IS NULL OR "monthly_rent" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_term_rent_non_negative" CHECK ("term_rent" IS NULL OR "term_rent" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_daily_rent_non_negative" CHECK ("daily_rent" IS NULL OR "daily_rent" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_deposit_non_negative" CHECK ("deposit_amount" IS NULL OR "deposit_amount" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_advance_payment_non_negative" CHECK ("advance_payment_amount" IS NULL OR "advance_payment_amount" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_water_rate_non_negative" CHECK ("water_rate" IS NULL OR "water_rate" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_electricity_rate_non_negative" CHECK ("electricity_rate" IS NULL OR "electricity_rate" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_common_fee_non_negative" CHECK ("common_fee" IS NULL OR "common_fee" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_internet_fee_non_negative" CHECK ("internet_fee" IS NULL OR "internet_fee" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_parking_fee_non_negative" CHECK ("parking_fee" IS NULL OR "parking_fee" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_max_occupants_positive" CHECK ("maximum_occupants" IS NULL OR "maximum_occupants" > 0);

