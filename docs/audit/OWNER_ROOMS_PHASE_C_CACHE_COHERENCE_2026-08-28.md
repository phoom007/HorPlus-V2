# HORPLUS-V2 — OWNER ROOMS PHASE C CACHE COHERENCE REPORT

**Document ID**: `DOC-OWNER-ROOMS-PHASE-C-20260828`  
**Date**: August 28, 2026  
**Repository**: `phoom007/HorPlus-V2`  
**Implementation Branch**: `fix/owner-rooms-cache-coherence-phase-c-20260828`  
**Base AB.1 Commit**: `71a563f25c228e87b92972d6c39d3c1222d9a704`  
**Current `origin/main`**: `7609817303e1403b87ab790935941ee8f90f1258`  
**Scope**: Phase C — Dependency-Aware Cross-Menu Cache Coherence (Phases D–G strictly deferred)

---

## 1. Git Truth

| Parameter | Value / Commit SHA |
| :--- | :--- |
| **Top-Level Directory** | `D:/HorPlus-V2` |
| **Implementation Branch** | `fix/owner-rooms-cache-coherence-phase-c-20260828` |
| **Base AB.1 Commit** | `71a563f25c228e87b92972d6c39d3c1222d9a704` |
| **Current origin/main** | `7609817303e1403b87ab790935941ee8f90f1258` |
| **Working Tree Isolation** | `docs/uat/local07-expected-results.json` preserved untouched. |

---

## 2. Existing Query Architecture

In HorPlus-V2, server state is managed through canonical React Query keys defined in `src/lib/queryClient.ts`. The route coordinator function `getTargetQueriesForTab` in `src/pages/owner.tsx` maps each tab to its exact underlying data dependencies:

```ts
// Shared Canonical Resource Keys:
queryKeys.rooms(dormId)                  // ['owner', dormId, 'rooms']
queryKeys.buildings(dormId)              // ['owner', dormId, 'buildings']
queryKeys.tenants(dormId)                // ['owner', dormId, 'tenants']
queryKeys.contracts(dormId)              // ['owner', dormId, 'contracts']
queryKeys.bills(dormId)                  // ['owner', dormId, 'bills']
queryKeys.billingCycles(dormId)          // ['owner', dormId, 'billing-cycles']
queryKeys.maintenance(dormId)            // ['owner', dormId, 'maintenance']
queryKeys.announcements(dormId)          // ['owner', dormId, 'announcements']
queryKeys.meterWorkspace(dormId, cycle)  // ['meter', dormId, cycleId, 'workspace']
queryKeys.meterPreviewContext(dorm, cyc) // ['meter', dormId, cycleId, 'preview-context']
```

### Resource Consumer Mapping

| Tab / Menu | Canonical Queries Consumed via `getTargetQueriesForTab` |
| :--- | :--- |
| **Dashboard** | `rooms`, `buildings`, `billingCycles`, `bills`, `maintenance`, `tenants`, `contracts`, `meterReadings` (if cycle active) |
| **Rooms** | `rooms`, `buildings`, `tenants`, `contracts`, `bills` |
| **Tenants** | `tenants`, `rooms`, `contracts`, `bills` |
| **Contracts** | `contracts`, `rooms`, `tenants`, `bills` |
| **Meters** | `rooms`, `buildings`, `billingCycles`, `bills`, `tenants`, `contracts`, `meterWorkspace`, `meterPreviewContext` |
| **Maintenance** | `maintenance`, `rooms`, `tenants` |
| **Announcements** | `announcements`, `rooms`, `buildings` |
| **Reports** | `rooms`, `bills`, `buildings`, `tenants`, `contracts`, `billingCycles` |

---

## 3. Room Mutation Dependency Matrix

For each Room mutation type, the following table details which cached server-state resources genuinely become stale versus those that remain valid:

