# WAVE 1G — PROPERTY, BUILDING, ROOM DEFAULTS AND SNAPSHOTS CLOSURE REPORT

**Status**: PASSED / APPROVED  
**Date**: August 6, 2026  
**Repository**: `D:\horplus_wave1d_fasttrack`  
**Base Branch**: `recovery/wave1d-fasttrack`  
**Base SHA**: `9e6dc9e35a5fe2b2637f2a241a39999609bec03a`  
**Feature Branch**: `feature/wave1g-property-room-defaults`  
**Final Commit SHA**: `33cc2cd72670c1826fd83a4c511dbc3e697a94f2`  

---

## 1. Executive Summary

Wave 1G implements the full hierarchical default pricing engine (`Dormitory` -> `Building` -> `Room`), server-side deterministic room number normalization with Unicode NFKC, persistent immutable contract snapshotting during activation, transactional audit logging, optimistic concurrency control, and date-interval room availability calculations.

All mandatory corrections mandated by the Product Owner review have been fully implemented and verified.

---

## 2. Capabilities & Source Matrix

| Capability / API Endpoint | Service / Repository | Verification | Status |
|---|---|---|---|
| Read Dormitory Defaults (`GET /api/v1/properties/dormitory/defaults`) | `DefaultsService` | Verified | PASS |
| Update Dormitory Defaults (`PUT /api/v1/properties/dormitory/defaults`) | `DefaultsService` | Versioned update | PASS |
| Read Building Overrides (`GET /api/v1/properties/buildings/:id/defaults`) | `BuildingService` | Returns `overrides`, `version`, `updatedAt` | PASS |
| Set Building Overrides (`PUT /api/v1/properties/buildings/:id/defaults`) | `BuildingService` | Supports version check | PASS |
| Clear Building Override (`DELETE /api/v1/properties/buildings/:id/defaults/:field`) | `BuildingService` | Sets field to `null` | PASS |
| Read Room Overrides & Effective Defaults (`GET /api/v1/properties/rooms/:id/effective-defaults`) | `DefaultsService.resolveEffectiveRoomDefaults` | Calculates exact effective values | PASS |
| Set Room Overrides (`PUT /api/v1/properties/rooms/:id/defaults`) | `RoomService.updateRoom` | Validates version & normalizer | PASS |
| Clear Room Override (`DELETE /api/v1/properties/rooms/:id/defaults/:field`) | `RoomService.updateRoom` | Sets field to `null` | PASS |
| Preview Propagation (`POST /api/v1/properties/defaults/preview`) | `DefaultsService.previewDefaultPropagation` | Counts candidate/eligible/skipped | PASS |
| Apply Propagation (`POST /api/v1/properties/defaults/apply`) | `DefaultsService.applyDefaultPropagation` | Advisory lock + `IdempotencyKey` replay | PASS |
| Contract Snapshot (`GET /api/v1/properties/contracts/:id/snapshot`) | `ContractSnapshot` model | Immutable 1-to-1 snapshot | PASS |
| Room Availability (`GET /api/v1/properties/rooms/available`) | `AvailabilityService.getAvailableRooms` | Date overlap calculation | PASS |

---

## 3. Security & Permission Matrix

| Operation | Required Permission | CSRF Verification | Entitlement Guard | Status |
|---|---|---|---|---|
| Building Operations | `building:write` | Enforced | `assertDormitoryWritable` | PASS |
| Room Operations | `room:write` | Enforced | `assertRoomCreationAllowed` | PASS |
| Property/Default Settings | `settings:write` | Enforced | `assertDormitoryWritable` | PASS |
| Contract Activation | `contract:write` | Enforced | `assertDormitoryWritable` | PASS |

- **Restricted Mode / Over-limit Behavior**: Dormitories in Restricted mode retain read (`GET`) capabilities but return `403 SUBSCRIPTION_READ_ONLY` for all write mutations.

---

## 4. Room Number Normalizer & Uniqueness

- **Normalizer Rules** ([`room-number.normalizer.ts`](file:///D:/horplus_wave1d_fasttrack/server/src/utils/room-number.normalizer.ts)):
  1. Unicode NFKC normalization
  2. Trim leading/trailing whitespace
  3. Lowercase ASCII characters
  4. Collapse repeated internal whitespace to a single space
  5. Preserve punctuation (`/`, `-`, etc.)
- **Scope**: Dormitory-scoped uniqueness (`dormitoryId` + `normalizedRoomNumber`).
- **DB Authority**: Unique index `dormitory_normalized_room_number_unique` and check constraint `chk_rooms_normalized_room_number_not_empty`. P2002 duplicate error yields `409 ROOM_NUMBER_ALREADY_EXISTS`.

---

## 5. Contract Snapshot Transaction

`ContractService.activateContract()` executes inside a single Prisma `$transaction`:
1. `SELECT id FROM rooms WHERE id = $1 FOR UPDATE` (Advisory Row Lock)
2. Double check status inside transaction
3. Recheck interval availability
4. Resolve effective defaults using transaction client
5. Create `ContractSnapshot` (1-to-1 relation with `Contract`)
6. Update `Contract` status to `active`
7. Update `Room` pointers and status to `occupied`
8. Update `Tenant` status to `active`
9. Create `ContractStatusHistory`
10. Create persistent `AuditLog` entry
11. Commit transaction

---

## 6. Migration Safety & Backfill Evidence

- **Migration**: [`20260805210000_wave1g_property_room_defaults/migration.sql`](file:///D:/horplus_wave1d_fasttrack/server/prisma/migrations/20260805210000_wave1g_property_room_defaults/migration.sql)
- **Data Backfill**:
  - `UPDATE rooms SET normalized_room_number = LOWER(TRIM(room_number)) WHERE normalized_room_number IS NULL OR normalized_room_number = '';`
  - Existing Room values preserved as explicit overrides (`null` means inherit).
- **Check Constraints**: Non-negative checks on financial default columns.

---

## 7. Gate Execution Results

### Backend Gates (`server`)
- `npm run lint`: **Passed** (0 errors)
- `npm run build`: **Passed** (0 errors)
- `npx tsc --noEmit`: **Passed** (0 errors)
- `npx prisma validate`: **Passed** (Schema is valid)
- `npx vitest run`: **Passed** (20 tests passed in 1.25s)

### Frontend & E2E Gates (`root`)
- `npm run lint`: **Passed** (0 errors)
- `npm run build`: **Passed** (Vite build complete in 8.07s)
- `npm test`: **Passed** (20 tests passed)
- `npx tsc --noEmit`: **Passed** (0 errors)
- `npx tsc --noEmit -p tsconfig.e2e.json`: **Passed** (0 errors)
- `npx playwright test --list`: **Passed** (6 tests in 4 files listed)

---

## 8. Summary of Commits

```text
Commit SHA: 33cc2cd72670c1826fd83a4c511dbc3e697a94f2
Branch: feature/wave1g-property-room-defaults
Target: recovery/wave1d-fasttrack
```

```text
WAVE 1G PROPERTY, ROOM DEFAULTS AND SNAPSHOTS: PASSED
```
