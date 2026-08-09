-- Account-level benefit claims ledger must not be partitioned by dormitory context
DROP POLICY IF EXISTS account_benefit_claims_isolation ON "account_benefit_claims";
ALTER TABLE "account_benefit_claims" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_benefit_claims" DISABLE ROW LEVEL SECURITY;
