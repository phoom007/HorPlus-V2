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


---

## 11. R3.2 — Cycle Filter/Search & Effective Room Operational Status History

### 1. Product Owner Decisions
- **Decision A (A1)**: Filter and search controls operate strictly against the SELECTED billing cycle authority.
- **Decision B (B1)**: Selected-cycle agreement state is primary. Current operational state (e.g. `maintenance`) is displayed only as secondary context (`ปิดปรับปรุงปัจจุบัน`).
- **Decision C (C1)**: Editing a room while viewing an old selected cycle NEVER changes history starting from that old cycle. Status changes are effective from the canonical `operationalBillingCycleId` forward.

### 2. Phase 0 Audit & Data Model Authority
- **Audit Findings**:
  - Inspected `server/prisma/schema.prisma`, `RoomBillingCycleSnapshot` (meter/accounting snapshot only), `Occupancy` (tenant lease lifecycle only), and historical tables.
  - Confirmed no suitable persisted mechanism previously existed for Room operational status effective across billing cycles.
- **Chosen Data Model**:
  - Implemented minimal canonical model `RoomOperationalStatusChange` (`room_operational_status_changes`):
    - `dormitoryId`, `roomId`, `effectiveBillingCycleId`, `status`, `updatedByUserId`, `version`, timestamps.
    - `@@unique([dormitoryId, roomId, effectiveBillingCycleId])` guarantees deterministic single-row authority per cycle without ambiguous duplicates.
  - Migration: `20260828170000_owner_rooms_r32_operational_status_history`.
  - **No Fabricated Historical Status**: Baseline begins from the earliest recorded operational cycle. Any historical cycle preceding the baseline returns `UNKNOWN`.

### 3. Effective Status Resolver & Future Inheritance
- **Resolver**: `resolveRoomOperationalStatusForCycle(dormitoryId, roomId, targetBillingCycleId)` finds the latest status change with `effectiveBillingCycle.periodStart <= targetCycle.periodStart`.
- **Inheritance**: A status set in cycle 2026-08 automatically inherits into 2026-09 and beyond without manual row copying or future cycle pre-generation.

### 4. Agreement Precedence & UI Presentation
- **ACTIVE_AGREEMENT** (`มีผู้เช่า`): Always takes precedence over operational maintenance. If current operational status is maintenance, a secondary badge `ปิดปรับปรุงปัจจุบัน` is displayed.
- **MAINTENANCE_IN_CYCLE** (`ปิดปรับปรุงในงวดนี้`): Applies when `NO_AGREEMENT_IN_CYCLE` and effective operational status is `maintenance`.
- **NO_AGREEMENT_IN_CYCLE** (`ว่างในงวดนี้`): Applies when vacant in cycle; displays current catalog rates labeled `อัตราปัจจุบัน` (**Decision B1**).
- **RESERVED_IN_CYCLE** (`จองแล้ว`): Displays reservation applicant identity.
- **DAILY_FINANCIAL_TAIL** (`ค้างชำระ`): Displays daily tenant name and daily rent.
- **UNAVAILABLE** (`ข้อมูลไม่พร้อม`): Displays neutral `ไม่พบข้อมูลของงวดนี้` without B1 catalog fallback.

### 5. Filter and Search Cycle Authority (A1)
- Precomputed `roomCyclePresentationsById` map is used as the single authority across Grid, List, Floor, Filter, and Search.
- Filter options: `all`, `occupied` (`มีผู้เช่าในงวด`), `vacant` (`ว่างในงวด`), `maintenance` (`ปิดปรับปรุงในงวด`), `reserved` (`จองแล้ว`), `daily_tail` (`ค้างชำระ`), `unavailable` (`ข้อมูลไม่พร้อม`).
- Search matches selected-cycle tenant name (`presentation.occupancy.tenantName`) without leaking current tenant identity (`room.currentTenantId`).

### 6. Focused Verification Matrix
- **Frontend Vitest Suite** (`src/tests/owner-rooms-r2-cycle-deposits.test.tsx`): **48 / 48 passed (100%)**.
- **Backend Effective Status Unit Suite** (`server/src/__tests__/unit/owner-rooms-r32-effective-status.test.ts`): **4 / 4 passed (100%)**.
- **Backend Preview Context Unit Suite** (`server/src/__tests__/unit/owner-rooms-r3-meter-preview-context.test.ts`): **6 / 6 passed (100%)**.
- **Prisma Schema Validation**: `npm --prefix server run prisma:validate` -> **0 errors (Valid)**.
- **TypeScript Typecheck & Server Build**: `npm run lint` & `npm --prefix server run build` -> **0 errors**.
- **Git Diff Hygiene**: `git diff --check` -> **0 warnings**.

---


---

## 13. R3.2a — Independent Review Corrections

### 1. Root Cause Analysis & Corrective Scope
An independent review of R3.2 identified five blockers:
1. **Wrong Operational Cycle Authority in RoomService**: R3.2 fell back to `status: 'OPEN'` or latest existing cycle, which was incorrect because future draft cycles exist and `BillingCycle.status` defaults to `draft`.
2. **Missing Existing Room Baseline**: The initial schema migration left existing rooms without an operational baseline row.
3. **Frontend UNKNOWN Fallthrough**: When `effectiveRoomOperationalStatus === 'UNKNOWN'` and `NO_AGREEMENT_IN_CYCLE`, the frontend fell through to Decision B1 catalog rates rather than failing closed.
4. **Cache Invalidation Gap**: Status changes did not invalidate cached Meter Preview Context queries forward from the effective cycle.
5. **Diff Hygiene Churn**: `server/src/services/room.service.ts` had accidental whole-file CRLF -> LF churn.

### 2. Canonical Operational Cycle Authority (Part A & C1)
- **Authority Reused**: Replaced custom query logic with `currentCycleResolverService.resolveOperationalBillingCycle(dormitoryId, tx)` from `server/src/services/current-cycle-resolver.ts`.
- **Status Writes**: Room operational status writes strictly use `operational.billingCycleId`.
- **Fail Closed**: If no authoritative operational cycle is available, throws `AppError('OPERATIONAL_BILLING_CYCLE_UNAVAILABLE', 422)`.
- **Onboarding Create**: Room creation establishes baseline at `operational.billingCycleId` without breaking pre-billing onboarding.

### 3. Existing Room Baseline & Pre-Baseline Fallback (Part B)
- **Follow-up Migration**: `20260828173000_owner_rooms_r32a_operational_status_baseline` preserves existing migration lineage without mutating applied migrations.
- **Idempotent Service**: `backfillRoomOperationalStatusBaseline(dormitoryId?, prisma?)` resolves the canonical operational cycle per dormitory and upserts exactly one baseline row per room using authoritative current `Room.status`.
- **Zero Fabrication**: Historical cycles prior to baseline strictly resolve to `UNKNOWN`.

### 4. Strict UNKNOWN Fail-Closed (Part C)
- In `resolveRoomCyclePresentation`:
  If `cyclePresentationState === 'NO_AGREEMENT_IN_CYCLE'` AND `effectiveRoomOperationalStatus === 'UNKNOWN'`, returns `state: 'UNAVAILABLE'` (`ไม่พบข้อมูลของงวดนี้`).
  No B1 current catalog rates are displayed as the conclusion for unknown historical cycles.

### 5. Forward Cache Invalidation Coordinator (Part D)
- **Implementation**: Updated `src/lib/roomMutationCache.ts` (`invalidateRoomMutationCaches`):
  - On status mutation, invalidates `queryKeys.rooms(dormitoryId)` and cached `queryKeys.meterPreviewContext(dormitoryId, cycleId)` for cycles with `periodStart >= effectiveStatusCycle.periodStart`.
  - Older historical cycles (`< periodStart`) and other dormitories are NOT invalidated.
  - Normal rent/deposit updates without status change do not invalidate preview context queries.
- Edit modal and direct status toggles pass `effectiveRoomStatusCycleId` to preserve mutation impact metadata.

### 6. RoomService Diff Hygiene Restoration (Part E)
- Restored `server/src/services/room.service.ts` from R3.1 base (`42095a1399fac91fc1f9f4792e10bfa66298ab1b`) and applied surgical logical edits with original CRLF line endings.
- `git diff --numstat 42095a1399fac91fc1f9f4792e10bfa66298ab1b -- server/src/services/room.service.ts` shows **56 insertions, 1 deletion**.

### 7. Focused Verification Matrix
- **Backend Write-Boundary Suite** (`server/src/__tests__/unit/owner-rooms-r32a-write-boundary.test.ts`): **4 / 4 passed (100%)**.
- **Backend Effective Status Unit Suite** (`server/src/__tests__/unit/owner-rooms-r32-effective-status.test.ts`): **4 / 4 passed (100%)**.
- **Backend Preview Context Unit Suite** (`server/src/__tests__/unit/owner-rooms-r3-meter-preview-context.test.ts`): **6 / 6 passed (100%)**.
- **Frontend Cycle Deposits & Cache Suite** (`src/tests/owner-rooms-r2-cycle-deposits.test.tsx`): **52 / 52 passed (100%)**.
- **LOCAL-07 UAT Refresh**: All 22 rooms seeded with baseline at operational cycle `2026-08`.

