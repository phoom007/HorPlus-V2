-- Follow-up migration: Owner Rooms R3.2a Operational Status Baseline
-- Baseline establishes exactly 1 row per existing room at the canonical operational cycle.
-- Executed via idempotent application service on startup / seed / deployment.
SELECT 1;
