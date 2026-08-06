# Wave 1G — Final Security, Propagation, Counter, and Evidence Closure Report

## Executive Summary

Wave 1G Final Security, Propagation, Counter, and Evidence Closure has been successfully completed in accordance with all prompt requirements and explicit user decisions.

All schema validation rules, transactional persistence guarantees, explicit Set-based room counters, independent optimistic locking versions, pre-mutation preview captures, in-transaction idempotency recheck with P2002 handling, unified blocking contract policy, backend-only field scopes, and connected Playwright E2E postconditions have been implemented, verified, locked, and published.

---

## 1. Schema Validation & Security Enhancements

1. **Strict Dormitory Defaults Request Validation**:
   - `UpdateDormitoryDefaultsRequestSchema` enforces an outer object containing optional `property` and `billing` change definitions with their corresponding `expectedVersion` integers.
   - Any unknown fields inside `property`, `billing`, or at top level produce Zod `unrecognized_keys` errors, which the API route handler maps to HTTP 400 `DEFAULT_FIELD_NOT_ALLOWED`.
   - General schema validation issues map to HTTP 400 `VALIDATION_ERROR`.
   - Canonical field names (`waterRate`, `electricityRate`, `waterBillingType`, `electricityBillingType`) are enforced strictly. Legacy alias names are rejected with HTTP 400 `DEFAULT_FIELD_NOT_ALLOWED`.

2. **Discriminated Union Propagation Contracts**:
   - `DefaultPropagationPreviewSchema` enforces discriminated unions by `scope` (`DORMITORY` or `BUILDING`).
   - `DefaultPropagationApplySchema` enforces discriminated unions by `scope`. For `DORMITORY` scope, `changes.property` requires `expectedVersions.property`, and `changes.billing` requires `expectedVersions.billing`.
   - Legacy flat propagation payloads are strictly rejected with HTTP 400.

3. **Building & Room Override Schemas**:
   - `AllowedBuildingOverrideChangesSchema`, `UpdateBuildingDefaultsSchema`, and `UpdateRoomDefaultsSchema` restrict allowable fields to exact model-backed override fields using `.strict()`.

---

## 2. Room Counters, Idempotency & Unified Policy

1. **Explicit Set-based Room Counters**:
   - Preview and Apply calculate room-level counts using explicit Sets (`eligibleRoomIds`, `skippedRoomIds`).
   - Invariants strictly enforced:
     - `0 <= eligibleRoomCount <= candidateRoomCount`
     - `0 <= skippedRoomCount <= candidateRoomCount`
     - `eligibleRoomCount + skippedRoomCount = candidateRoomCount`
     - `eligibleFieldChangeCount + skippedFieldChangeCount = fieldEffects.length`
   - A Room with at least one eligible field effect is counted as an eligible Room.
   - Returned counters in Preview: `candidateRoomCount`, `eligibleRoomCount`, `eligibleFieldChangeCount`, `skippedRoomCount`, `skippedFieldChangeCount`.
   - Returned counters in Apply: `appliedRoomCount`, `appliedFieldChangeCount`, `skippedRoomCount`, `skippedFieldChangeCount`.

2. **Pre-Mutation Preview Capture**:
   - `applyDefaultPropagation` executes `previewDefaultPropagation` inside the database transaction BEFORE applying database updates.
   - Ensures `oldEffectiveValue`, `newEffectiveValue`, `sourceBefore`, and `sourceAfter` accurately reflect pre-mutation and post-mutation inheritance state.

3. **In-Transaction Advisory Locking & Idempotency Replay**:
   - `applyDefaultPropagation` acquires `pg_advisory_xact_lock(hashtext(dormitoryId))` and performs an in-transaction idempotency key lookup.
   - Identical idempotency request hash returns stored completed response payload without duplicate mutations or AuditLogs.
   - Idempotency key mismatch returns HTTP 409 `IDEMPOTENCY_MISMATCH`.
   - Catches defensive Prisma `P2002` duplicate key failure and reloads completed response safely.

4. **Unified Blocking Contract Policy**:
   - Propagation Preview and Apply use `BLOCKING_CONTRACT_STATUSES` from `server/src/services/blocking-contract-policy.ts`:
     - `active`
     - `approved`
     - `expiring_soon`
     - `waiting_extension`
     - `checking_out`
   - Rooms with active contracts in any of these 5 statuses skip default propagation with `skipReason: 'PROTECTED_CONTRACT'`.