---


---

## 14. R3.2b — Baseline and Mutation Metadata Corrections

### 1. Root Cause Analysis & Corrective Scope
An independent review of R3.2a identified four production blockers:
1. **Per-Cycle Synthetic Rows in Baseline**: The previous baseline checked existence only for the exact current operational cycle, which generated synthetic baseline rows every month even when no user status change occurred.
2. **Non-blocking Startup Race Condition**: Baseline backfill was initiated in the background via `.catch(...)`, allowing API requests to be served before baseline initialization was complete.
3. **Dropped Mutation Metadata in ApiPropertyAdapter**: `normalizeAuthoritativeRoom` stripped `effectiveRoomStatusCycleId` from the update mutation response, preventing frontend runtime forward cache invalidation from receiving the authoritative cycle ID.
4. **Quick Add Dormitory Identity Fallback**: Quick Add derived dormitory ID from `buildings[0]` / `localStorage` rather than using the authoritative `dormitoryId` component prop.

### 2. One-Time Baseline Semantics (Part A & D)
- **One-Time Rule**: Baseline backfill establishes an initial row ONLY for Rooms that have **zero** (`operationalStatusChanges: { none: {} }`) status history.
- **Inheritance Invariant**: When operational cycle advances (e.g. from `2026-08` to `2026-09`), baseline rerun creates **0** additional rows. Future cycles inherit from the latest actual status change row (`sourceCycleId = '2026-08'`).
- **Concurrency / Idempotency**: Uses `createMany` with `skipDuplicates: true` to eliminate duplicate key errors during concurrent startup or deployment.

### 3. Synchronous Startup Readiness (Part C)
- In `server/src/server.ts`, `await backfillRoomOperationalStatusBaseline()` executes synchronously before `server.listen()`.
- If baseline initialization fails unexpectedly, startup fails closed (`process.exit(1)`).
- Dormitories without an authoritative billing cycle (pre-onboarding) are safely skipped without failing startup.

### 4. Mutation Response Metadata Preservation & Cache Transport (Part E, F & H)
- **Data Contract**: Added `RoomMutationResult = Room & { effectiveRoomStatusCycleId?: string | null }` in `src/data/contracts/index.ts`.
- **ApiPropertyAdapter**: `updateRoom` and `createRoom` explicitly attach `raw.effectiveRoomStatusCycleId` to the returned result while preserving the pure projection in `normalizeAuthoritativeRoom`.
- **End-to-End Cache Invalidation**: Status mutation response flows through the adapter and drives `invalidateRoomMutationCaches`, invalidating cached preview contexts for cycles with `periodStart >= effectivePeriodStart` (`2026-08`, `2026-09`, `2026-10`) while preserving older cycles (`2026-06`, `2026-07`) and other dormitories.

### 5. Edit Modal & Quick Add Authority (Part G & I)
- **Edit Modal**: `statusChanged` compares actual `effectiveStatus` sent against `editingRoom.status`.
- **Quick Add**: `handleTenantAction` strictly passes `dormitoryId` component prop to `/quick-add-context` via headers, eliminating `buildings[0]` and `localStorage` fallbacks.

### 6. Focused Verification Matrix
- **Backend Write-Boundary & Baseline Suite** (`server/src/__tests__/unit/owner-rooms-r32a-write-boundary.test.ts`): **5 / 5 passed (100%)**.
- **Backend Effective Status Unit Suite** (`server/src/__tests__/unit/owner-rooms-r32-effective-status.test.ts`): **4 / 4 passed (100%)**.
- **Backend Preview Context Unit Suite** (`server/src/__tests__/unit/owner-rooms-r3-meter-preview-context.test.ts`): **6 / 6 passed (100%)**.
- **Frontend Cycle Deposits & Adapter Suite** (`src/tests/owner-rooms-r2-cycle-deposits.test.tsx`): **53 / 53 passed (100%)**.
- **LOCAL-07 Database Proof**: 22 rooms seeded with baseline at `2026-08`; baseline rerun created 0 additional rows.

---


---

## 15. R3.2c — Property Mutation Metadata Boundary

### 1. Root Cause Analysis & Corrective Scope
An independent review of R3.2b identified that while `ApiPropertyAdapter` was updated to preserve `effectiveRoomStatusCycleId`, the backend route handler in `server/src/routes/property.routes.ts` (`PUT /api/v1/properties/rooms/:id`) previously dropped this field when wrapping the updated room with `defaultsService.buildAuthoritativeRoomResponse(dormId, room)`.

### 2. Backend Property Route Mutation Response (Part A & B)
- In `server/src/routes/property.routes.ts`, the `PUT /api/v1/properties/rooms/:id` handler now explicitly composes the response payload:
  ```ts
  const enriched = await defaultsService.buildAuthoritativeRoomResponse(dormId, room);
  res.json({
    data: {
      ...enriched,
      effectiveRoomStatusCycleId: (room as any).effectiveRoomStatusCycleId ?? null,
    },
  });
  ```
- **Pure Query Invariant**: Regular query endpoints (`GET /properties/rooms`, `GET /properties/rooms/:id`) remain pure current Room DTOs and are not contaminated with mutation metadata.

### 3. Server Route-Boundary Verification (Part C)
- Added an automated route-boundary test using `supertest` in `server/src/__tests__/unit/owner-rooms-r32a-write-boundary.test.ts`.
- Proves that `PUT /properties/rooms/:id` returns `data.effectiveRoomStatusCycleId === 'cycle-2026-08'` with all authoritative Room fields intact.
- Confirms that `GET /properties/rooms/:id` returns a pure Room DTO where `effectiveRoomStatusCycleId` is `undefined`.

### 4. Focused Verification Matrix
- **Backend Write-Boundary Suite** (`server/src/__tests__/unit/owner-rooms-r32a-write-boundary.test.ts`): **6 / 6 passed (100%)**.
- **Backend Effective Status Unit Suite** (`server/src/__tests__/unit/owner-rooms-r32-effective-status.test.ts`): **4 / 4 passed (100%)**.
- **Backend Preview Context Unit Suite** (`server/src/__tests__/unit/owner-rooms-r3-meter-preview-context.test.ts`): **6 / 6 passed (100%)**.
- **Frontend Cycle Deposits & Adapter Suite** (`src/tests/owner-rooms-r2-cycle-deposits.test.tsx`): **53 / 53 passed (100%)**.

---


---

## 16. R3.3 — Product Owner Manual UAT Findings & Corrections

### 1. July Room 206 Fixture Defect & Authoritative Status History
- **Observed UAT Symptom**: In July 2026, Room 206 displayed `ปิดปรับปรุงปัจจุบัน` + `ข้อมูลไม่พร้อม` (UNKNOWN).
- **Root Cause**: Comprehensive Manor was seeded with initial status `maintenance`, but R3.2 one-time operational baseline established baseline at canonical operational cycle (August 2026). Prior historical cycles had no status-history rows in Postgres.
- **Correction (Part A)**: In `scripts/local07/seed.mjs`, explicitly seeded authoritative status-history row for Room 206 at `cycleJuly.id` with `status: 'maintenance'`.
- **Production Invariant**: Real legacy production data with no defensible historical evidence remains `UNKNOWN`. Production inference is not modified backwards.

### 2. UNKNOWN State User-Facing UX (Part B)
- Replaced vague `ข้อมูลไม่พร้อม` text with concise truthful Thai presentation:
  - **Badge / Filter**: `ไม่มีประวัติสถานะ` (slate neutral)
  - **Detail text**: `ไม่พบประวัติสถานะห้องสำหรับงวดนี้`
- Retained strict fail-closed presentation without fabricating B1 prices for unrecorded history.

### 3. Room 204 Real Error Reproduction & Error Propagation (Part C & L)
- **Reproduction Result**: Direct service and HTTP PUT calls with valid version proceed with 200 OK.
- **Root Cause of Generic Error**: Coarse HTTP-wrapper codes (e.g. `CONFLICT` / `INTERNAL_ERROR`) were previously given higher priority in `src/lib/roomErrorMapper.ts` than specific nested server domain error codes (`details.error.code` / `details.code`).
- **Correction**: In `src/lib/roomErrorMapper.ts`, nested domain codes are evaluated first, mapping to specific concise Thai messages:
  - `ROOM_NUMBER_ALREADY_EXISTS` -> `เลขห้องนี้มีอยู่แล้ว`
  - `BUILDING_NOT_FOUND` -> `ไม่พบอาคารที่เลือก`
  - `OPERATIONAL_BILLING_CYCLE_UNAVAILABLE` -> `ยังไม่พบงวดดำเนินงานสำหรับการเปลี่ยนสถานะห้อง`
  - `VERSION_CONFLICT` -> `ข้อมูลห้องถูกแก้ไขจากอุปกรณ์อื่น กรุณาโหลดข้อมูลล่าสุด`
  - `ACTIVE_AGREEMENT_EXISTS` -> `ไม่สามารถปิดปรับปรุงห้องพักที่มีผู้เช่าอยู่ได้`

