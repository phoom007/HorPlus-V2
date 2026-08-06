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

-- 3. Indexes for Contract Overlap, Snapshots, and Audit Logs
CREATE INDEX IF NOT EXISTS "idx_contracts_overlap" ON "contracts"("dormitory_id", "room_id", "status", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "idx_contract_snapshots_room_tenant" ON "contract_snapshots"("room_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_dorm_entity_time" ON "audit_logs"("dormitory_id", "entity_type", "created_at");

-- 4. Financial Non-Negative Check Constraints for Building Overrides
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_monthly_rent_non_negative" CHECK ("monthly_rent" IS NULL OR "monthly_rent" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_deposit_non_negative" CHECK ("deposit_amount" IS NULL OR "deposit_amount" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_water_rate_non_negative" CHECK ("water_rate" IS NULL OR "water_rate" >= 0);
ALTER TABLE "buildings" ADD CONSTRAINT "chk_building_electricity_rate_non_negative" CHECK ("electricity_rate" IS NULL OR "electricity_rate" >= 0);

-- 5. Financial Non-Negative Check Constraints for Room Overrides
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_monthly_rent_non_negative" CHECK ("monthly_rent" IS NULL OR "monthly_rent" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_deposit_non_negative" CHECK ("deposit_amount" IS NULL OR "deposit_amount" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_water_rate_non_negative" CHECK ("water_rate" IS NULL OR "water_rate" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "chk_room_electricity_rate_non_negative" CHECK ("electricity_rate" IS NULL OR "electricity_rate" >= 0);