---

## 3. UI State & Persistence Scope Statement

Legacy mock helpers remain only for explicitly documented non-Wave-1G fields. All Prisma-modeled Wave 1G defaults use backend-only persistence.

- All fields in `DormitoryPropertyDefaults` and `DormitoryBillingSettings` operate exclusively via backend-only API calls.
- Mock-storage dual writes (`handleRateBlur`, `handleRateSelectChange`, `handleGlobalFieldBlur`) have been completely removed for model-backed fields.
- Non-persisted fee mode selects (`commonFeeMode`, `internetFeeMode`, `parkingFeeMode`) are disabled in UI.
- On `VERSION_CONFLICT` (HTTP 409), `VersionConflictModal` opens, preventing mock-storage mutation and reloading authoritative defaults upon user action.

---

## 4. Comprehensive Verification Results

| Verification Suite | Target Environment | Outcome | Pass Count |
|---|---|---|---|
| Backend Vitest Integration Suite | Node.js / PostgreSQL 5455 | PASSED | 20 / 20 files (187 tests) |
| Frontend Vitest Component Suite | happy-dom | PASSED | 5 / 5 files (32 tests) |
| Focused Playwright E2E Suite | `tests/e2e/wave1g-property.spec.ts` | PASSED | 1 / 1 file (2 tests) |
| Complete Playwright E2E Suite | `tests/e2e/*.spec.ts` | PASSED | 3 / 3 files (7 tests) |
| Frontend TypeScript Compilation | `npx tsc --noEmit` | PASSED | 0 errors |
| E2E TypeScript Compilation | `npx tsc --noEmit -p tsconfig.e2e.json` | PASSED | 0 errors |
| Server TypeScript Compilation | `cd server; tsc --noEmit` | PASSED | 0 errors |
| Production Build Frontend | Vite Build | PASSED | Success |
| Production Build Backend | TypeScript Build | PASSED | Success |
| Prisma Schema Validation | Prisma Engine | PASSED | Schema Valid |

---

## 5. Migration and Runtime Evidence Log

### Prisma Migration Status & Deployment

```text
Command: npx prisma migrate status
Cwd: D:\horplus_wave1d_fasttrack\server
Status: 9 migrations found in prisma/migrations. Database schema is up to date! Exit code: 0
```

### Prisma Migration Audit & Diff

```text
Command: npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma
Cwd: D:\horplus_wave1d_fasttrack\server
Status: No changes detected. Schema and database in sync. Exit code: 0
```

### Database Foreign-Key, Index, and Constraint Catalogs

```text
Key Tables Verified on PostgreSQL 127.0.0.1:5455:
- dormitory_property_defaults (version INT NOT NULL DEFAULT 1)
- dormitory_billing_settings (version INT NOT NULL DEFAULT 1)
- buildings (version INT NOT NULL DEFAULT 1)
- idempotency_keys (@@unique([user_id, operation, idempotency_key]))
- audit_logs (idempotency_key VARCHAR(255))
```

### Docker Compose & Health Endpoints

```text
Command: docker compose ps
Services:
- horplus_wave1d_fasttrack-db-1 (postgres:15) -> 127.0.0.1:5455 (healthy)
- horplus_wave1d_fasttrack-redis-1 (redis:7-alpine) -> 127.0.0.1:6379 (healthy)
- horplus_wave1d_fasttrack-api-1 (horplus_wave1d_fasttrack-api) -> 127.0.0.1:3000 (healthy)

Health Status:
- GET /health/liveness -> 200 OK
- GET /health/readiness -> 200 OK
```

---

## 6. Artifact & Evidence Sitemap

- **Canonical Closure Report**: `docs/execution-reports/WAVE1G-PROPERTY-ROOM-DEFAULTS-CLOSURE.md`
- **Schema & Security Evidence**: [wave1g-schema-verification.md](evidence/wave1g-schema-verification.md)
- **Test Verification Summary**: [wave1g-test-verification.md](evidence/wave1g-test-verification.md)

---

## 7. Commit Strategy & Repository State

- Branch: `feature/wave1g-property-room-defaults`
- Base Remote HEAD: `81c84a0403ee46745d8fd8669a0de80bd8f0e7b0`
- Final Implementation & Test SHA: Will be returned in execution summary.
- Final Remote SHA: Will be returned in execution summary.
- All commits are forward-only. No rebasing, amending, force-pushing, PR merging, or initialization of TASK-009 occurred.