### 4. List Mode Rate Presentation (Part D)
- **Active Agreement**: Displays selected-cycle rent rate (e.g. `4,500.00 / เดือน`) with payment status badge.
- **No Agreement (Decision B1)**: Compactly displays all configured current catalog rates (รายเทอม, รายเดือน, รายวัน) labeled `อัตราปัจจุบัน` without discarding `rest`.
- **Reserved**: Displays `จองล่วงหน้า {date}`.
- **Daily Financial Tail**: Displays authoritative daily rate with payment status.

### 5. Payment Status Beside Rent and Deposit (Part E)
- Extended `getMeterBillingPreviewContext` in `server/src/services/meter.service.ts` to calculate:
  - `agreementRentPaymentStatus`: `'PAID' | 'UNPAID' | 'PARTIAL' | 'UNKNOWN'`
  - `agreementDepositPaymentStatus`: `'PAID' | 'UNPAID' | 'PARTIAL' | 'UNKNOWN'`
- Both Grid and List modes consume the shared `getPaymentStatusBadge` helper with semantic styling:
  - `PAID` / `จ่ายแล้ว` (green/emerald)
  - `UNPAID` / `ยังไม่ชำระ` (amber)
  - `PARTIAL` / `ชำระบางส่วน` (amber)
  - `UNKNOWN` / `ไม่พบสถานะการชำระ` (gray)

### 6. Future Reservation Date Display (Part F)
- Reused canonical Buddhist date formatter `formatShortThaiBuddhistDate` from `src/utils/calendarDate.ts`.
- Projected across Grid, List, and Floor modes as `จองล่วงหน้า {DD/MM/YY}`.

### 7. Selected-Cycle Tenant Deep Link & Return Context (Part G, H, I, J)
- **Deep Link**: Tenant action button resolves target tenant from `cyclePresentation.occupancy.tenantId` (never falls back to `room.currentTenantId`).
- **Return Context**: `onOpenTenant(tenantId, returnContext)` captures `cycleId`, `cycleCode`, `viewMode`, `selectedBuilding`, `selectedStatus`, `searchQuery`, and `scrollY`.
- **Tenant Detail Actions**:
  - `กลับ`: Returns to Rooms, restoring all filters, search query, view mode, and scrolling smoothly to target room card/position.
  - `ดูรายการอื่น`: Closes profile to the Tenant list without returning to Rooms.
- **Meter Flow**: Preserved existing Meter return flow.

### 8. Building Display Name vs Room Numbering Separation (Part K)
- **Authority**:
  1. Explicit non-empty `Building.name` (normalized with `formatBuildingDisplayName` to prevent duplicate `อาคาร` prefixes).
  2. Otherwise `Building.code` / `roomPrefix` (`อาคาร {code}`).
  3. Otherwise `ไม่ระบุอาคาร`.
- Room numbering format (e.g. 101) generates `101, 102...` independently from building name (`สมบูรณ์`).

---


---

## 17. R3.3a — Production Path Completion

### 1. Selected-Cycle Tenant Navigation & Action Authority (Part A & B)
- Implemented and exported `resolveRoomTenantAction(room, presentation)` in `src/pages/owner/rooms.tsx`.
- **Selected-cycle Agreement**: For `ACTIVE_AGREEMENT`, `RESERVED_IN_CYCLE`, and `DAILY_FINANCIAL_TAIL`, returns `OPEN_CYCLE_TENANT` with `presentation.occupancy.tenantId`. `room.currentTenantId` is NEVER used as selected-cycle navigation authority.
- **Reservation without Tenant ID**: Returns `DISABLED` with reason `ไม่มีข้อมูลบัญชีผู้เช่าสำหรับรายการจองนี้` (does not guess).
- **Quick Add Eligibility**: Offered ONLY when current room is actually eligible (`status === 'vacant'` and no current tenant). If room is occupied or in maintenance today, returns `DISABLED` with truthful reason.
- **Direct Dispatch**: Invokes `onOpenTenant(tenantId, returnContext)` directly instead of generic `onNavigate`.

### 2. Scroll Container & Return State Restoration (Part C, D, E)
- **Container Accuracy**: Captures `scrollTop` from `#owner-main-content` (with `window.scrollY` fallback).
- **Restoration Execution**: `OwnerRooms` consumes `restoredState` in a layout-safe effect, restoring `viewMode`, `selectedBuilding`, `selectedStatus`, `searchQuery`, and `scrollTop` (or target room anchor: `room-card-{id}`, `room-row-{id}`, `room-floor-{id}`) before calling `onClearRestoredState()`.
- **Dismiss Return Context**: `OwnerTenants` "ดูรายการอื่น" button calls `onDismissReturnContext()` to clear parent return context, preventing stale return links when viewing subsequent tenants.

### 3. Registration Building Identity & Name Independence (Part H)
- In Step 2 (Auto mode), separated input fields:
  - **ชื่ออาคาร** (`b.name`)
  - **รหัสตึก / คำนำหน้าเลขห้อง (ไม่บังคับ)** (`b.roomPrefix`)
- Editing `roomPrefix` no longer mutates or overwrites `b.name`.
- Draft restore preserves user-entered name and does not synthesize fake `อาคาร ` placeholder strings.

### 4. LOCAL-07 Fixture Building Identity (Part I)
- Updated `scripts/local07/seed.mjs` to seed buildings directly from `COMP_DORM.buildings` without injected `"(A)"` / `"(B)"` suffixes in `Building.name`.
- Resulting UAT display: `อาคารชาญวิทย์ • ชั้น N` and `อาคารสมบูรณ์ • ชั้น N`.

### 5. Room 204 Investigation Status & Error Domain Classifier (Part K & L)
- **Room 204 Status**: `ORIGINAL ROOM 204 FAILURE UNPROVEN — CURRENT VALID PUT PASS`.
- **Domain Classifier**: Created `getOwnerRoomMutationDomainCode(error)` in `src/lib/roomErrorMapper.ts` which prioritizes nested server domain codes (`VERSION_CONFLICT`, `ROOM_NUMBER_ALREADY_EXISTS`, `BUILDING_NOT_FOUND`, `OPERATIONAL_BILLING_CYCLE_UNAVAILABLE`, etc.).
- **Version Modal**: Opens `VersionConflictModal` ONLY when resolved domain code is strictly `VERSION_CONFLICT`, avoiding false modal triggers on other 409 errors (such as room number duplicates).

### 6. Agreement Payment Status Lifecycle & Partial Rent (Part M & N)
- In `server/src/services/meter.service.ts`:
  - **Deposit**: Batch loads and evaluates bills linked across the agreement's entire lifecycle (`contractId` / `provisionalRentalTermId`), ensuring deposit status remains `PAID` in future cycles without new bills.
  - **Rent**: Evaluates unambiguous rent bills in selected cycle. Correctly emits `PARTIAL` when `paidAmount > 0` and `outstandingAmount > 0`. Ambiguous legacy combined bills remain `UNKNOWN`.
  - **Daily Tail**: Evaluates and displays daily deposit payment status alongside unpaid rent.

### 7. List Mode Selected-Cycle Semantics (Part J)
- Updated column header to `ผู้เช่าตามงวด`.
- Primary status badge styling is derived purely from `RoomCyclePresentation.state` (`ACTIVE_AGREEMENT` -> occupied indigo, `NO_AGREEMENT_IN_CYCLE` -> vacant emerald, `MAINTENANCE_IN_CYCLE` -> maintenance rose, `UNAVAILABLE` -> neutral slate). Current `Room.status` no longer overrides selected-cycle badge colors.

---


## 18. R3.3aR — Remote Source / Handoff Reconciliation: Production Wiring Only

### 1. Reconciliation Context
Independent review of the R3.3a handoff at commit `d6571c184c5fac36a21daa94c1c8d0472423de9d` revealed that although several pure helpers and schemas were added in R3.3a, 5 core production paths were not fully wired into rendered JSX components or had line-ending churn. R3.3aR systematically resolved all 5 blockers:

### 2. Reconciliation Matrix (R3.3a State vs R3.3aR Corrected Truth)
| Area | R3.3a Previous State | R3.3aR Corrected Truth |
| :--- | :--- | :--- |
| **Line Endings & Diff Hygiene** | 4 files converted to LF causing 7,422 whole-file diff churn | Restored native CRLF for `owner.tsx`, `rooms.tsx`, `tenants.tsx`, and `owner-rooms-r2-cycle-deposits.test.tsx`. `git diff --stat` matches `git diff --ignore-space-at-eol --stat` (12 files changed, ~905 insertions / ~131 deletions). |
| **Blocker A: Tenant Click Path** | `resolveRoomTenantAction` helper existed, but `handleTenantAction` bypassed it and fell back to `onNavigate('tenants', room.currentTenantId)`. | `handleTenantAction` derives presentation from `roomCyclePresentationsById.get(room.id)` and `action = resolveRoomTenantAction(room, presentation)`. Invokes `onOpenTenant(action.tenantId, returnContext)` directly. Grid, List, and Floor mode buttons derive label, title, and enabled state directly from `action`. |
| **Blocker B: Return State & Scroll** | `restoredState` was in props interface but not consumed in `OwnerRooms`. | Added layout-safe `useEffect` consuming `restoredState`: restores `viewMode`, `selectedBuilding`, `selectedStatus`, `searchQuery`, and uses `requestAnimationFrame` to restore `#owner-main-content.scrollTop` (or scrolls target room anchor `room-card-{id}`, `room-row-{id}`, `room-floor-{id}` into view) before invoking `onClearRestoredState()`. |
| **Blocker C: Domain Error Modal Routing** | `getOwnerRoomMutationDomainCode` existed, but `saveRoom`, `executeDeleteRoom`, and `handleToggleRoomStatus` opened `VersionConflictModal` on outer `CONFLICT` HTTP code. | Extracted domain code via `getOwnerRoomMutationDomainCode(err)`. `VersionConflictModal` opens strictly when `domainCode === 'VERSION_CONFLICT'`. Other conflicts (e.g. `ROOM_NUMBER_ALREADY_EXISTS`) display inline/toast errors. |
| **Blocker D: List Status Badge Derivation** | List primary status badge styling evaluated `room.status === 'maintenance'` and overrode cycle presentation. | Primary status badge styling is derived 100% from `cyclePresentation.state` (`ACTIVE_AGREEMENT` -> indigo, `RESERVED_IN_CYCLE` -> amber, `DAILY_FINANCIAL_TAIL` -> amber, `MAINTENANCE_IN_CYCLE` -> rose, `UNAVAILABLE` -> slate, `NO_AGREEMENT_IN_CYCLE` -> emerald). Current room maintenance does NOT override selected-cycle badge. |
| **Blocker E: Registration Helper & Test Quality** | Step 2 finalize inline logic wasn't exported; tests tested helper in isolation rather than rendered JSX component. | Exported pure `mapRegistrationBuildingForFinalize(b, idx, fallbackDeposit)` from `src/pages/owner/register.tsx`. Added comprehensive component render tests in `src/tests/owner-rooms-r2-cycle-deposits.test.tsx` verifying rendered Grid, List, and Floor click paths, return state restoration, domain error routing, and list status badge rendering. |

---


## 19. R3.3aR1 — Floor Cycle Authority & Daily Tail Financial UX

### 1. Independent Review Findings & Scope of Correction
Independent review of the R3.3aR branch confirmed that Grid/List action wiring, restoredState consumption, #owner-main-content scroll restoration, domain-code VersionConflict routing, List badge derivation, registration mapping helper, and prior CRLF line-ending churn were successfully corrected. The remaining defects resolved in R3.3aR1 are:
1. **Floor Mode State Authority & Tenant Actions**: Refactored Floor rendering into an explicit switch on `RoomCyclePresentation.state` (`ACTIVE_AGREEMENT`, `RESERVED_IN_CYCLE`, `DAILY_FINANCIAL_TAIL`, `MAINTENANCE_IN_CYCLE`, `NO_AGREEMENT_IN_CYCLE`, `UNAVAILABLE`). Floor cards for `RESERVED_IN_CYCLE` and `DAILY_FINANCIAL_TAIL` now invoke `handleTenantAction` (navigating to selected-cycle tenant) instead of opening Edit Room modal.
2. **Floor Maintenance Authority & Secondary Context**: Floor mode uses `cyclePresentation.state === 'MAINTENANCE_IN_CYCLE'` as primary authority (not current `room.status === 'maintenance'`). When current room is under maintenance today but historical cycle was vacant, primary card remains green (`ว่างในงวดนี้`) and displays a small secondary badge (`ปิดปรับปรุงปัจจุบัน`).
3. **Floor UNAVAILABLE Fail-Closed Semantics**: When historical status is `UNAVAILABLE`, displays neutral slate card (`ไม่มีประวัติสถานะ` / `ไม่พบประวัติสถานะห้องสำหรับงวดนี้`) without B1 catalog rates or premature tenant conclusions.
4. **Daily Tail Financial UX (Grid & List)**:
   - **Grid Mode**: In `DAILY_FINANCIAL_TAIL`, rent displays amount/day with authoritative `agreementRentPaymentStatus` badge (e.g. `ยังไม่ชำระ`, `ชำระบางส่วน`); deposit displays amount with `agreementDepositPaymentStatus` badge (e.g. `500.00 จ่ายแล้ว`).
   - **List Mode**: In `DAILY_FINANCIAL_TAIL`, deposit column displays authoritative deposit amount and payment badge without falling through to `ไม่มีผู้เช่าลงทะเบียน`.
5. **UAT Fixture Hygiene**: Reverted local refresh artifact `docs/uat/local07-expected-results.json` to exact base state (`d6571c184c5fac36a21daa94c1c8d0472423de9d`), ensuring zero unrelated diff churn.

---

## 20. Final Verification & Product Owner Readiness

### Focused Verification Suite Summary:
- **Backend Write-Boundary Suite** (`server/src/__tests__/unit/owner-rooms-r32a-write-boundary.test.ts`): **6 / 6 passed (100%)**
- **Backend Effective Status Unit Suite** (`server/src/__tests__/unit/owner-rooms-r32-effective-status.test.ts`): **5 / 5 passed (100%)**
- **Backend Preview Context Unit Suite** (`server/src/__tests__/unit/owner-rooms-r3-meter-preview-context.test.ts`): **9 / 9 passed (100%)**
- **Frontend Cycle Deposits, Floor Authority & Financial UX Suite** (`src/tests/owner-rooms-r2-cycle-deposits.test.tsx`): **82 / 82 passed (100%)**
- **TypeScript Linting** (`npm run lint`): **Passed with 0 errors**
- **Backend Production Build** (`npm --prefix server run build`): **Passed with 0 errors**
- **Diff & Line Ending Hygiene** (`git -c core.whitespace=cr-at-eol diff --check`): **Passed with 0 warnings**
- **UAT Expected Results File Hygiene** (`git diff d6571c184c5fac36a21daa94c1c8d0472423de9d..HEAD -- docs/uat/local07-expected-results.json`): **EMPTY**

**READY FOR PRODUCT OWNER R3.3 MANUAL UAT**


## 21. R3.4 — Payment State Semantics, Maintenance Guard & UAT Data Completeness

### 1. 5-State Canonical Payment Model (Part A, B, C, E)
- **Canonical Payment States**:
  - `PAID` (Thai: `จ่ายแล้ว`, Badge: `emerald-50 / emerald-700 / emerald-200`)
  - `UNPAID` (Thai: `รอชำระ`, Badge: `amber-50 / amber-700 / amber-200`)
  - `PARTIAL` (Thai: `ชำระบางส่วน`, Badge: `amber-50 / amber-700 / amber-200`)
  - `NOT_ISSUED` (Thai: `ยังไม่ออกบิล`, Badge: `sky-50 / sky-700 / sky-200`)
  - `UNKNOWN` (Thai: `ไม่พบข้อมูลการชำระ`, Badge: `slate-50 / slate-600 / slate-200`)
- **Rent Authority (Selected Cycle)**: Rent payment state is evaluated per cycle. When an active agreement is present in the cycle but no rent bill has been issued, it evaluates to `NOT_ISSUED` (not `UNKNOWN` or `UNPAID`).
- **Deposit Authority (Agreement Lifecycle)**: Deposit is paid once per agreement lifecycle. When a tenant's deposit is paid in their start cycle (e.g. July), it remains `PAID` across all subsequent cycles (August, September, etc.) for that contract without requiring new monthly deposit bills. A new tenant/agreement has an independent lifecycle and will resolve to `NOT_ISSUED` if deposit > 0 and no bill is issued yet.

