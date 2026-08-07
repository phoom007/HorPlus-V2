# Wave 1G — Final Sealed Canonical Execution Evidence Closure Report

## Executive Summary

This report establishes the final, sealed canonical execution evidence for Wave 1G Scope-Record No-Op, Default Mutation Separation, and Snapshot Integrity in HorPlus-V2. All runtime implementations and tests published up to commit `9c50ba3` are preserved unaltered. All mandatory backend, frontend, Playwright, fresh database migration, schema drift check, migration audit, Wave 1F upgrade, room reconciliation, SQL catalog, Docker compose, and health checks have been executed, verified, and sealed with complete execution metadata below.

---

## 1. Provenance & Branch Metadata

- **Repository**: `D:\horplus_wave1d_fasttrack`
- **Branch**: `feature/wave1g-property-room-defaults`
- **PR #3 Base Branch**: `recovery/wave1d-fasttrack`
- **PR #3 Base SHA**: `9e6dc9e35a5fe2b2637f2a241a39999609bec03a`
- **Starting verification SHA**: `231e7fe`
- **Final implementation/test SHA**: `9c50ba3`
- **Previous report-content SHA**: `020e4fa53456e6d67579f539a700bb552eb2793b`
- **Final report commit SHA**: returned externally after push
- **Final remote SHA**: returned externally after push
- **PR #3 State**: Open (Unmerged)
- **TASK-009 State**: NOT STARTED

---

## 2. Forward-Only Commit Log

```text
4b34dc2 fix(wave1g): separate default mutation from room effects
9c50ba3 test(wave1g): prove changed defaults with zero eligible rooms
c45e833 docs(wave1g): publish complete execution evidence
020e4fa docs(wave1g): publish complete canonical execution evidence
<new evidence-only commit>
```

---

## 3. Complete Sealed Execution Verification Gates

### Backend Verification Gates

1. **`npm run lint`**
   - **Exact Command**: `npm run lint`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `13.2s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `tsc --noEmit` passed clean with 0 type errors.

2. **`npm run build`**
   - **Exact Command**: `npm run build`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `10.9s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `tsc -p tsconfig.build.json` compiled server dist binaries cleanly without error.

3. **`npm test`**
   - **Exact Command**: `$env:DATABASE_URL="postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public"; npm test`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `23.58s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `Test Files  20 passed (20) | Tests  199 passed (199)` (20 / 20 test files passed, 199 / 199 tests passed cleanly).

4. **`npx tsc --noEmit`**
   - **Exact Command**: `npx tsc --noEmit`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `13.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**: TypeScript compilation clean with 0 errors.

5. **`npx prisma validate`**
   - **Exact Command**: `npx prisma validate`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `1.1s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `The schema at prisma\schema.prisma is valid 🚀`.

6. **`npx prisma generate`**
   - **Exact Command**: `npx prisma generate`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `1.8s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `✔ Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client in 806ms`.

---

### Frontend Verification Gates

1. **`npm run lint`**
   - **Exact Command**: `npm run lint`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `8.4s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `tsc --noEmit` passed clean with 0 type errors.

2. **`npm run build`**
   - **Exact Command**: `npm run build`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `12.96s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `vite build` completed in 12.96s (`dist/assets/index-Cr6rTzqQ.js` 1,730.42 kB).

3. **`npm test`**
   - **Exact Command**: `npm test`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `7.20s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `Test Files  5 passed (5) | Tests  32 passed | 1 skipped (33)` (5 / 5 test files passed, 32 passed, 1 skipped).

4. **`npx tsc --noEmit`**
   - **Exact Command**: `npx tsc --noEmit`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `8.1s`
   - **Exit Code**: `0`
   - **Sanitized Result**: Main frontend React TypeScript type check clean with 0 errors.

5. **`npx tsc --noEmit -p tsconfig.e2e.json`**
   - **Exact Command**: `npx tsc --noEmit -p tsconfig.e2e.json`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `2.4s`
   - **Exit Code**: `0`
   - **Sanitized Result**: Playwright E2E TypeScript type check clean with 0 errors.

---

### Playwright E2E Verification Gates (`$env:CI="1"`)

1. **Focused Playwright Suite**
   - **Exact Command**: `$env:CI="1"; npx playwright test tests/e2e/wave1g-property.spec.ts`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `43.2s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `2 tests passed` (`2 passed (43.2s)` covering zero-eligible room propagation and room override clearing API verification).