| Room Mutation Type | `rooms(dormId)` | `tenants(dormId)` | `contracts(dormId)` | `bills(dormId)` | `meterWorkspace` | `meterPreviewContext` | `meterReadings` | Page-Specific Caches | Downstream Invariant & Rationale |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **1. Create Room** | **INVALIDATE** | NO | NO | NO | NO | **INVALIDATE (cycle)** | NO | NONE | Adds a new row in PostgreSQL `rooms`. `queryKeys.rooms` refetches. `meterPreviewContext` contains the list of all dormitory rooms; must be refreshed if a cycle is cached. Unrelated resources are untouched. |
| **2. Update Room Identity** (`roomNumber`, `floor`, `buildingId`) | **INVALIDATE** | NO | NO | NO | NO | **INVALIDATE (cycle)** | NO | NONE | Renames room or changes floor/building assignment in `rooms`. `meterPreviewContext` displays `roomNumber`. Tenants/contracts/bills untouched. |
| **3. Update Room Pricing** (`monthlyRent`, `termRent`, `dailyRent`) | **INVALIDATE** | NO | NO | NO | NO | NO | NO | NONE | Modifies default catalog prices in `rooms`. Active contract billing uses immutable snapshots (`contract.rentAmount`), not raw catalog prices. Existing bills, contracts, and meter workspace remain strictly unchanged. |
| **4. Update Room Deposit** (`depositAmount`) | **INVALIDATE** | NO | NO | NO | NO | NO | NO | NONE | Modifies default catalog deposit. Active contract deposits are locked snapshots. No tenant or bill affected. |
| **5. Update Initial Meter Reading** (`initialWaterReading`, `initialElectricityReading`) | **INVALIDATE** | NO | NO | NO | NO | NO | NO | NONE | Updates baseline counter for future initialization. Does not retroactively alter billing cycle `meterReading` records. |
| **6. Status Toggle** (`vacant` ↔ `maintenance`) | **INVALIDATE** | NO | NO | NO | NO | NO | NO | NONE | Updates status in `rooms`. Dashboard occupancy calculations and dropdown filters derive directly from the refreshed `rooms` array. Meter readings and contracts are unaffected. |
| **7. Archive Room** (`archiveRoom` / soft-delete) | **INVALIDATE** | NO | NO | NO | NO | **INVALIDATE (cycle)** | NO | NONE | Marks `deletedAt` timestamp on room. `rooms` query excludes deleted rooms. `meterPreviewContext` server implementation calls `findAll` without deleted rooms; invalidating it drops the archived room from cached cycle previews. |

---

## 4. Shared Consumer Analysis

In HorPlus-V2, UI screens/tabs do **not** own isolated copies of room data. Page names are navigation routes, not server resources.

- **Dashboard**: Receives `rooms: Room[]` via props from `OwnerWorkspace`. When `queryKeys.rooms(dormId)` is invalidated, Dashboard metrics (total rooms, occupied, vacant, maintenance) immediately reflect the new server state without any dedicated "dashboard invalidation".
- **Tenants**: Receives `rooms` via props. Room selectors and room badges update automatically. Tenant records are untouched.
- **Contracts**: Receives `rooms` via props. Room catalog information updates; active contract rent snapshots remain unchanged.
- **Maintenance / Announcements**: Room selectors receive the updated room list through the shared `rooms` prop.
- **Reports**: Occupancy and revenue projections consume the shared `rooms` prop.

**Conclusion**: No dedicated tab invalidations are required. Invalidation targets the true resource (`queryKeys.rooms(dormId)`), and all consumers update seamlessly.

---

## 5. Meter Dependency Analysis

1. **`meterWorkspace`**:
   - Represents `meter_readings` and `RoomBillingCycleSnapshot` data for a cycle.
   - Room catalog updates (rent, deposit, status) do NOT alter meter readings or cycle snapshots.
   - `meterWorkspace` is **NOT** invalidated upon room metadata changes.
2. **`meterPreviewContext`**:
   - Resolved by `GET /api/v1/meters/workspace/preview-context?billingCycleId={cycleId}` (`MeterService.getMeterBillingPreviewContext`).
   - Returns room-by-room billing preview. The room list is derived from `roomRepo.findAll(dormitoryId)`.
   - When a room is **Created**, **Renamed (Identity)**, or **Archived**, `meterPreviewContext` becomes stale for the active cycle.
   - When `selectedBillingCycleId` is present, `handleSaveRooms` invalidates `queryKeys.meterPreviewContext(activeDormitoryId, selectedBillingCycleId)`.