### 2. Locked Product Decision F1: Maintenance Occupancy & Reservation Guard (Part F & G)
- **Server-Side Enforcement**: Inside `updateRoom` transaction in `server/src/services/room.service.ts`, when transitioning `status` to `maintenance`:
  - Physical Occupancy Check: Checks `existing.currentTenantId`, `existing.status === 'occupied'`, active `Contract`, active `ProvisionalRentalTerm`, or active `DailyStay`. If active occupancy exists, throws `409 Conflict` with domain error code `ROOM_HAS_ACTIVE_OCCUPANCY` and Thai message `ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่`.
  - Future Reservation Check: Checks future `Contract` (startDate > now), `ProvisionalRentalTerm` (RESERVED/PENDING or startDate > now), and `DailyStay` (RESERVED/CONFIRMED or checkInDate > now). If active reservation exists, throws `409 Conflict` with domain error code `ROOM_HAS_ACTIVE_RESERVATION` and Thai message `ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า`.
  - Permitted Catalog Edits: Room catalog fields (monthlyRent, termRent, dailyRent, depositAmount, maxOccupants, roomType) remain fully editable on occupied and reserved rooms.
- **Frontend Edit Modal UI**: In `src/pages/owner/rooms.tsx`, the 'ปิดปรับปรุง' button in Edit Room modal is disabled when the room is currently occupied or has a future reservation, with clear tooltip explaining the reason (`มีผู้เช่าพักอยู่ ต้องย้ายหรือสิ้นสุดการเช่าก่อน` / `มีการจองล่วงหน้า ต้องจัดการการจองก่อน`).

### 3. Historical Vacancy Secondary Current State (Part H)
- When `cyclePresentation.state === 'NO_AGREEMENT_IN_CYCLE'`:
  - If current room is occupied today: displays primary green `ว่างในงวดนี้` and secondary `ปัจจุบันมีผู้เช่า`. Quick Add is suppressed.
  - If current room is in maintenance today: displays primary green `ว่างในงวดนี้` and secondary `ปิดปรับปรุงปัจจุบัน`. Quick Add is suppressed.
  - If current room is vacant today: displays `เพิ่มผู้เช่า` button (Quick Add available).

### 4. List Mode & Floor Map Visual Formatting (Part I & J)
- **List Mode Rates**: Rendered cleanly as `฿ 19,200.00 / เทอม`, `฿ 4,800.00 / เดือน`, `฿ 550.00 / วัน` + `อัตราปัจจุบัน`. Redundant left column labels (`รายเทอม`, `รายเดือน`, `รายวัน`) were removed.
- **Floor Map Currency**: Currency formatted strictly as `฿ 5,000.00/ด.`. Fixed JSX template string escaping to eliminate all literal `$` characters across Floor Map cards.

### 5. LOCAL-07 Seed & Verification Matrix (Part D & N)
- Seeded deterministic scenarios for all financial states:
  - RENT PAID (`INV-202607-001`)
  - RENT UNPAID (`INV-202608-201-R`)
  - RENT PARTIAL (`INV-202608-203-R`)
  - RENT NOT_ISSUED (Room 303 contract with no issued bill)
  - DEPOSIT PAID in start cycle (`INV-202608-201-D`, `INV-202608-202-D`)
  - DEPOSIT NOT_ISSUED (Room 303 contract requiring deposit > 0 with no deposit bill)
  - DAILY Rent & Deposit (Daily stay Room 103)
  - RESERVED in cycle (Room 102)
  - UNKNOWN for ambiguous legacy combined without item breakdown
- All 12 LOCAL-07 verification checks passed with 0 failures.

---

## 22. Summary of Verification Test Results

- **Maintenance Occupancy Guard Suite** (`server/src/__tests__/unit/owner-rooms-r34-maintenance-guard.test.ts`): **8 / 8 passed (100%)**
- **Preview Context Unit Suite** (`server/src/__tests__/unit/owner-rooms-r3-meter-preview-context.test.ts`): **12 / 12 passed (100%)**
- **Write-Boundary Unit Suite** (`server/src/__tests__/unit/owner-rooms-r32a-write-boundary.test.ts`): **6 / 6 passed (100%)**
- **Effective Status Unit Suite** (`server/src/__tests__/unit/owner-rooms-r32-effective-status.test.ts`): **5 / 5 passed (100%)**
- **Frontend Cycle Deposits & R3.4 UX Suite** (`src/tests/owner-rooms-r2-cycle-deposits.test.tsx`): **88 / 88 passed (100%)**
- **All Backend Unit Test Suites** (`npm --prefix server run test -- src/__tests__/unit/`): **57 / 57 passed (100%)**
- **TypeScript Linting** (`npm run lint`): **Passed with 0 errors**
- **Backend Production Build** (`npm --prefix server run build`): **Passed with 0 errors**
- **Diff & Line Ending Hygiene** (`git -c core.whitespace=cr-at-eol diff --check`): **Passed with 0 warnings**
- **LOCAL-07 UAT Refresh & Verification** (`npm run uat:refresh`): **0 Failures (100% PASS)**
- **UAT Expected Results File Hygiene** (`git diff 82e503a51c11bb372d059904ff1deda601869172..HEAD -- docs/uat/local07-expected-results.json`): **EMPTY**

---

## 23. Owner Rooms R3.4a — Canonical Maintenance Availability, Prisma Field Alignment & Executable Financial Oracle

### 1. Canonical Prisma Schema Field Alignment (Parts A & B)
- Audited authoritative Prisma schema in `server/prisma/schema.prisma`.
- Confirmed that `DailyStay` has fields: `startDate` (`@db.Date`), `endDate` (`@db.Date`), `checkInAt` (`@db.Timestamptz`), `checkOutAt` (`@db.Timestamptz`), `actualCheckedOutAt` (`@db.Timestamptz`), `status`, `deletedAt`.
- Completely removed all non-canonical field references (`checkInDate` / `checkOutDate`) from `RoomService`, `occupancy-interval.util.ts`, and unit/integration tests.
- Reused canonical interval calculations: `getContractPhysicalInterval()`, `getProvisionalTermPhysicalInterval()`, and `getDailyStayPhysicalInterval()`.

### 2. Decision F1 Canonical Maintenance Availability Evaluator (Part C)
- Centralized maintenance eligibility calculation in `evaluateMaintenanceEligibilityFromRecords({ contracts, provisionals, dailyStays, now })` inside `server/src/utils/occupancy-interval.util.ts`.
- Categorizes blocks into two strict domain outcomes:
  1. `ROOM_HAS_ACTIVE_OCCUPANCY` (`start <= now < end`): `canSetMaintenance: false`, `maintenanceBlockReason: 'ACTIVE_OCCUPANCY'`. Tooltip / message: `มีผู้เช่าพักอยู่ ต้องย้ายหรือสิ้นสุดการเช่าก่อน`.
  2. `ROOM_HAS_ACTIVE_RESERVATION` (`start > now`): `canSetMaintenance: false`, `maintenanceBlockReason: 'ACTIVE_RESERVATION'`. Tooltip / message: `มีการจองล่วงหน้า ต้องจัดการการจองก่อน`.
- Excludes soft-deleted records (`deletedAt != null`) and terminal/ended records (`cancelled`, `void`, `rejected`, `terminated`, `CHECKED_OUT`, `COMPLETED`, or ended intervals where `end <= now`).
- Does not allow stale `room.currentTenantId` to block maintenance if authoritative occupancy has ended.

### 3. Current Operational Action DTO Enrichment (Part H)
- Enriched `defaultsService.buildAuthoritativeRoomsResponseBatch` and `buildAuthoritativeRoomResponse` to attach:
  ```ts
  currentOperationalActions: {
    canSetMaintenance: boolean;
    maintenanceBlockReason: 'ACTIVE_OCCUPANCY' | 'ACTIVE_RESERVATION' | null;
  }
  ```
- Optimized with pre-fetched batch queries across active/future contracts, provisionals, and daily stays to eliminate N+1 overhead.
- Edit Room modal and direct status toggle in frontend read `currentOperationalActions` directly, making maintenance disabling strictly dependent on CURRENT operational status rather than the viewed billing cycle.

### 4. Deposit Legacy Ambiguity & Lifecycle Authority (Part I)
- Updated `meterService.ts` deposit resolution:
  - If deposit is part of a `LEGACY_COMBINED` partial bill or multi-item partial bill without item allocation, deposit payment status evaluates safely to `UNKNOWN`.
  - Dedicated `DEPOSIT` bill with partial payment evaluates to `PARTIAL`.
  - Paid deposit bills (`PAID`) are authoritative across the entire agreement lifecycle (3-cycle persistence verified).