2. **Complete Playwright Suite**
   - **Exact Command**: `$env:CI="1"; npx playwright test`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `1.2m` (72.0s)
   - **Exit Code**: `0`
   - **Sanitized Result**: `7 tests passed` (`7 passed (1.2m)` covering full end-to-end suite across all test files).

---

## 4. Fresh Database Migration Audit

Database Target: PostgreSQL instance at `127.0.0.1:5455` (Database: `horplus_fresh_migration_audit_db`)

1. **First `npx prisma migrate deploy`**
   - **Exact Command**: `$env:DATABASE_URL="postgresql://horplus:password@127.0.0.1:5455/horplus_fresh_migration_audit_db?schema=public"; npx prisma migrate deploy`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `4.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**:
     ```text
     9 migrations found in prisma/migrations
     Applying migration `20260802111717_wave1d_clean_baseline`
     Applying migration `20260803150203_wave1e_tenant_payments_receipts`
     Applying migration `20260804045646_wave1e_payment_constraints`
     Applying migration `20260804052600_wave1e_payment_upload_intents`
     Applying migration `20260804080500_wave1e_upload_intent_integrity_and_rules`
     Applying migration `20260805130000_wave1f_subscriptions_entitlements`
     Applying migration `20260805140000_wave1f_subscription_fk_corrective`
     Applying migration `20260805210000_wave1g_property_room_defaults`
     Applying migration `20260806110000_wave1g_corrective_fk_and_indexes`
     All migrations have been successfully applied.
     ```

2. **Second `npx prisma migrate deploy`**
   - **Exact Command**: `$env:DATABASE_URL="postgresql://horplus:password@127.0.0.1:5455/horplus_fresh_migration_audit_db?schema=public"; npx prisma migrate deploy`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `2.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `9 migrations found in prisma/migrations. No pending migrations to apply.`

3. **`npx prisma migrate status`**
   - **Exact Command**: `$env:DATABASE_URL="postgresql://horplus:password@127.0.0.1:5455/horplus_fresh_migration_audit_db?schema=public"; npx prisma migrate status`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `3.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `9 migrations found in prisma/migrations. Database schema is up to date!`

4. **Real Schema Drift Check**
   - **Exact Command**: `npx prisma migrate diff --from-migrations prisma/migrations --to-url "postgresql://horplus:password@127.0.0.1:5455/horplus_fresh_migration_audit_db?schema=public" --shadow-database-url "postgresql://horplus:password@127.0.0.1:5455/horplus_shadow?schema=public" --exit-code`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
   - **Duration**: `3.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `No difference detected.` (Zero schema drift).

5. **`_prisma_migrations` Audit Query**
   - **Exact Command**: `docker exec horplus_wave1d_fasttrack-db-1 psql -U horplus -d horplus_fresh_migration_audit_db -c "SELECT migration_name, started_at, finished_at, applied_steps_count, rolled_back_at FROM _prisma_migrations ORDER BY started_at;"`
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `1.0s`
   - **Exit Code**: `0`
   - **Sanitized Output (9 Rows)**:

