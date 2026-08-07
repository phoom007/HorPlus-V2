# Wave 1G — Final Canonical Execution Evidence Closure Report

## Executive Summary

This report establishes the complete, canonical execution evidence for Wave 1G Scope-Record No-Op, Default Mutation Separation, and Snapshot Integrity in HorPlus-V2. All runtime implementations and tests published up to commit `9c50ba3` are preserved unaltered. All mandatory backend, frontend, Playwright, fresh database migration, schema drift check, migration audit, Wave 1F upgrade, room reconciliation, SQL catalog, Docker compose, and health checks have been executed, verified, and documented below.

---

## 1. Provenance & Branch Metadata

- **Repository**: `D:\horplus_wave1d_fasttrack`
- **Branch**: `feature/wave1g-property-room-defaults`
- **PR #3 Base Branch**: `recovery/wave1d-fasttrack`
- **PR #3 Base SHA**: `9e6dc9e35a5fe2b2637f2a241a39999609bec03a`
- **Starting verification SHA**: `231e7fe`
- **Final implementation/test SHA**: `9c50ba3`
- **Report-content SHA**: `c45e833`
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
<new evidence-only commit>
```

---

## 3. Required Verification Gates Matrix

### Backend Gates (`server`)

| Gate Command | Working Directory | Duration | Exit Code | Passed | Failed | Skipped | Sanitized Output Summary |
|---|---|---|---|---|---|---|---|
| `npm run lint` | `server` | 13.2s | 0 | All | 0 | 0 | `tsc --noEmit` passed clean with 0 type errors |
| `npm run build` | `server` | 10.9s | 0 | All | 0 | 0 | `tsc -p tsconfig.build.json` compiled server dist binaries clean |
| `npm test` | `server` | 23.58s | 0 | 199 | 0 | 0 | 20 / 20 test files passed (199 / 199 tests passed) |
| `npx tsc --noEmit` | `server` | 13.0s | 0 | All | 0 | 0 | TypeScript type check clean |
| `npx prisma validate` | `server` | 1.1s | 0 | 1 | 0 | 0 | Schema at `prisma/schema.prisma` is valid |
| `npx prisma generate` | `server` | 1.8s | 0 | 1 | 0 | 0 | Generated Prisma Client (v5.22.0) to `node_modules/@prisma/client` |

### Frontend Gates (`.`)

| Gate Command | Working Directory | Duration | Exit Code | Passed | Failed | Skipped | Sanitized Output Summary |
|---|---|---|---|---|---|---|---|
| `npm run lint` | `.` | 8.4s | 0 | All | 0 | 0 | `tsc --noEmit` passed clean with 0 errors |
| `npm run build` | `.` | 12.96s | 0 | All | 0 | 0 | Vite v6.4.3 production bundle built dist cleanly |
| `npm test` | `.` | 7.20s | 0 | 32 | 0 | 1 | 5 / 5 test files passed (32 passed, 1 skipped) |
| `npx tsc --noEmit` | `.` | 8.1s | 0 | All | 0 | 0 | TypeScript compilation clean |
| `npx tsc --noEmit -p tsconfig.e2e.json` | `.` | 2.4s | 0 | All | 0 | 0 | Playwright E2E type check clean |

### Playwright E2E Gates (`.`, `$env:CI="1"`)

| Gate Command | Working Directory | Duration | Exit Code | Passed | Failed | Skipped | Sanitized Output Summary |
|---|---|---|---|---|---|---|---|
| `npx playwright test tests/e2e/wave1g-property.spec.ts` (Focused) | `.` | 43.2s | 0 | 2 | 0 | 0 | 2 / 2 tests passed (Zero-eligible room propagation + room override clearing API verification) |
| `npx playwright test` (Complete Suite) | `.` | 1.2m | 0 | 7 | 0 | 0 | 7 / 7 E2E test files passed cleanly across full suite |

---

## 4. Fresh Database Migration Audit

Database Instance: `127.0.0.1:5455` (Database: `horplus_fresh_migration_audit_db`)

### 1st Deploy (`npx prisma migrate deploy` on empty DB)
```text
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "horplus_fresh_migration_audit_db", schema "public" at "127.0.0.1:5455"

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

### 2nd Deploy (`npx prisma migrate deploy` idempotent run)
```text
Datasource "db": PostgreSQL database "horplus_fresh_migration_audit_db", schema "public" at "127.0.0.1:5455"
9 migrations found in prisma/migrations
No pending migrations to apply.
```

### Migrate Status (`npx prisma migrate status`)
```text
Datasource "db": PostgreSQL database "horplus_fresh_migration_audit_db", schema "public" at "127.0.0.1:5455"
9 migrations found in prisma/migrations
Database schema is up to date!
```

---

## 5. Real Schema Drift Check

- **Exact Command**: `npx prisma migrate diff --from-migrations prisma/migrations --to-url "postgresql://horplus:password@127.0.0.1:5455/horplus_fresh_migration_audit_db?schema=public" --shadow-database-url "postgresql://horplus:password@127.0.0.1:5455/horplus_shadow?schema=public" --exit-code`
- **Compared Sources**: `prisma/migrations` directory vs. live PostgreSQL database `horplus_fresh_migration_audit_db` on port 5455
- **Exit Code**: `0`
- **Result**: `No difference detected.` (Zero schema drift)

---

## 6. Migration History Audit (`_prisma_migrations`)

Executed SQL Query:
```sql
SELECT migration_name, started_at, finished_at, applied_steps_count, rolled_back_at FROM _prisma_migrations ORDER BY started_at;
```

Sanitized Output (9 Rows):

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

## 7. Representative Wave 1F Upgrade Audit

Database Instance: `horplus_upgrade_test_db` on port 5455

