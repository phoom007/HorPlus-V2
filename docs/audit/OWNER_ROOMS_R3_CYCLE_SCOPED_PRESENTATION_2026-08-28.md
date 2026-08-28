# OWNER ROOMS R3 AUDIT DOCUMENTATION
**Date:** 2026-08-28
**Topic:** Cycle-Scoped Room Presentation + Registered Building Identity + Actionable Create Error
**Target Branch:** `fix/owner-rooms-r3-cycle-scoped-presentation-20260828`
**Base Commit:** `a10d837dc045ff267ff79ecdc01bad6ab10741e4`
**Status:** READY FOR INDEPENDENT R3 REVIEW

---

## 1. Executive Summary

OWNER ROOMS R3 unifies room occupancy and agreement presentation across all three Owner Rooms presentation modes (**Grid**, **List**, and **Floor**) to display data for the **same selected billing cycle** used by the Owner Meter workspace, adhering to Product Owner decisions:
1. **Decision A (YES)**: Grid, List, and Floor modes all display occupancy, tenant, rent rate, and agreement deposit information scoped to the currently selected billing cycle.
2. **Decision B (B1)**: For rooms with no active agreement or occupancy in the selected billing cycle, the system displays the **current Room catalog rates** with explicit visual/semantic labeling (`อัตราปัจจุบัน`), without fabricating historical price snapshots.
3. **Registered Building Identity**: Room location is formatted consistently using the registered `Building.name` (`formatRoomLocation`), eliminating hardcoded A/B abbreviations.
4. **Edit Modal Integrity**: The Edit Room modal strictly loads latest authoritative Room catalog data as of NOW from `queryKeys.rooms(dormId)`, preserving full isolation from selected cycle projections.
5. **Single Canonical Cycle Authority**: `Owner` shell remains the sole authority for billing cycle selection, passing `dormitoryId`, `selectedBillingCycleId`, `selectedCycleCode`, and `billingCycles` to `OwnerRooms`.

---

## 2. Canonical Tab Dependency & Query Architecture

### Canonical Query Authority: `getTargetQueriesForTab`
In `src/pages/owner.tsx`, `getTargetQueriesForTab('rooms', dormId, cycleId)` registers the canonical queries for the Rooms tab:
- `queryKeys.rooms(dormId)` (stale time: 120s)
- `queryKeys.buildings(dormId)` (stale time: 120s)
- `queryKeys.tenants(dormId)` (stale time: 60s)
- `queryKeys.contracts(dormId)` (stale time: 60s)
- `queryKeys.bills(dormId)` (stale time: 60s)
- `queryKeys.meterPreviewContext(dormId, cycleId)` (when `cycleId` is present; stale time: 60s)

`OwnerRooms` consumes this same query key directly without registering a duplicate custom key.

---

## 3. Backend Meter Service Preview Context DTO Extension

In `server/src/services/meter.service.ts`, `MeterService.getMeterBillingPreviewContext` was enriched to expose explicit agreement metadata and canonical lifecycle state for each room:

```ts
rooms: Array<{
  roomId: string;
  roomNumber: string;
  tenantId: string | null;
  tenantName: string | null;
  billingSource: 'CONTRACT' | 'PROVISIONAL_MONTHLY' | 'PROVISIONAL_TERM' | 'DAILY_STAY' | 'NONE';
  agreementType: 'MONTHLY' | 'TERM' | 'DAILY' | null;
  agreementDepositAmount: string | null;
  cyclePresentationState: 'ACTIVE_AGREEMENT' | 'RESERVED_IN_CYCLE' | 'DAILY_FINANCIAL_TAIL' | 'NO_AGREEMENT_IN_CYCLE';
  rentAmount: string;
  rentDescription: string;
  ...
}>
```

### State & Agreement Resolution Rules:
1. **CONTRACT**:
   - `agreementType`: `'TERM'` if `contract.rentBillingType === 'term'`, else `'MONTHLY'`.
   - `agreementDepositAmount`: Snapshot resolved deposit if present, fallback to `contract.depositAmount`. Explicit zero (`"0.00"`) preserved.
   - `cyclePresentationState`: `'ACTIVE_AGREEMENT'`.
2. **PROVISIONAL_MONTHLY**:
   - `agreementType`: `'MONTHLY'`.
   - `agreementDepositAmount`: `prov.depositAmount`.
   - `cyclePresentationState`: `'ACTIVE_AGREEMENT'`.
3. **PROVISIONAL_TERM**:
   - `agreementType`: `'TERM'`.
   - `agreementDepositAmount`: `prov.depositAmount`.
   - `cyclePresentationState`: `'ACTIVE_AGREEMENT'`.
4. **DAILY_STAY**:
   - `agreementType`: `'DAILY'`.
   - `agreementDepositAmount`: Authoritative daily agreement/invoice deposit.
   - `cyclePresentationState`: `'ACTIVE_AGREEMENT'`.