| migration_name | started_at | finished_at | applied_steps_count | rolled_back_at |
|---|---|---|---|---|
| 20260802111717_wave1d_clean_baseline | 2026-08-07 02:30:45.140407+00 | 2026-08-07 02:30:45.436666+00 | 1 | NULL |
| 20260803150203_wave1e_tenant_payments_receipts | 2026-08-07 02:30:45.452406+00 | 2026-08-07 02:30:45.508045+00 | 1 | NULL |
| 20260804045646_wave1e_payment_constraints | 2026-08-07 02:30:45.523872+00 | 2026-08-07 02:30:45.54033+00 | 1 | NULL |
| 20260804052600_wave1e_payment_upload_intents | 2026-08-07 02:30:45.552152+00 | 2026-08-07 02:30:45.569959+00 | 1 | NULL |
| 20260804080500_wave1e_upload_intent_integrity_and_rules | 2026-08-07 02:30:45.58796+00 | 2026-08-07 02:30:45.622265+00 | 1 | NULL |
| 20260805130000_wave1f_subscriptions_entitlements | 2026-08-07 02:30:45.639147+00 | 2026-08-07 02:30:45.71942+00 | 1 | NULL |
| 20260805140000_wave1f_subscription_fk_corrective | 2026-08-07 02:30:45.732115+00 | 2026-08-07 02:30:45.752734+00 | 1 | NULL |
| 20260805210000_wave1g_property_room_defaults | 2026-08-07 02:30:45.785124+00 | 2026-08-07 02:30:45.869985+00 | 1 | NULL |
| 20260806110000_wave1g_corrective_fk_and_indexes | 2026-08-07 02:30:45.893662+00 | 2026-08-07 02:30:45.971346+00 | 1 | NULL |

---

## 5. Representative Wave 1F Upgrade Audit

- **Execution Script**: `node scripts/verify-wave1f-upgrade.cjs`
- **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
- **Duration**: `10.0s`
- **Exit Code**: `0`
- **Before Counts**: `preDorms: 1, preBills: 1, preBlds: 1, preRms: 2, preTnts: 1, preCtrs: 1, preSnaps: 0`
- **After Counts**: `postDorms: 1, postBills: 1, postBlds: 1, postRms: 2, postTnts: 1, postCtrs: 1, postSnaps: 0`
- **Preserved Identities**:
  - Dormitory name: `Pre-1G Upgrade Dormitory` (Preserved)
  - Building code: `Tower A (TA-01)` (Preserved)
  - Room 101 exact `roomNumber`: `'101'`, `monthlyRent`: `5500` (Preserved)
  - Room 102 exact `roomNumber`: `'102'`, `monthlyRent`: `4500` (Preserved)
  - Tenant: `Somchai Upgrade` (Preserved)
  - Contract: `CTR-UPG-001` (Preserved)
  - Auto-created `DormitoryPropertyDefaults`: YES (`dormitoryId` matched, default rent = 0)
  - Fabricated ContractSnapshots: 0 (No unexpected snapshot creations or row deletions).

---

## 6. Room Normalization Reconciliation Audit

- **Execution Script**: `node scripts/run-reconciliation-tests.cjs`
- **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
- **Duration**: `7.0s`
- **Exit Code**: `0`

### 1. Controlled Conflict Test (`A101` vs `a101`)
- **Invocation**: `reconcileRoomNormalization(prisma, dorm1Id)`
- **Result Status**: Controlled abort (`success: false`, `scannedCount: 2`, `updatedCount: 0`)
- **Reported Conflicts**:
  ```json
  [
    {
      "dormitoryId": "6309eebe-5a1d-415c-814b-1efc81ef0f26",
      "buildingId": "ff8adb7e-d138-4245-a0b7-75a61eda18fe",
      "roomId": "449cc789-a622-4ff6-9962-25c5c17f274b",
      "exactRoomNumber": "a101",
      "oldNormalizedValue": "a101",
      "newNormalizedValue": "a101",
      "conflictGroup": "6309eebe-5a1d-415c-814b-1efc81ef0f26::a101"
    },
    {
      "dormitoryId": "6309eebe-5a1d-415c-814b-1efc81ef0f26",
      "buildingId": "ff8adb7e-d138-4245-a0b7-75a61eda18fe",
      "roomId": "8f72514d-85ad-4943-81e4-5e20eae925f6",
      "exactRoomNumber": "A101",
      "oldNormalizedValue": "A101",
      "newNormalizedValue": "a101",
      "conflictGroup": "6309eebe-5a1d-415c-814b-1efc81ef0f26::a101"
    }
  ]
  ```
- **Assertions**: Both Room IDs reported, 0 partial writes, no room renames, 0 deletions.

### 2. Non-Conflict Test (`A 101` vs `B 101`)
- **Invocation**: `reconcileRoomNormalization(prisma, dorm2Id)`
- **Result Status**: Success (`success: true`, `scannedCount: 2`, `updatedCount: 2`, `conflicts: []`)
- **Assertions**: Normalized `A 101` to `a101` and `B 101` to `b101` cleanly with 0 conflicts.

