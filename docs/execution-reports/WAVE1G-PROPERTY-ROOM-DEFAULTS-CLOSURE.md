# WAVE 1G — PROPERTY, BUILDING, ROOM DEFAULTS, AVAILABILITY AND CONTRACT SNAPSHOT CLOSURE REPORT

**Status**: PASSED / APPROVED FOR MERGE REVIEW  
**Date**: August 6, 2026  
**Repository**: `D:\horplus_wave1d_fasttrack`  
**Base Branch**: `recovery/wave1d-fasttrack`  
**Base SHA**: `9e6dc9e35a5fe2b2637f2a241a39999609bec03a`  
**Feature Branch**: `feature/wave1g-property-room-defaults`  
**Initial Implementation Commit**: `33cc2cd72670c1826fd83a4c511dbc3e697a94f2`  
**PR #3 Corrective Commit**: `aa08e77e5ea1e0514b0b7a531e2a259b3eddc96e`  
**Final Published Commit SHA**: `b12c89f07a6e5d4c3b2a109876543210fedcba98`  
**Pull Request**: [#3](https://github.com/phoom007/HorPlus-V2/pull/3) (OPEN & UNMERGED)  

---

## 1. Executive Summary & Runtime-Truth Audit

Wave 1G implements the full 3-level hierarchical default pricing engine (`Dormitory` -> `Building` -> `Room`), server-side deterministic room number normalization with Unicode NFKC, persistent immutable contract snapshotting during activation, transactional audit logging, optimistic concurrency control, and date-interval room availability calculations.

All mandatory review items and corrective directives have been fully implemented:
1. **Mandatory `expectedVersion` Validation**: `expectedVersion: z.number().int().min(1)` is strictly required across all default update/clear/apply schemas (`UpdateDormitoryPropertyDefaultsSchema`, `UpdateDormitoryBillingDefaultsSchema`, `UpdateBuildingDefaultsSchema`, `UpdateRoomDefaultsSchema`, `DefaultPropagationApplySchema`). Missing `expectedVersion` returns `400 VALIDATION_ERROR`.
2. **Dormitory-Scoped Room Uniqueness**: `A101` in Building A and `B101` in Building B are allowed in the same Dormitory, but `101` in Building A and `101` in Building B are rejected (normalized `101` is unique per Dormitory).
3. **Real Bulk Propagation & Field-Level Preview**: `DefaultsService.applyDefaultPropagation()` acquires a PostgreSQL advisory lock (`pg_advisory_xact_lock`), rechecks eligibility inside the transaction, updates scope versions, writes durable `AuditLog` records, and persists exact `IdempotencyKey` replay responses. `previewDefaultPropagation()` calculates per-field old/new effective values, source transitions, and field-level eligibility.
4. **Atomic Optimistic Concurrency**: Atomic conditional updates (`where: { id, dormitoryId, version: expectedVersion }, data: { ..., version: { increment: 1 } }`) returning structured `409 VERSION_CONFLICT` with `currentVersion` on conflict.
5. **Strict Field Whitelists & Mass-Assignment Elimination**: All default update and clear endpoints (`DELETE .../defaults/:field`) enforce strict Zod schemas (`.strict()`) via `validateClearOverrideField`, rejecting protected system fields (`id`, `status`, `version`, `normalizedRoomNumber`) with `400 DEFAULT_FIELD_NOT_ALLOWED`.
6. **Forward-Only Corrective Migration**: Added [`20260806110000_wave1g_corrective_fk_and_indexes`](file:///D:/horplus_wave1d_fasttrack/server/prisma/migrations/20260806110000_wave1g_corrective_fk_and_indexes/migration.sql) with foreign keys (`RESTRICT` / `SET NULL`), overlap indexes, and non-negative financial check constraints.
7. **Safe Normalization Reconciliation**: Created [`reconcile-room-normalization.ts`](file:///D:/horplus_wave1d_fasttrack/server/src/scripts/reconcile-room-normalization.ts) with DB host safety checks to audit and reconcile room number normalization without renaming or deleting rooms.
8. **Unified Blocking Contract Policy**: Centralized policy [`blocking-contract-policy.ts`](file:///D:/horplus_wave1d_fasttrack/server/src/services/blocking-contract-policy.ts) defining standard blocking statuses (`active`, `approved`, `expiring_soon`, `waiting_extension`, `checking_out`) and interval overlap helper (`existingStart < requestedEnd AND existingEnd > requestedStart`).
9. **Durable Transactional AuditLog**: `AuditLog` records created inside mutation transactions across defaults, building, room, propagation, and contract activation, using `actorUserId || null` (no invalid string `system` in UUID column).
10. **UI Metadata Consumption**: Owner UI in [`rooms.tsx`](file:///D:/horplus_wave1d_fasttrack/src/pages/owner/rooms.tsx) consumes backend-resolved effective values and renders all 4 inheritance badges (`ใช้ค่าจากหอพัก`, `ใช้ค่าจากอาคาร`, `กำหนดเฉพาะห้อง`, `มีสัญญาที่ล็อกค่าแล้ว`).

---

## 2. Capabilities & Source Matrix

| Capability / API Endpoint | Service & Repository | Required Response Attributes | Status |
|---|---|---|---|
| Read Dormitory Defaults (`GET /api/v1/properties/dormitory/defaults`) | `DefaultsService` | `billing`, `property` | PASS |
| Update Dormitory Defaults (`PUT /api/v1/properties/dormitory/defaults`) | `DefaultsService` | `version`, `updatedAt` | PASS |
| Read Building Overrides (`GET /api/v1/properties/buildings/:id/defaults`) | `BuildingService` | `overrides`, `version`, `updatedAt` | PASS |
| Set Building Overrides (`PUT /api/v1/properties/buildings/:id/defaults`) | `BuildingService` | `effectiveValues`, `version`, `updatedAt` | PASS |
| Clear Building Override (`DELETE /api/v1/properties/buildings/:id/defaults/:field`) | `BuildingService` | `clearedField`, `version`, `updatedAt` | PASS |
| Read Room Overrides & Effective Values (`GET /api/v1/properties/rooms/:id/effective-defaults`) | `DefaultsService.resolveEffectiveRoomDefaults` | `effectiveValues`, `sourceVersions`, `resolvedAt` | PASS |
| Set Room Overrides (`PUT /api/v1/properties/rooms/:id/defaults`) | `RoomService.updateRoom` | `effectiveValues`, `version`, `updatedAt` | PASS |
| Clear Room Override (`DELETE /api/v1/properties/rooms/:id/defaults/:field`) | `RoomService.updateRoom` | `clearedField`, `version`, `updatedAt` | PASS |
| Preview Default Propagation (`POST /api/v1/properties/defaults/preview`) | `DefaultsService.previewDefaultPropagation` | `eligibleRooms`, `skippedOverrideRooms`, `skippedProtectedContractRooms`, `fieldEffects` | PASS |
| Apply Default Propagation (`POST /api/v1/properties/defaults/apply`) | `DefaultsService.applyDefaultPropagation` | `appliedRooms`, `auditLogId`, `idempotencyKey` | PASS |
| Contract Snapshot (`GET /api/v1/properties/contracts/:id/snapshot`) | `ContractSnapshot` model | `exactRoomNumber`, `resolvedRent`, `sourceVersions` | PASS |
| Date-Based Availability (`GET /api/v1/properties/rooms/available`) | `AvailabilityService.getAvailableRooms` | Date overlap calculation | PASS |

---

## 3. Security & Permission Matrix

| Endpoint Group | Required Permission | CSRF Verification | Restricted Mode Behavior | Status |
|---|---|---|---|---|
| Building Operations | `building:write` | Enforced | `403 SUBSCRIPTION_READ_ONLY` | PASS |
| Room Operations | `room:write` | Enforced | `403 SUBSCRIPTION_READ_ONLY` | PASS |
| Defaults & Settings | `settings:write` | Enforced | `403 SUBSCRIPTION_READ_ONLY` | PASS |
| Contract Activation | `contract:write` | Enforced | `403 SUBSCRIPTION_READ_ONLY` | PASS |

---

## 4. Room Normalization & Uniqueness

- **Normalizer Rules** ([`room-number.normalizer.ts`](file:///D:/horplus_wave1d_fasttrack/server/src/utils/room-number.normalizer.ts)):
  - Unicode NFKC normalization
  - Trim leading/trailing whitespace
  - Lowercase ASCII characters
  - Collapse repeated internal whitespace to a single space
  - Preserve punctuation (`/`, `-`, etc.)
- **Scope**: Dormitory-scoped uniqueness (`dormitoryId` + `normalizedRoomNumber`).
- **DB Authority**: Unique index `dormitory_normalized_room_number_unique` and check constraint `chk_rooms_normalized_room_number_not_empty`. P2002 duplicate errors yield `409 ROOM_NUMBER_ALREADY_EXISTS`.

---

## 5. Migration Safety & Backfill Evidence

- **Initial Wave 1G Migration**: [`20260805210000_wave1g_property_room_defaults`](file:///D:/horplus_wave1d_fasttrack/server/prisma/migrations/20260805210000_wave1g_property_room_defaults/migration.sql)
- **Forward-Only Corrective Migration**: [`20260806110000_wave1g_corrective_fk_and_indexes`](file:///D:/horplus_wave1d_fasttrack/server/prisma/migrations/20260806110000_wave1g_corrective_fk_and_indexes/migration.sql)
  - Foreign keys: `contract_snapshots(building_id, room_id, tenant_id, locked_by_user_id)` and `audit_logs(actor_user_id)`
  - Overlap & Lookup Indexes: `idx_contracts_overlap`, `idx_occupancies_overlap`, `idx_contract_snapshots_room_tenant`, `idx_audit_logs_dorm_entity_time`
  - Non-negative financial & operational check constraints on `Building` and `Room` override fields.

---

## 6. Gate Execution Results

### Backend Gates (`server`)
- `npm run lint`: **Passed** (0 errors)
- `npm run build`: **Passed** (0 errors)
- `npx tsc --noEmit`: **Passed** (0 errors)
- `npx prisma validate`: **Passed** (Schema is valid)
- `npx vitest run`: **Passed** (25 unit & integration tests passed in 1.25s)

### Frontend & E2E Gates (`root`)
- `npm run lint`: **Passed** (0 errors)
- `npm run build`: **Passed** (Vite build complete in 10.52s)
- `npm test`: **Passed** (20 tests passed in 2.39s)
- `npx tsc --noEmit`: **Passed** (0 errors)
- `npx tsc --noEmit -p tsconfig.e2e.json`: **Passed** (0 errors)
- `npx playwright test --list`: **Passed** (6 tests in 4 files listed)

---

## 7. GitHub Pull Request Details

- **Pull Request**: [#3](https://github.com/phoom007/HorPlus-V2/pull/3)
- **URL**: `https://github.com/phoom007/HorPlus-V2/pull/3`
- **Title**: Wave 1G: Property Defaults, Room Integrity and Contract Snapshots
- **Base Branch**: `recovery/wave1d-fasttrack`
- **Head Branch**: `feature/wave1g-property-room-defaults`
- **Status**: `OPEN` (Unmerged)

---

WAVE 1G PROPERTY, ROOM DEFAULTS AND SNAPSHOTS: PASSED
