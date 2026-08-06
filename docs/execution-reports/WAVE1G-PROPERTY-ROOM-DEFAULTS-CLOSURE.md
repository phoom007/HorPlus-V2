# Wave 1G — Final Security, Propagation, Counter, and Evidence Closure Report

## Executive Summary

Wave 1G Final Security, Propagation, Counter, and Evidence Closure has been fully completed and validated in accordance with all explicit user directives and strict safety requirements.

All schema validation rules, transactional persistence guarantees, explicit Set-based room counters, independent optimistic locking versions, pre-mutation preview captures, in-transaction idempotency recheck with P2002 handling, unified blocking contract policy, backend-only field scopes, exact propagation preview/apply UI postconditions, and inheriting Room D101 snapshot separation proofs have been implemented, verified, locked, and published.

PR #3 remains open and unmerged. TASK-009 has not been started. All commits are forward-only.

---

## 1. Git & Scope Provenance

- **Repository**: `D:\horplus_wave1d_fasttrack`
- **Branch**: `feature/wave1g-property-room-defaults`
- **Pull Request**: `#3` (Open and unmerged)
- **Base SHA**: `231e7fe`
- **Starting Feature SHA**: `c98573cb1e617fb88802f5757e9f0ab1c3a8c078`
- **Implementation & Test SHA**: `61098180513e7bc051ff620182bbe56b34a502a9`
- **TASK-009 State**: NOT STARTED

---

## 2. Schema Validation & Security Enhancements

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

## 3. Room Counters, Idempotency & Unified Policy

1. **Explicit Set-based Room Counters**:
   - Preview and Apply calculate room-level counts using explicit Sets (`eligibleRoomIds`, `skippedRoomIds`).
   - Invariants strictly enforced:
     - `0 <= eligibleRoomCount <= candidateRoomCount`
     - `0 <= skippedRoomCount <= candidateRoomCount`
     - `eligibleRoomCount + skippedRoomCount = candidateRoomCount`
     - `eligibleFieldChangeCount + skippedFieldChangeCount = fieldEffects.length`
   - A Room with at least one eligible field effect is counted as an eligible Room.
   - Returned counters in Preview: `candidateRoomCount: 3`, `eligibleRoomCount: 2`, `eligibleFieldChangeCount: 8`, `skippedRoomCount: 1`, `skippedFieldChangeCount: 4`.
   - Returned counters in Apply: `appliedRoomCount: 2`, `appliedFieldChangeCount: 8`, `skippedRoomCount: 1`, `skippedFieldChangeCount: 4`.

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

## 4. UI Postconditions & Snapshot Separation Proof

1. **Exact Propagation UI Assertions**:
   - Hardcoded expected counters in Playwright E2E: `candidateRoomCount = 3`, `eligibleRoomCount = 2`, `eligibleFieldChangeCount = 8`, `skippedRoomCount = 1`, `skippedFieldChangeCount = 4`.
   - Direct locator by room + field identity: `preview-effect-C101-defaultMonthlyRent`, `preview-effect-B101-defaultMonthlyRent`, `preview-effect-A101-defaultMonthlyRent`.
   - Verified row elements: `oldEffectiveValue`, `newEffectiveValue`, `sourceBefore`, `sourceAfter`, `eligible`, `skipReason`.
   - Visible post-apply result counters asserted: `appliedRoomCount = 2`, `appliedFieldChangeCount = 8`, `skippedRoomCount = 1`, `skippedFieldChangeCount = 4`.
   - Inspected Room C101 card on `/owner/rooms` to confirm exact committed effective value `9,400` with `badge-dormitory`.

2. **Current-vs-Locked Snapshot Separation Proof (Inheriting Room D101)**:
   - Dedicated inheriting Room `D101` created via production API `POST /api/v1/properties/rooms`.
   - Override cleared via production API `DELETE /api/v1/properties/rooms/:id/defaults/monthlyRent`.
   - Verified authoritative Room API: `rawOverrides.monthlyRent = null`, `currentEffectiveValues.monthlyRent = 9,400`.
   - Activated Contract for D101 via API (`rentAmount = 4,300`, `depositAmount = 8,600`).
   - Verified authoritative ContractSnapshot: `monthlyRent = 4,300`, `depositAmount = 8,600`.
   - Updated dormitory default via API: `defaultMonthlyRent = 9,500`.
   - Verified authoritative Room API: `currentEffectiveValues.monthlyRent = 9,500`, `contractSnapshot.values.monthlyRent = 4,300`.
   - On `/owner/contracts` page, inspected D101 contract:
     - `locked-snapshot-section`: `Locked monthly rent: 4,300`, `Locked deposit: 8,600`.
     - `current-defaults-section`: `Current monthly rent: 9,500`.
     - Proved current and locked values are rendered in separate, distinct UI sections (`locked-snapshot-section` vs `current-defaults-section`).

