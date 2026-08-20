-- 1. Ensure canonical 'STAFF' role exists for any dormitory where 'TECH' exists
INSERT INTO "roles" ("id", "dormitory_id", "code", "name", "permissions", "is_system", "created_at", "updated_at")
SELECT 
    gen_random_uuid(),
    t.dormitory_id,
    'STAFF',
    'พนักงานทั่วไป',
    '{"rooms":["view"],"tenants":["view"],"meters":["view","record"],"maintenance":["view","update"]}'::jsonb,
    true,
    NOW(),
    NOW()
FROM (
    SELECT DISTINCT dormitory_id 
    FROM "roles" 
    WHERE "code" = 'TECH' AND dormitory_id IS NOT NULL
) t
WHERE NOT EXISTS (
    SELECT 1 FROM "roles" s 
    WHERE s.dormitory_id = t.dormitory_id AND s.code = 'STAFF'
);

-- 2. Remap dormitory_members pointing to TECH to the corresponding STAFF role
UPDATE "dormitory_members" dm
SET "role_id" = s.id,
    "updated_at" = NOW()
FROM "roles" t
JOIN "roles" s ON (s.dormitory_id = t.dormitory_id OR (s.dormitory_id IS NULL AND t.dormitory_id IS NULL)) AND s.code = 'STAFF'
WHERE dm.role_id = t.id AND t.code = 'TECH';

-- 3. Remap dormitory_access_grants with role_code = 'TECH' to 'STAFF'
UPDATE "dormitory_access_grants"
SET "role_code" = 'STAFF',
    "updated_at" = NOW()
WHERE "role_code" = 'TECH';

-- 4. Disable/Revoke legacy FINANCE accounts (fail closed, no automatic promotion)
UPDATE "dormitory_access_grants"
SET "status" = 'REVOKED',
    "revoked_by_principal" = 'SYSTEM_MIGRATION_DEPRECATED_ROLE',
    "revoked_at" = NOW(),
    "updated_at" = NOW()
WHERE "role_code" = 'FINANCE' AND "status" != 'REVOKED';

UPDATE "dormitory_members" dm
SET "status" = 'revoked',
    "suspended_at" = NOW(),
    "updated_at" = NOW()
FROM "roles" r
WHERE dm.role_id = r.id AND r.code = 'FINANCE';

-- 5. Delete TECH and FINANCE role definitions where no foreign keys reference them
DELETE FROM "roles" r
WHERE r.code IN ('TECH', 'FINANCE')
  AND NOT EXISTS (SELECT 1 FROM "dormitory_members" dm WHERE dm.role_id = r.id);