3. **`meterReadings`**:
   - Holds raw meter utility readings. Untouched by room catalog edits.
4. **`meterDraftStore`**:
   - In-memory sparse draft store preserving user typing before Save.
   - Room mutations never call `clearDormitoryDrafts`. Unsaved user inputs in the Meter workspace are strictly preserved.

---

## 6. Active Rental Snapshot Protection

A core product invariant in HorPlus is that editing catalog prices in `/owner/rooms` **never** alters historical or active rental billing:

```text
Room Catalog Rent: 5,000 → 5,500
Active Contract Snapshot Rent: 4,500 (STRICTLY PRESERVED)
Provisional Rental Term: Locked at term agreement unitRentAmount / totalRentAmount
Daily Stay: Locked at daily stay invoice totalRentAmount
Meter Billing Preview: Continues to bill 4,500 based on Contract Snapshot
```

Catalog prices apply strictly to new, future contract creations. Active agreement snapshots are immutable to room catalog edits.

---

## 7. Implementation Details

In `src/pages/owner.tsx`:

```ts
  // State saving handlers with targeted query invalidation
  const handleSaveRooms = (_newRooms: Room[]) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.rooms(activeDormitoryId) });
    if (selectedBillingCycleId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(activeDormitoryId, selectedBillingCycleId) });
    }
  };
```

- **Keys Invalidated**:
  - `queryKeys.rooms(activeDormitoryId)`
  - `queryKeys.meterPreviewContext(activeDormitoryId, selectedBillingCycleId)` (if cycle selected)
- **Keys Intentionally NOT Invalidated**:
  - `queryKeys.tenants(activeDormitoryId)`
  - `queryKeys.contracts(activeDormitoryId)`
  - `queryKeys.bills(activeDormitoryId)`
  - `queryKeys.payments(activeDormitoryId)`
  - `queryKeys.maintenance(activeDormitoryId)`
  - `queryKeys.announcements(activeDormitoryId)`
  - `queryKeys.meterWorkspace(activeDormitoryId, selectedBillingCycleId)`
  - `meterDraftStore`

---

## 8. Dormitory & Cycle Isolation

- **Dormitory Isolation**: Every query key is strictly prefixed with `['owner', activeDormitoryId, ...]` or `['meter', activeDormitoryId, ...]`. Mutations in Dormitory A will never invalidate or refetch queries belonging to Dormitory B.
- **Cycle Isolation**: `meterPreviewContext` invalidation targets only the currently active `selectedBillingCycleId`. Inactive past cycles are not prematurely invalidated.

---

## 9. Test Impact Matrix

| Test Case | Target Behavior Protected |
| :--- | :--- |
| **Test A & C: Dependency-Aware Invalidation** | Proves `queryKeys.rooms(dormId)` and `queryKeys.meterPreviewContext(dormId, cycleId)` are invalidated on save, while `tenants`, `contracts`, `bills`, and `meterWorkspace` are NOT invalidated. |
| **Test B: No Unnecessary Invalidation** | Proves catalog price edits do not cause spurious invalidations of unrelated resources. |
| **Test D: Multi-Dormitory Isolation** | Proves invalidation in Dormitory Alpha leaves Dormitory Beta cache completely clean (`isInvalidated: false`). |
| **Test E: Active Contract Snapshot Protection** | Proves changing a room catalog price from 5,000 to 5,500 leaves active contract rent snapshot strictly at 4,500. |
| **Test F: Meter Draft Store Preservation** | Proves room invalidations never invoke `meterDraftStore.clearDormitoryDrafts` or wipe unsaved dirty meter drafts. |

---

## 10. Verification Results