---

## 5. Comprehensive Command Verification Matrix

| Command Category | Exact Command | Cwd | Exit Code | Passed | Failed | Skipped | Sanitized Result Summary |
|---|---|---|---|---|---|---|---|
| Backend Lint | `npm run lint` | `server` | 0 | All | 0 | 0 | TypeScript type check passed cleanly with 0 errors |
| Backend Build | `npm run build` | `server` | 0 | All | 0 | 0 | Compiled server dist binaries cleanly |
| Backend Vitest | `npm test` | `server` | 0 | 189 | 0 | 0 | 20 / 20 test files passed (189 / 189 tests) |
| Backend TSC | `npx tsc --noEmit` | `server` | 0 | All | 0 | 0 | TypeScript compilation clean |
| Prisma Validate | `npx prisma validate` | `server` | 0 | 1 | 0 | 0 | Schema `prisma/schema.prisma` is valid |
| Prisma Generate | `npx prisma generate` | `server` | 0 | 1 | 0 | 0 | Generated Prisma Client v5.22.0 |
| Frontend Lint | `npm run lint` | `.` | 0 | All | 0 | 0 | React TypeScript type check passed cleanly |
| Frontend Build | `npm run build` | `.` | 0 | All | 0 | 0 | Vite production bundle built dist in 12.14s |
| Frontend Vitest | `npm test` | `.` | 0 | 32 | 0 | 1 | 5 / 5 test files passed (32 passed, 1 skipped) |
| Frontend TSC | `npx tsc --noEmit` | `.` | 0 | All | 0 | 0 | TypeScript compilation clean |
| E2E TSC | `npx tsc --noEmit -p tsconfig.e2e.json` | `.` | 0 | All | 0 | 0 | Playwright E2E type check clean with 0 errors |
| Playwright E2E Focused | `$env:CI="1"; npx playwright test tests/e2e/wave1g-property.spec.ts` | `.` | 0 | 2 | 0 | 0 | 2 / 2 tests passed (API + UI full lifecycle) |
| Playwright E2E Full | `$env:CI="1"; npx playwright test` | `.` | 0 | 7 | 0 | 0 | 3 / 3 test files passed (7 / 7 E2E tests) |
| Disposable DB Deploy | `npx prisma migrate deploy` | `server` | 0 | 9 | 0 | 0 | Applied 9 migrations on `127.0.0.1:5455/horplus_disposable` |
| Disposable DB Status | `npx prisma migrate status` | `server` | 0 | 1 | 0 | 0 | Database schema is up to date |
| Docker Compose PS | `docker compose ps` | `.` | 0 | 4 | 0 | 0 | horplus_postgres, api, db, redis all Up (healthy) |
| Health Liveness | `GET http://127.0.0.1:3000/api/v1/health/liveness` | `.` | 0 | 1 | 0 | 0 | `{"status":"UP","service":"horplus-api"}` |
| Health Readiness | `GET http://127.0.0.1:3000/api/v1/health/readiness` | `.` | 0 | 1 | 0 | 0 | `{"status":"UP"}` |
| Health Metrics | `GET http://127.0.0.1:3000/api/v1/health/metrics` | `.` | 0 | 1 | 0 | 0 | `200 OK` |

---

## 6. Forward-Only Commit Log

```text
75d17be test(wave1g): remove prisma bypass from property lifecycle
ce126aa test(wave1g): assert exact owner ui postconditions
c98573c docs(wave1g): publish canonical execution truth
6109818 test(wave1g): assert exact propagation and snapshot separation
```

---

## 7. Artifact & Evidence Sitemap

- **Canonical Closure Report**: `docs/execution-reports/WAVE1G-PROPERTY-ROOM-DEFAULTS-CLOSURE.md`
- **Schema & Security Evidence**: [wave1g-schema-verification.md](evidence/wave1g-schema-verification.md)
- **Test Verification Summary**: [wave1g-test-verification.md](evidence/wave1g-test-verification.md)

---

## 8. Final Status

**WAVE 1G PROPERTY, ROOM DEFAULTS AND SNAPSHOTS: PASSED**