---

## 7. SQL Database Catalogs

Executed on database `horplus_fresh_migration_audit_db` on port 5455:

1. **Foreign Keys Query**
   - **SQL Query**: `SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' ORDER BY tc.table_name, kcu.column_name;`
   - **Verified Count**: `86 foreign keys`

2. **Indexes Query**
   - **SQL Query**: `SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;`
   - **Verified Count**: `108 indexes`

3. **Check Constraints Query**
   - **SQL Query**: `SELECT rel.relname AS table_name, con.conname AS constraint_name FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid WHERE con.contype = 'c' ORDER BY relname, conname;`
   - **Verified Count**: `35 check constraints`

4. **Dormitory + normalizedRoomNumber Uniqueness Query**
   - **SQL Query**: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'rooms' AND indexname LIKE '%normalized_room_number%';`
   - **Verified Result**: `dormitory_normalized_room_number_unique` ON `rooms(dormitory_id, normalized_room_number)`.

---

## 8. Docker Execution Audit (`docker-compose.windows-pilot.yml`)

1. **`docker compose ... config`**
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `1.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**: Parsed valid Compose configuration defining `api`, `db`, and `redis` services.

2. **`docker compose ... build`**
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `67.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `Image horplus_wave1d_fasttrack-api Built` successfully.

3. **`docker compose ... up -d`**
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `3.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**: `Container horplus_wave1d_fasttrack-api-1 Started` and healthy.

4. **`docker compose ... ps`**
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `3.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**:

| Container Name | Service | Image | Status | Exposed Ports |
|---|---|---|---|---|
| `horplus_wave1d_fasttrack-api-1` | `api` | `horplus_wave1d_fasttrack-api` | Up (healthy) | `0.0.0.0:3000->3000/tcp` |
| `horplus_wave1d_fasttrack-db-1` | `db` | `postgres:15` | Up (healthy) | `0.0.0.0:5455->5432/tcp` |
| `horplus_wave1d_fasttrack-redis-1` | `redis` | `redis:7-alpine` | Up (healthy) | `0.0.0.0:6380->6379/tcp` |

5. **`docker compose ... logs --no-color --tail=250`**
   - **Working Directory**: `D:\horplus_wave1d_fasttrack`
   - **Duration**: `1.0s`
   - **Exit Code**: `0`
   - **Sanitized Result**: Log stream inspected showing clean PostgreSQL checkpoints and container startup.

---

## 9. Production API Health Verification (Port 3000)

Exact Node/HTTP Invocation Command:
```powershell
node -e "const http = require('http'); const endpoints = ['/api/v1/health/liveness', '/api/v1/health/readiness', '/api/v1/health/metrics']; endpoints.forEach(ep => { http.get('http://127.0.0.1:3000' + ep, res => { let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => console.log(ep, 'STATUS:', res.statusCode, 'BODY:', data)); }); });"
```

1. **`/api/v1/health/liveness`**
   - **HTTP Status Code**: `200 OK`
   - **Sanitized Output**: `{"status":"UP","service":"horplus-api","timestamp":"2026-08-07T02:35:35.806Z"}`

2. **`/api/v1/health/readiness`**
   - **HTTP Status Code**: `200 OK`
   - **Sanitized Output**: `{"status":"UP","database":"UP","redis":"UP","repositoryMode":"PRISMA_POSTGRESQL","timestamp":"2026-08-07T02:35:35.815Z"}`

3. **`/api/v1/health/metrics`**
   - **HTTP Status Code**: `200 OK`
   - **Sanitized Output**: `{"uptimeSeconds":11,"totalRequests":4,"activeRequests":2,"memoryUsageMb":{"rss":131.37,"heapTotal":31.51,"heapUsed":29.29},"timestamp":"2026-08-07T02:35:35.812Z"}`

---

## 10. Limitations & Final Status

- **Runtime Limitations**: None
- **Evidence Limitations**: None
- **PR #3 State**: Open (Unmerged)
- **TASK-009 State**: NOT STARTED

**WAVE 1G PROPERTY, ROOM DEFAULTS AND SNAPSHOTS: PASSED**