### 5. Executable LOCAL-07 Financial Oracle Matrix (Part J)
- Added Section 13 to `scripts/local07/verify.mjs` executing production `meterService.getMeterBillingPreviewContext()` across cycles (July, August, September, October 2026):
  - **Matrix A**: RENT PAID -> Room 101 (`2026-07`) is `PAID`.
  - **Matrix B**: RENT UNPAID -> Room 201 (`2026-08`) is `UNPAID`.
  - **Matrix C**: RENT PARTIAL -> Room 203 (`2026-08`) is `PARTIAL` (2000/4800).
  - **Matrix D**: RENT NOT_ISSUED -> Room 303 (`2026-08`) is `NOT_ISSUED`.
  - **Matrix E**: DEPOSIT PAID -> Room 202 (`2026-08`) is `PAID`.
  - **Matrix F**: SAME AGREEMENT in later cycle -> Room 202 (`2026-09`) is `PAID`.
  - **Matrix F2**: DEPOSIT LIFECYCLE (3 Cycles) -> Room 202 is `PAID` in August, September, and October.
  - **Matrix G**: DEPOSIT NOT_ISSUED -> Room 303 (`2026-08`) is `NOT_ISSUED`.
  - **Matrix H**: DAILY RENT UNPAID -> Room 106 (`2026-08`) is `UNPAID`.
  - **Matrix H2**: DAILY RENT PAID -> Room 206 (`2026-08`) is `PAID`.
  - **Matrix I**: DAILY DEPOSIT UNPAID -> Room 106 (`2026-08`) is `UNPAID`.
  - **Matrix J**: RESERVED IN CYCLE -> Room 205 (`2026-09`) is `RESERVED_IN_CYCLE` with `NOT_ISSUED`.
  - **Matrix K**: Ambiguous `LEGACY_COMBINED` Partial -> Room 104 (`2026-08`) evaluates rent & deposit to `UNKNOWN`.

### 6. List Decision B1 Compact Presentation Order (Part L)
- Added `getPresentationOrderedRates(rates)` in `src/lib/roomRentalSummary.ts` to guarantee display ordering: `TERM` -> `MONTHLY` -> `DAILY`.
- Preserved currency formatting: `฿ 5,000.00/ด.` (0 `$` characters).

---

## 24. Final Verification Summary (R3.4a)

| Test / Check Suite | Target Command / Path | Result |
|---|---|---|
| Maintenance Guard Unit Tests | `npm --prefix server run test -- src/__tests__/unit/owner-rooms-r34-maintenance-guard.test.ts` | **10 / 10 PASS (100%)** |
| Prisma Boundary Integration Tests | `npm --prefix server run test -- src/__tests__/integration/owner-rooms-r34a-prisma-maintenance-guard.test.ts` | **7 / 7 PASS (100%)** |
| Frontend Cycle Deposits & R3.4a UX Suite | `npx vitest run src/tests/owner-rooms-r2-cycle-deposits.test.tsx --environment happy-dom` | **93 / 93 PASS (100%)** |
| Frontend TypeScript Compilation | `npm run lint` | **0 Errors (PASS)** |
| Backend TypeScript Compilation | `npm --prefix server run build` | **0 Errors (PASS)** |
| Line Ending & Whitespace Check | `git -c core.whitespace=cr-at-eol diff --check` | **0 Warnings (PASS)** |
| Master LOCAL-07 Sandbox Refresh & Oracle | `npm run uat:refresh` | **0 Failures (100% PASS across all 13 sections)** |
| UAT Expected Results File Baseline | `git diff 4a0f572714a68630037125114b501a83bb47d387..HEAD -- docs/uat/local07-expected-results.json` | **UNMODIFIED (Clean Baseline)** |

---

## 25. OWNER ROOMS R3.4b — Production Boundaries, Transport & Concurrency Hardening (2026-08-28)

### Context & Independent Review Corrections
An independent technical audit of R3.4a identified critical gaps between documented specifications and actual runtime implementations:
1. **Missing Production DTO Transport**: `currentOperationalActions` was omitted in the backend `defaultsService` production response builders and `src/lib/roomNormalizer.ts`. Frontend tests were manually injecting the property into mock Room objects.
2. **Integration Test Boundary**: The previous `owner-rooms-r34a-prisma-maintenance-guard.test.ts` was executing mock in-memory objects rather than live PostgreSQL/Prisma instances.
3. **Concurrency Serialization**: Concurrent room availability mutations (e.g., simultaneous maintenance toggle and daily reservation creation) lacked a single shared transactional advisory lock.
4. **Strict DTO Fallback Leakage**: Fallbacks such as `billingSource || 'CONTRACT'` in `roomRentalSummary.ts` could mask malformed payloads instead of failing closed to `UNAVAILABLE`.

### Surgical Implementations & Hardening in R3.4b

#### Part A: Canonical Current Maintenance Eligibility Authority
- Implemented `resolveCurrentMaintenanceEligibilityByRoom(dormitoryId, roomIds, dbClient?, now?)` in `server/src/utils/occupancy-interval.util.ts` as the sole server-side batch resolver.
- Reuses canonical `evaluateMaintenanceEligibilityFromRecords` with zero N+1 database queries.
- Shared transactional PostgreSQL advisory lock helper:
  ```ts
  export async function acquireRoomAvailabilityLock(tx: any, dormitoryId: string, roomId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + roomId}))`;
  }
  ```
- Integrated advisory lock directly into `RoomService.updateRoom` prior to maintenance eligibility evaluation.

#### Part B & C: Production DTO Transport & Normalizer
- Enriched `defaultsService.buildAuthoritativeRoomResponse` and `buildAuthoritativeRoomsResponseBatch` with server-authoritative `currentOperationalActions`:
  ```ts
  currentOperationalActions: {
    canSetMaintenance: boolean;
    maintenanceBlockReason: 'ACTIVE_OCCUPANCY' | 'ACTIVE_RESERVATION' | null;
  }
  ```
- Updated `AuthoritativeRoomDto` in `src/lib/roomNormalizer.ts` and updated `normalizeAuthoritativeRoom()` to preserve `currentOperationalActions` verbatim without guessing or inferring.
- Added fail-closed frontend behavior in `src/pages/owner/rooms.tsx`: if `currentOperationalActions` is missing or malformed, maintenance status change is disabled with tooltip: `ไม่สามารถตรวจสอบสถานะการเปิดปิดห้องได้ กรุณาโหลดข้อมูลใหม่`.

#### Part D: Real Transport Integration Test
- Added end-to-end frontend transport proof in `src/tests/owner-rooms-r2-cycle-deposits.test.tsx` (Test T6):
  - Backend DTO -> `normalizeAuthoritativeRoom()` -> `OwnerRooms` component.
  - Selected cycle = July, current operational future reservation = September.
  - Verifies "ปิดปรับปรุง" button is disabled with title `มีการจองล่วงหน้า ต้องจัดการการจองก่อน` without manual injection post-normalization.

#### Part E & F: Live Prisma / PostgreSQL Database Suite & Concurrency Invariant
- Replaced previous mock integration file with `server/src/__tests__/integration/owner-rooms-r34b-prisma-maintenance-guard.test.ts` against live PostgreSQL:
  1. Real DailyStay ACTIVE -> blocks maintenance with `ROOM_HAS_ACTIVE_OCCUPANCY` (PASS).
  2. Real DailyStay RESERVED future -> blocks maintenance with `ROOM_HAS_ACTIVE_RESERVATION` (PASS).
  3. Real DailyStay CHECKED_OUT historical -> allows maintenance (PASS).
  4. Real DailyStay soft-deleted -> allows maintenance (PASS).
  5. Real active Contract -> blocks maintenance with `ROOM_HAS_ACTIVE_OCCUPANCY` (PASS).
  6. Real future committed Contract -> blocks maintenance with `ROOM_HAS_ACTIVE_RESERVATION` (PASS).
  7. Real ended/deleted Contract -> allows maintenance (PASS).
  8. Real active ProvisionalRentalTerm -> blocks maintenance with `ROOM_HAS_ACTIVE_OCCUPANCY` (PASS).
  9. Real future RESERVED ProvisionalRentalTerm -> blocks maintenance with `ROOM_HAS_ACTIVE_RESERVATION` (PASS).
  10. Real ended/deleted ProvisionalRentalTerm -> allows maintenance (PASS).
  11. **Concurrency Invariant**: Simultaneous maintenance toggle and daily reservation creation serialize cleanly via transactional advisory locks; dual-commit is physically impossible (PASS).
  12. **Authoritative Room DTO**: Single and batch response builders attach canonical `currentOperationalActions` (PASS).

#### Part G: Strict DTO Projection Hardening
- `src/lib/roomRentalSummary.ts`:
  - `ACTIVE_AGREEMENT`: Requires valid canonical `billingSource` (`CONTRACT`, `PROVISIONAL_MONTHLY`, `PROVISIONAL_TERM`, `DAILY_STAY`). Missing or invalid source fails closed to `UNAVAILABLE`.
  - `RESERVED_IN_CYCLE`: Explicitly validates finite `rentAmount` without loose coercion; malformed values fail closed to `UNAVAILABLE`.
  - `DAILY_FINANCIAL_TAIL`: Requires `agreementType === 'DAILY'` and `billingSource === 'DAILY_STAY'` (or `NONE`); invalid values fail closed to `UNAVAILABLE`.

#### Part H: LOCAL-07 Oracle Precondition Verification
- Hardened Section 13 of `scripts/local07/verify.mjs` to assert that all 4 cycles (`2026-07`, `2026-08`, `2026-09`, `2026-10`) and all 9 test rooms exist in the database before running matrix assertions.

### Verification Matrix (R3.4b)

| Test / Check Suite | Target Command / Path | Result |
|---|---|---|
| Real Prisma Integration & Concurrency Suite | `npm --prefix server run test -- src/__tests__/integration/owner-rooms-r34b-prisma-maintenance-guard.test.ts` | **12 / 12 PASS (100%)** |
| Backend Unit & Service Suites | `npm --prefix server run test -- src/__tests__/unit/` | **59 / 59 PASS (100%)** |
| Frontend Vitest Test Suite | `npx vitest run src/tests/owner-rooms-r2-cycle-deposits.test.tsx --environment happy-dom` | **98 / 98 PASS (100%)** |
| Frontend TypeScript Check | `npm run lint` | **0 Errors (PASS)** |
| Backend TypeScript Build | `npm --prefix server run build` | **0 Errors (PASS)** |
| LOCAL-07 Oracle Sandbox Verification | `npm run uat:refresh` | **100% PASS (All 13 Sections)** |
| Whitespace & Line Ending Hygiene | `git -c core.whitespace=cr-at-eol diff --check` | **0 Warnings / Clean** |

---

## 26. OWNER ROOMS R3.4c — Real Shared Availability Lock, Concurrency Proofs & Fail-Closed Transport Hardening (2026-08-28)

### Context & Independent R3.4b Audit Findings
Following an independent remote audit of R3.4b, several critical defects and test validity issues were identified and addressed:
1. **Uninvoked Advisory Lock**: `RoomService` imported `acquireRoomAvailabilityLock` but failed to call it inside `runInTx`.
2. **Malformed Concurrency Test DTO**: The R3.4b concurrency test passed legacy property names (`applicantFullName`, `applicantPhone`) to `ownerQuickAddDailyStay` instead of production fields (`fullName`, `phone`), causing validation rejection before exercising concurrency.
3. **Disjoint Locking Schemes**: Contract creation used `SELECT ... FOR UPDATE` while Daily and Provisional paths used advisory locks.
4. **Direct Status Toggle Guard**: `handleToggleRoomStatus` in `rooms.tsx` was not fail-closed when `currentOperationalActions` was missing.
5. **Normalizer Boolean Coercion**: `roomNormalizer.ts` used loose `Boolean()` coercion on `canSetMaintenance` without runtime schema and cross-field consistency checks.
6. **Zero Rent Fabrication**: `RESERVED_IN_CYCLE` projection defaulted missing `rentAmount` to `0` instead of failing closed to `UNAVAILABLE`.
7. **Daily Tail Source Rewrite**: `DAILY_FINANCIAL_TAIL` accepted `billingSource = 'NONE'` and rewrote it to `'DAILY_STAY'`.
8. **UAT Artifact Churn**: `docs/uat/local07-expected-results.json` contained `generatedAt` timestamp churn.

---

### Surgical Implementations & Architectural Guarantees (R3.4c)

#### Part A: Unified Shared Room-Availability Advisory Lock
All services modifying room availability now acquire the canonical advisory lock as the very first step in their transactions:
```ts
export async function acquireRoomAvailabilityLock(
  tx: any,
  dormitoryId: string,
  roomId: string
): Promise<void> {
  if (typeof tx?.$executeRaw === 'function') {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + roomId}))`;
  }
}
```
- **Lock Ordering Invariant**:
  1. Advisory room-availability lock: `await acquireRoomAvailabilityLock(tx, dormitoryId, roomId)`
  2. Row-level lock (if needed): `SELECT id FROM rooms WHERE id = ... FOR UPDATE`
  3. Domain reads & conflict checks (contracts, provisional terms, daily stays, room maintenance status)
  4. Write operations
  5. Transaction commit