```text
# 1. Static TypeScript Compilation
$ npm run lint
> tsc --noEmit
Result: PASS (0 errors)

# 2. Phase C Focused Cache Coherence Suite
$ npx vitest run src/tests/owner-rooms-cache-coherence-phase-c.test.tsx --environment happy-dom
 ✓ src/tests/owner-rooms-cache-coherence-phase-c.test.tsx (5 tests) 35ms
   ✓ Test A & C: Dependency-Aware Invalidation on Room Mutation > invalidates queryKeys.rooms(dormId) and queryKeys.meterPreviewContext(dormId, cycleId) but leaves unrelated caches untouched
   ✓ Test B: No Unnecessary Resource Invalidation for Catalog Price Edits > proves catalog price edits do not invalidate contract or tenant caches
   ✓ Test D: Multi-Dormitory Cache Isolation > proves mutations in Dorm A do NOT invalidate or corrupt Dorm B cache
   ✓ Test E: Active Contract Rent Snapshot Protection > proves room catalog price edit does not alter active contract rent snapshot
   ✓ Test F: Meter Draft Store Preservation > proves room mutation does NOT clear or destroy user unsaved meter drafts

# 3. Phase AB.1 Persistence & Data-Ready Navigation Suites
$ npx vitest run src/tests/owner-rooms-persistence-phase-ab.test.tsx src/tests/local07-owner-data-ready-navigation.test.tsx --environment happy-dom
 ✓ src/tests/local07-owner-data-ready-navigation.test.tsx (23 tests) 474ms
 ✓ src/tests/owner-rooms-persistence-phase-ab.test.tsx (8 tests) 6852ms
Result: PASS (31/31 tests passed)
```

---

## 11. Tests Deliberately Not Run

Under the HorPlus **Impact-Based Testing Policy**, the following test suites were deliberately omitted because they are outside the impact set of the Phase C cache invalidation diff:

- Full backend regression suite (921 tests across 62 files): No backend code was modified in Phase C.
- Full frontend regression suite (481 tests across 32 files): Unrelated pages (payments, LINE OA onboarding, login, etc.) were not modified.
- Legacy prototype tests (`wave1g-owner-ui.test.tsx`): Known legacy prototype tests scheduled for Phase G.

---

## 12. Manual UAT Walkthrough for Product Owner

### UAT 1 — Room Price Edit → Dashboard Verification
1. Navigate to `/owner/rooms`.
2. Edit Room `101` catalog price from `4500` to `5000`. Click Save.
3. Click **Dashboard** tab in sidebar.
4. **Expected**: Dashboard renders updated room pricing/overview without requiring full browser reload (F5).

### UAT 2 — Room Price Edit → Contracts Snapshot Verification
1. Note Room `102` has an active contract with rent `4500`.
2. Go to `/owner/rooms`, edit Room `102` catalog price to `6000`. Click Save.
3. Open **Contracts** tab.
4. **Expected**: The active contract for Room `102` continues to show rent `4,500` (snapshot preserved).

### UAT 3 — Room Price Edit → Meter Billing Preview Verification
1. Note Room `102` in **Meters** tab has rent `4,500` (from active contract).
2. In `/owner/rooms`, change catalog price of Room `102` to `6,000`. Click Save.
3. Navigate back to **Meters** tab.
4. **Expected**: Room `102` monthly rent in meter preview remains `4,500.00` (snapshot authority preserved).

### UAT 4 — Create Room → Cross-Menu Propagation
1. In `/owner/rooms`, click **"+ เพิ่มห้องพัก"** and create Room `901`.
2. Navigate to **Dashboard**, **Meters**, and **Reports**.
3. **Expected**: Room `901` is visible across all three tabs automatically via canonical `queryKeys.rooms`.

### UAT 5 — Archive Room Verification
1. In `/owner/rooms`, open a vacant room without tenant and click **"จัดเก็บห้องพัก"**.
2. Confirm the archive action.
3. Navigate to **Meters** and **Dashboard**.
4. **Expected**: The archived room disappears from active lists without leaving orphaned rows.

### UAT 6 — Multi-Dormitory Isolation Verification
1. Edit a room in **Dormitory A**.
2. Switch to **Dormitory B** via the dormitory selector.
3. **Expected**: Dormitory B's cached rooms and billing previews are unaffected and retain their own separate server state.

---

## 13. Deferred Work (Phases D–G)

- **Phase D**: Quick Add Tenant modal connection (`POST /contracts`).
- **Phase E**: Dynamic contract deposit formula policy.
- **Phase F**: Archive provisional & daily stay guards.
- **Phase G**: Legacy test modernization.