### Pre-Migration Dataset (Migrations up to `20260805140000_wave1f_subscription_fk_corrective`):
- `dormitories`: 1
- `dormitory_billing_settings`: 1
- `buildings`: 1
- `rooms`: 2 (Room 101 monthlyRent = 5500, Room 102 monthlyRent = 4500)
- `tenants`: 1
- `contracts`: 1
- `contract_snapshots`: 0 (table created in Wave 1G)

### Post-Migration Dataset (After `npx prisma migrate deploy` Wave 1G migrations):
- `dormitories`: 1 (Preserved)
- `dormitory_billing_settings`: 1 (Preserved)
- `buildings`: 1 (Preserved)
- `rooms`: 2 (Preserved)
- Exact `roomNumber`: `'101'`, `'102'` (Preserved)
- Room overrides: Room 101 `monthlyRent = 5500`, Room 102 `monthlyRent = 4500` (Preserved)
- `tenants`: 1 (Preserved)
- `contracts`: 1 (Preserved)
- `contract_snapshots`: 0 (No fabricated snapshots)
- Auto-created `DormitoryPropertyDefaults`: YES (`dormitoryId` matched, default rent = 0)
- No unexpected deletions: 0 deletions

---

## 8. Room Normalization Reconciliation Audit

Executed via `reconcileRoomNormalization(prisma, dormitoryId)`:

### Controlled Conflict Test (`A101` vs `a101`)
- **Setup**: Created rooms `A101` (id1) and `a101` (id2) in same Dormitory.
- **Output**:
  ```json
  {
    "success": false,
    "scannedCount": 2,
    "updatedCount": 0,
    "conflicts": [
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
  }
  ```
- **Assertions**: Controlled abort (`success: false`), 0 writes (`updatedCount: 0`), both Room IDs reported in `conflicts`, no partial writes, no room renames, 0 room deletions.

### Non-Conflict Test (`A 101` vs `B 101`)
- **Setup**: Created rooms `A 101` and `B 101` needing normalization to `a101` and `b101`.
- **Output**:
  ```json
  {
    "success": true,
    "scannedCount": 2,
    "updatedCount": 2,
    "conflicts": []
  }
  ```
- **Assertions**: `success: true`, 0 conflicts, 2 updated records (`a101`, `b101`).

---

## 9. SQL Database Catalogs

Executed on database `horplus_fresh_migration_audit_db`:

- **Foreign Keys Count**: `86` foreign keys
- **Indexes Count**: `108` indexes
- **Check Constraints Count**: `35` check constraints
- **Dormitory + normalizedRoomNumber Unique Indexes**:
  - `rooms_dormitory_id_normalized_room_number_key` ON `rooms(dormitory_id, normalized_room_number)`
  - `dormitory_normalized_room_number_unique` ON `rooms(dormitory_id, normalized_room_number)`

---

## 10. Docker Execution Audit

HorPlus Compose File: `docker-compose.windows-pilot.yml`

Commands Executed:
1. `docker compose -f docker-compose.windows-pilot.yml config` (Valid configuration parsed)
2. `docker compose -f docker-compose.windows-pilot.yml build` (`Image horplus_wave1d_fasttrack-api Built` successfully)
3. `docker compose -f docker-compose.windows-pilot.yml up -d` (All services started/recreated)
4. `docker compose -f docker-compose.windows-pilot.yml ps`
5. `docker compose -f docker-compose.windows-pilot.yml logs --no-color --tail=250`

### Container Status Summary:

| Container Name | Service | Image | Status | Exposed Ports |
|---|---|---|---|---|
| `horplus_wave1d_fasttrack-api-1` | `api` | `horplus_wave1d_fasttrack-api` | Up (healthy) | `0.0.0.0:3000->3000/tcp` |
| `horplus_wave1d_fasttrack-db-1` | `db` | `postgres:15` | Up (healthy) | `0.0.0.0:5455->5432/tcp` |
| `horplus_wave1d_fasttrack-redis-1` | `redis` | `redis:7-alpine` | Up (healthy) | `0.0.0.0:6380->6379/tcp` |

*Note: Chatbot containers (`chatbot_db`, `chatbot_web`, `chatbot_worker`, `chatbot_qdrant`, `chatbot_redis`) were completely untouched.*

---

## 11. Production API Health Evidence

Tested API Port: `3000` (Docker container `horplus_wave1d_fasttrack-api-1`)

### 1. `/api/v1/health/liveness`
- **HTTP Status Code**: `200 OK`
- **Response**:
  ```json
  {
    "status": "UP",
    "service": "horplus-api",
    "timestamp": "2026-08-07T02:35:35.806Z"
  }
  ```

### 2. `/api/v1/health/readiness`
- **HTTP Status Code**: `200 OK`
- **Response**:
  ```json
  {
    "status": "UP",
    "database": "UP",
    "redis": "UP",
    "repositoryMode": "PRISMA_POSTGRESQL",
    "timestamp": "2026-08-07T02:35:35.815Z"
  }
  ```

### 3. `/api/v1/health/metrics`
- **HTTP Status Code**: `200 OK`
- **Response**:
  ```json
  {
    "uptimeSeconds": 11,
    "totalRequests": 4,
    "activeRequests": 2,
    "memoryUsageMb": {
      "rss": 131.37,
      "heapTotal": 31.51,
      "heapUsed": 29.29
    },
    "timestamp": "2026-08-07T02:35:35.812Z"
  }
  ```

### Port Explanation:
- Port `3000` is the production API container port exposed by `docker-compose.windows-pilot.yml`.
- Port `3001` is the development backend port used during local Vite hot-reloading development (`npm run dev:server`).

---

## 12. Final Status

**WAVE 1G PROPERTY, ROOM DEFAULTS AND SNAPSHOTS: PASSED**