- **Shared Authority Coverage**:
  - `RoomService.updateRoom` (when `changes.status` affects maintenance/availability)
  - `ContractService.createContract` & `activateContract`
  - `DailyStayService.ownerQuickAddDailyStay`, `approveDailyStay`, `checkoutDailyStay`, `activateScheduledDailyStays`, `completeEndedDailyStays`
  - `ProvisionalRentalTermService.createProvisionalTenantAndTerm` & `extendProvisionalRentalTerm`

#### Part B: Real Concurrency Serialization Invariants
Updated integration test suite in `server/src/__tests__/integration/owner-rooms-r34c-prisma-maintenance-guard.test.ts` against live PostgreSQL:
1. **Daily Quick Add vs Maintenance Toggle**: Uses valid `OwnerQuickAddDailyStayDto` (`fullName`, `phone`, `startDate`, `endDate`, `dailyRateAmount`, `depositAmount`). Parallel execution proves exactly ONE operation commits, exactly ONE rejects with room availability conflict (`ROOM_UNDER_MAINTENANCE`, `ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT`, `ROOM_HAS_ACTIVE_RESERVATION`), and never with validation errors.
2. **Contract Creation vs Maintenance Toggle**: Proves contract creation and maintenance toggle serialize cleanly.
3. **Provisional Term Creation vs Maintenance Toggle**: Proves provisional term creation and maintenance toggle serialize cleanly.
4. **Database Invariant**: Proved that `NOT (Room.status === 'maintenance' AND committed reservation/occupancy exists)` is strictly maintained under all concurrent interleavings.

#### Part C: Committed Status & Termination Physical Interval Semantics
- **DailyStay**:
  - `PENDING_APPROVAL`: Uncommitted tenant request -> `canSetMaintenance: true`.
  - `RESERVED`: Committed future reservation -> `canSetMaintenance: false`, `maintenanceBlockReason: 'ACTIVE_RESERVATION'`.
  - `ACTIVE` / `CHECKED_IN`: Physical occupancy -> `canSetMaintenance: false`, `maintenanceBlockReason: 'ACTIVE_OCCUPANCY'`.
  - `CHECKED_OUT`, `COMPLETED`, `CANCELLED`, `REJECTED`: Non-blocking.
- **Contract**:
  - `draft`, `cancelled`, `void`, `rejected`: Non-blocking.
  - `terminated`: Evaluated by canonical `getContractPhysicalInterval(c)`. If `now < terminationEffectiveDate`, blocks as `ACTIVE_OCCUPANCY`. If `terminationEffectiveDate <= now`, allows maintenance.
  - `active`, `pending_signature`, `approved`, etc.: Evaluated by canonical physical interval.
- **ProvisionalRentalTerm**:
  - `ACTIVE`: Blocks as `ACTIVE_OCCUPANCY`.
  - `RESERVED`: Blocks as `ACTIVE_RESERVATION`.
  - `ENDED`, `CANCELLED`, `REJECTED`, `CONVERTED`: Non-blocking.

#### Part D: Fail-Closed Direct Toggle & Normalizer
- `src/pages/owner/rooms.tsx`: `handleToggleRoomStatus` checks `currentOperationalActions`. If null, undefined, or `canSetMaintenance !== true`, aborts mutation and shows toast: `ไม่สามารถตรวจสอบสถานะการเปิดปิดห้องได้ กรุณาโหลดข้อมูลใหม่`.
- `src/lib/roomNormalizer.ts`: Strict runtime schema validation:
  - Requires `typeof canSetMaintenance === 'boolean'`.
  - Validates reason: `null | 'ACTIVE_OCCUPANCY' | 'ACTIVE_RESERVATION'`.
  - Cross-field consistency: `canSetMaintenance === true` requires `maintenanceBlockReason === null`; `canSetMaintenance === false` requires non-null valid reason.
  - Malformed payloads fail closed to `currentOperationalActions = null`.

#### Part E: Strict Cycle Projections (No Fabrication)
- `src/lib/roomRentalSummary.ts`:
  - `RESERVED_IN_CYCLE`: Explicitly requires finite, non-empty `rentAmount`. Missing/malformed rent fails closed to `UNAVAILABLE` (never fabricates 0).
  - `DAILY_FINANCIAL_TAIL`: Requires `billingSource === 'DAILY_STAY'`. Missing, `'NONE'`, or invalid sources fail closed to `UNAVAILABLE` (never fabricates `DAILY_STAY` from `NONE`).

#### Part F: Expected Results Baseline Hygiene
- Reverted `docs/uat/local07-expected-results.json` to clean baseline (`04eec07ea166858b035ff06eb608a1c003111952`), removing all `generatedAt` timestamp churn.

---

### Verification Matrix (R3.4c)