5. **RESERVED_IN_CYCLE**:
   - Future reservation in selected cycle: `cyclePresentationState = 'RESERVED_IN_CYCLE'`.
6. **DAILY_FINANCIAL_TAIL**:
   - Checked-out Daily stay with unpaid invoice in the cycle: `cyclePresentationState = 'DAILY_FINANCIAL_TAIL'`.
7. **NO_AGREEMENT_IN_CYCLE**:
   - Room has no active agreement or reservation in the cycle: `cyclePresentationState = 'NO_AGREEMENT_IN_CYCLE'`, `agreementType = null`, `agreementDepositAmount = null`.

---

## 4. Frontend Single Presentation Authority: `resolveRoomCyclePresentation`

In `src/lib/roomRentalSummary.ts`, the unified presentation projection resolves cycle state without performing independent date arithmetic:

```ts
export function resolveRoomCyclePresentation(
  room: Room,
  meterPreviewRoom?: any,
  billingCycleId?: string
): RoomCyclePresentation {
  const currentCatalogRates = getCatalogRates(room);
  ...
}
```

### Presentation Modes Uniformity:
- **Grid Mode**:
  - Location: `formatRoomLocation(bldName, room.floor)` (e.g. `อาคารชาญวิทย์ (A) • ชั้น 1`).
  - Active in Cycle: Renders `ผู้เช่าตามงวด`, `อัตราค่าเช่าตามงวด` (single agreement rate), and agreement deposit (`formatBaht(agreementDepositAmount)` or `ไม่พบข้อมูลค่าประกันตามงวด`).
  - No Agreement in Cycle: Renders `ไม่มีผู้เช่าในงวดนี้`, `อัตราปัจจุบัน` (all current room catalog rates), and `ไม่มีผู้เช่าลงทะเบียน` for deposit.
- **List Mode**:
  - Location: `formatRoomLocation(bldName, room.floor)`.
  - Active in Cycle: Primary bold agreement rate with label `อัตราตามงวด`.
  - No Agreement in Cycle: Current catalog rates labeled `อัตราปัจจุบัน`.
- **Floor Mode**:
  - Group Header: Registered `bld.name`.
  - Active in Cycle: Occupied badge (`มีผู้เช่า`), agreement rent amount, and tenant name.
  - No Agreement in Cycle: Vacant badge (`ว่าง`), current catalog monthly rent labeled `อัตราปัจจุบัน`.

---

## 5. Registered Building Identity Resolution

Building identity is resolved directly from the registered `Building.name` stored in PostgreSQL:
```ts
export function formatRoomLocation(buildingName?: string | null, floor?: number | string | null): string {
  const bld = buildingName?.trim() || 'ไม่ระบุอาคาร';
  const fl = floor !== undefined && floor !== null ? `ชั้น ${floor}` : 'ไม่ระบุชั้น';
  return `${bld} • ${fl}`;
}
```
- Example: Registered name `อาคารชาญวิทย์ (A)` + floor `1` -> `อาคารชาญวิทย์ (A) • ชั้น 1`.
- No derived or hardcoded A/B letters from room numbers or array indexes.

---

## 6. Create Room Error Reproduction Gate

### Reproduction Diagnosis
- Target endpoint: `POST /api/v1/properties/rooms`
- Test payload: Room `A110`, `buildingId: d979246a-30e1-498b-9173-9c8fc801b33c`, `monthlyRent: "4500.00"`, `termDeposit: "4500.00"`, etc.
- Result: **HTTP 201 Created** (Success).
- Duplicate attempt: **HTTP 409 Conflict** (`ROOM_NUMBER_ALREADY_EXISTS`).
- Classification: **`ORIGINAL SCREENSHOT FAILURE UNPROVEN — CURRENT SOURCE CREATE PASS`**.
- No artificial transport changes were made, preserving strict diff hygiene.

---

## 7. Verification & Test Matrix

### 1. Backend Targeted Vitest Suite
File: `server/src/__tests__/unit/owner-rooms-r3-meter-preview-context.test.ts`
- [x] 1. MONTHLY Contract in selected cycle: `agreementType = MONTHLY`, rent, and authoritative deposit.
- [x] 2. TERM Contract in selected cycle: `agreementType = TERM`.
- [x] 3. DAILY Stay currently active in selected cycle: `agreementType = DAILY` and daily agreement deposit.
- [x] 4. Future reservation in selected cycle: `cyclePresentationState = RESERVED_IN_CYCLE`.
- [x] 5. Room with NO agreement in selected cycle: `cyclePresentationState = NO_AGREEMENT_IN_CYCLE`.
- [x] 6. Checked-out Daily Stay with unpaid invoice in cycle: `cyclePresentationState = DAILY_FINANCIAL_TAIL`.

**Result:** 6 / 6 tests passed (100%).

### 2. Frontend Targeted Vitest Suite
File: `src/tests/owner-rooms-r2-cycle-deposits.test.tsx`
- [x] 1. `formatRoomLocation` formats registered `Building.name` and floor consistently.
- [x] 2. `resolveRoomCyclePresentation` projects historical cycle agreement (rent 4500 vs current catalog 6000).
- [x] 3. `resolveRoomCyclePresentation` applies Decision B1 when room has NO agreement in selected cycle.
- [x] 4. Edit modal uses current Room catalog rates (6000) and is isolated from selected cycle.
- [x] 5-29. Full R2/R2.1/R2.1b regression suite.

**Result:** 29 / 29 tests passed (100%).

### 3. Build & Type Checking
- `npm run lint` (`tsc --noEmit`): PASSED (0 errors).
- `npm --prefix server run build` (`tsc -p tsconfig.build.json`): PASSED (0 errors).
- `git diff --check`: PASSED (0 whitespace issues).

---


---

## 9. R3.1 — Independent Review Corrections

### 1. Defect Analysis & Floor Mode Correction
- **R3 Defect**: While Grid and List modes consumed `resolveRoomCyclePresentation`, Floor mode JSX continued to directly inspect `room.status`, `room.currentTenantId`, and `room.monthlyRent`.
- **R3.1 Correction**: Floor mode room rendering is refactored to consume the exact same `resolveRoomCyclePresentation(room, meterPreviewRoom, selectedBillingCycleId)` projection as Grid and List:
  - **ACTIVE_AGREEMENT**: Displays `มีผู้เช่า` badge, cycle agreement rent amount with proper unit suffix (e.g. `4,500 / ด.`), and cycle tenant name (`occupancy.tenantName`). Click navigates to `onNavigate('tenants', occupancy.tenantId)`.
  - **NO_AGREEMENT_IN_CYCLE**: Displays `ว่างในงวดนี้`, Product Owner Decision B1 primary current catalog rate explicitly marked as `อัตราปัจจุบัน` (`฿ 6,000 / ด.`). Does not leak current operational tenant into historical cycle.
  - **RESERVED_IN_CYCLE**: Displays `จองแล้ว` badge and reservation applicant name.
  - **DAILY_FINANCIAL_TAIL**: Displays `ค้างชำระ` badge and daily guest name with daily rent amount.

### 2. Strict Backend DTO Projection (Part C)
- Removed all frontend fallback reconstruction logic from `resolveRoomCyclePresentation`:
  - `cyclePresentationState` is strictly read from backend DTO. Missing/malformed -> fails closed to `UNAVAILABLE`.
  - `agreementType` (`MONTHLY` | `TERM` | `DAILY`) is required from backend for `ACTIVE_AGREEMENT`. Missing -> fails closed to `UNAVAILABLE`.
  - `agreementDepositAmount` is strictly read from backend DTO (explicit numeric zero `0` / `"0.00"` is preserved). No fallback to `dailyDepositAmount` or catalog deposits.
  - Zero date arithmetic in frontend presentation layer.

### 3. Dormitory Authority & Defaults Loader Hardening (Parts D & E)
- `OwnerRoomsProps` now requires `dormitoryId: string` (no optionality).
- `loadDormDefaults` communicates with `{ dormitoryId }` option directly without deriving dormitory identity from `buildings[0].dormitoryId` or `localStorage` keys. Reloads on `[dormitoryId]` dependency.

### 4. Shared Preview Query Function (Part F)
- Extracted pure query function `fetchMeterPreviewContext(dormitoryId, billingCycleId)` in `src/lib/queryClient.ts`.
- Both `getTargetQueriesForTab('rooms')` in `src/pages/owner.tsx` and `useQuery` in `src/pages/owner/rooms.tsx` share the identical fetch implementation and canonical query key `queryKeys.meterPreviewContext(dormitoryId, selectedBillingCycleId)`.

### 5. Verification Matrix (R3.1)
- **Frontend Focused Vitest Suite**: `src/tests/owner-rooms-r2-cycle-deposits.test.tsx` -> **40 / 40 passed (100%)**.
  - Strict projection validation (ACTIVE_AGREEMENT, UNAVAILABLE on missing state/type, explicit zero deposit, B1 NO_AGREEMENT, unselected/missing cycle responses).
  - Floor mode production scenarios (Historical occupied A, Historical vacant B, Reserved C, Daily tail D).
  - Grid/List/Floor consistency verification.
- **Backend Targeted Vitest Suite**: `server/src/__tests__/unit/owner-rooms-r3-meter-preview-context.test.ts` -> **6 / 6 passed (100%)**.
- **TypeScript Typecheck**: `npm run lint` (`tsc --noEmit`) -> **0 errors**.
- **Backend Build**: `npm --prefix server run build` (`tsc -p tsconfig.build.json`) -> **0 errors**.
- **Git Diff Hygiene**: `git diff --check` -> **0 warnings**.

---

## 10. Final Status

**READY FOR PRODUCT OWNER R3 MANUAL UAT**