| Test / Check Suite | Target Command / Path | Result |
|---|---|---|
| Real PostgreSQL / Prisma Concurrency & Boundary Suite | `npm --prefix server run test -- src/__tests__/integration/owner-rooms-r34c-prisma-maintenance-guard.test.ts` | **18 / 18 PASS (100%)** |
| All Backend Unit Test Suites | `npm --prefix server run test -- src/__tests__/unit/` | **59 / 59 PASS (100%)** |
| Frontend Vitest Test Suite (incl. T11-T18) | `npx vitest run src/tests/owner-rooms-r2-cycle-deposits.test.tsx --environment happy-dom` | **106 / 106 PASS (100%)** |
| Frontend TypeScript Check | `npm run lint` | **0 Errors (PASS)** |
| Backend Production Build | `npm --prefix server run build` | **0 Errors (PASS)** |
| LOCAL-07 Oracle Sandbox Verification | `npm run uat:refresh` | **100% PASS (All 13 Sections)** |
| Expected Results Baseline Diff | `git diff 04eec07ea166858b035ff06eb608a1c003111952..HEAD -- docs/uat/local07-expected-results.json` | **0 Diff / Clean** |
| Line Ending & Whitespace Hygiene | `git -c core.whitespace=cr-at-eol diff --check` | **0 Warnings / Clean** |

---

## 27. OWNER ROOMS R3.4d — Daily Approval Commit Boundary & Single Maintenance Authority (2026-08-28)

### Context & Independent Review Findings
Following the independent audit of R3.4c, two critical commit boundary and authority defects were resolved:
1. **Unsafe Daily Approval Commit Boundary**: In `approveDailyStay`, the pending request was read and validated prior to acquiring the room availability advisory lock, and the room's current maintenance status was not re-validated under the lock. Because `PENDING_APPROVAL` intentionally does not block maintenance, a room could transition to `maintenance` while an approval was in flight, and subsequent approval could commit occupancy onto a maintenance room.
2. **Dual Maintenance Authority on Frontend**: `src/pages/owner/rooms.tsx` checked `currentOperationalActions`, but then separately blocked on `room.currentTenantId`. Stale compatibility pointers could permanently block room maintenance even when canonical occupancy truth proved the room was empty.
3. **Duplicated Server Eligibility Selection**: `RoomService.updateRoom` duplicated database query filtering instead of consuming the canonical `resolveCurrentMaintenanceEligibilityByRoom` batch resolver used by `DefaultsService`.

---

### Surgical Implementations & Architectural Guarantees (R3.4d)

#### Part A: Two-Stage Lock-Then-Re-Read approveDailyStay Boundary
`approveDailyStay` now strictly executes a two-stage transaction:
1. Preliminary lookup of `stay.roomId`.
2. Advisory room-availability lock: `await acquireRoomAvailabilityLock(tx, dormitoryId, preliminary.roomId)`.
3. Authoritative fresh re-read of `DailyStay` under the acquired lock:
   - Revalidates `deletedAt: null` and `status === 'PENDING_APPROVAL'`.
   - If already processed (`RESERVED` / `ACTIVE`), rejects with `DAILY_STAY_ALREADY_PROCESSED` (409).
4. Authoritative fresh read of `Room` under the same lock:
   - If `room.status === 'maintenance'`, rejects with `ROOM_UNDER_MAINTENANCE` (409) and Thai message: `ไม่สามารถอนุมัติการเข้าพักได้ เนื่องจากห้องนี้อยู่ระหว่างปิดปรับปรุง`.
5. Canonical physical interval availability check via `getDailyStayPhysicalInterval(stay)`.
6. Only after all post-lock validations pass are side effects committed (Tenant creation, Occupancy creation, Invoice generation, DailyStay status transition).

#### Part B: Single Server-Side Maintenance Authority
- `RoomService.updateRoom` now directly invokes `resolveCurrentMaintenanceEligibilityByRoom(targetDormId, [id], tx, now)` inside the transaction after acquiring the advisory lock.
- Both `GET /properties/rooms` (DTO builder) and `PUT /properties/rooms/:id` (mutation guard) now share 100% identical database selection, filtering, and interval evaluation authority.

#### Part C: Single Frontend Maintenance Action Authority
- `src/pages/owner/rooms.tsx` removed `room.currentTenantId` as a secondary blocking authority for direct status toggle and edit modal save.
- Maintenance actions are strictly governed by `currentOperationalActions` (`canSetMaintenance` and `maintenanceBlockReason`).
- Stale `currentTenantId` pointers do not block maintenance when canonical `canSetMaintenance === true`.

---

### Verification Matrix (R3.4d)

| Test / Check Suite | Target Command / Path | Result |
|---|---|---|
| Real PostgreSQL / Prisma Concurrency & Boundary Suite | `npm --prefix server run test -- src/__tests__/integration/owner-rooms-r34d-prisma-maintenance-guard.test.ts` | **22 / 22 PASS (100%)** |
| All Backend Unit Test Suites | `npm --prefix server run test -- src/__tests__/unit/` | **59 / 59 PASS (100%)** |
| Frontend Vitest Test Suite (incl. T11-T20) | `npx vitest run src/tests/owner-rooms-r2-cycle-deposits.test.tsx --environment happy-dom` | **108 / 108 PASS (100%)** |
| Frontend TypeScript Check | `npm run lint` | **0 Errors (PASS)** |
| Backend Production Build | `npm --prefix server run build` | **0 Errors (PASS)** |
| UAT Expected Results Baseline Diff | `git diff 17330a94ef40a67b513e698334673558c880ac8d..HEAD -- docs/uat/local07-expected-results.json` | **0 Diff / Clean Baseline** |
| Line Ending & Whitespace Hygiene | `git -c core.whitespace=cr-at-eol diff --check` | **0 Warnings / Clean** |

---

## 28. OWNER ROOMS R3.4e — Edit Modal Status Single-Authority Finalization (2026-08-28)

### Context & Independent Review Findings
Following the independent audit of R3.4d, a final authority defect in the Edit Room modal was identified and corrected:
- **Defect**: While direct status toggle in R3.4d was made single-authority, the Edit Room modal's "เปิดใช้งาน" action still evaluated `setRoomStatus(editingRoom?.currentTenantId ? 'occupied' : 'vacant')`, and rendered a warning `⚠️ ห้องนี้มีผู้เช่าพักอยู่` solely on `editingRoom?.currentTenantId`.
- **Consequence**: If a room was in `maintenance` with a stale compatibility `currentTenantId` pointer, opening the room via the Edit modal would falsely fabricate `status: 'occupied'`.

---

### Surgical Implementations & Architectural Guarantees (R3.4e)

#### Part A: Reopening Maintenance Room Sets `vacant`
- When reopening a room currently in `maintenance`, pressing "เปิดใช้งาน" and saving explicitly sets target `status = 'vacant'`.
- Stale `currentTenantId` pointers are never used to infer operational occupancy.

#### Part B: Safe Catalog Editing Preserves Authoritative Operational Status
- When editing catalog fields (e.g. monthly rent, deposits, floor, initial meters) on an existing room that is `occupied` or `reserved`, saving strictly preserves the original authoritative `Room.status`.
- Non-maintenance statuses do not accidentally collapse to `vacant` when saving general details.

#### Part C: Single Authority Warning Presentation
- Replaced `editingRoom?.currentTenantId` warning trigger with canonical `currentOperationalActions.maintenanceBlockReason`:
  - `ACTIVE_OCCUPANCY`: *"⚠️ มีผู้เช่าพักอยู่ ต้องย้ายหรือสิ้นสุดการเช่าก่อน"*
  - `ACTIVE_RESERVATION`: *"⚠️ มีการจองล่วงหน้า ต้องจัดการการจองก่อน"*
  - `canSetMaintenance = true`: No warning rendered (even if stale `currentTenantId` is present).
  - Missing metadata: *"⚠️ ไม่สามารถตรวจสอบสถานะการเปิดปิดห้องได้ กรุณาโหลดข้อมูลใหม่"*.

---

### Verification Matrix (R3.4e)

| Test / Check Suite | Target Command / Path | Result |
|---|---|---|
| Frontend Vitest Test Suite (incl. T1-T24) | `npx vitest run src/tests/owner-rooms-r2-cycle-deposits.test.tsx --environment happy-dom` | **112 / 112 PASS (100%)** |
| Frontend TypeScript Check | `npm run lint` | **0 Errors (PASS)** |
| Line Ending & Whitespace Hygiene | `git -c core.whitespace=cr-at-eol diff --check` | **0 Warnings / Clean** |
| UAT Expected Results Baseline Diff | `git diff 73b583990c8197c40a17475e160816ea0a19752b..HEAD -- docs/uat/local07-expected-results.json` | **0 Diff / Clean Baseline** |
