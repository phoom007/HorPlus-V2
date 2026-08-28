# HORPLUS-V2 — OWNER ROOMS PHASE C & C.1 CACHE COHERENCE REPORT

**Document ID**: `DOC-OWNER-ROOMS-PHASE-C1-20260828`
**Date**: August 28, 2026
**Repository**: `phoom007/HorPlus-V2`
**Base Phase C Commit**: `15364a2e36a741603a089ea829c6dc475f4bb84d`
**Current `origin/main`**: `7609817303e1403b87ab790935941ee8f90f1258`
**Implementation Branch**: `fix/owner-rooms-cache-coherence-phase-c1-20260828`
**Scope**: Phase C.1 — Precise Room-Mutation Cache Invalidation Correction

---

## 1. Git Truth

| Parameter | Value / Commit SHA |
| :--- | :--- |
| **Top-Level Directory** | `D:/HorPlus-V2` |
| **Implementation Branch** | `fix/owner-rooms-cache-coherence-phase-c1-20260828` |
| **Base Phase C Commit** | `15364a2e36a741603a089ea829c6dc475f4bb84d` |
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

---

## 3. Precise Room-Mutation Invalidation Matrix (Phase C.1)

| Mutation | Rooms Cache | Meter Preview Context | Unrelated Resources (`meterWorkspace`, `contracts`, `tenants`, `bills`) | Downstream Invariant & Reason |
| :--- | :---: | :---: | :---: | :--- |
| **Create** | **INVALIDATE** | **INVALIDATE** (all cached cycles in same dorm) | **NO** | Adds a new room row in PostgreSQL `rooms`. All billing-cycle preview queries in the dormitory require room membership sync. Unrelated resources are untouched. |
| **Archive** | **INVALIDATE** | **INVALIDATE** (all cached cycles in same dorm) | **NO** | Marks `deletedAt` on room. Dropped from `roomRepo.findAll`. All cached preview cycles in the dormitory must drop the archived room. |
| **Room number change** | **INVALIDATE** | **INVALIDATE** (all cached cycles in same dorm) | **NO** | Renames room identity displayed in `meterPreviewContext.rooms[].roomNumber`. |
| **Floor** | **INVALIDATE** | **NO** | **NO** | Floor is not a field in `MeterBillingPreviewContext`. Preview context is preserved. |
| **Building** | **INVALIDATE** | **NO** | **NO** | Building assignment is not represented in `MeterBillingPreviewContext`. |
| **Rent prices** (`monthlyRent`, `termRent`, `dailyRent`) | **INVALIDATE** | **NO** | **NO** | Default catalog prices apply strictly to future contracts. Active rental billing uses locked snapshots (`contract.rentAmount`). Meter preview context is snapshot-based and NOT stale. |
| **Deposit** (`depositAmount`) | **INVALIDATE** | **NO** | **NO** | Default catalog deposit applies to future contracts. Active contract deposits are locked snapshots. |
| **Initial meter values** | **INVALIDATE** | **NO** | **NO** | Baseline counter configuration. Does not alter past/current billing cycle `meter_readings` or preview calculations. |
| **Status** (`vacant` ↔ `maintenance`) | **INVALIDATE** | **NO** | **NO** | Operational status. Dashboard occupancy counters and dropdown filters derive directly from `queryKeys.rooms`. |
| **OCC refresh** | **INVALIDATE** | **NO** | **NO** | Conflict resolution reload. Refetches fresh `rooms` state only without invalidating preview context. |

### Explicit Cache Invalidation Guarantees

```text
meterWorkspace: NEVER invalidated by Room mutations
meterReadings: NEVER invalidated by Room mutations
meterDraftStore: NEVER cleared or destroyed on Room mutations
contracts: NOT invalidated
tenants: NOT invalidated
bills: NOT invalidated
payments: NOT invalidated
```

---

## 4. Implementation Details

### A. Shared Impact Type & Helper (`src/lib/roomMutationCache.ts`)

```ts
export type RoomMutationImpact =
  | { kind: 'create' }
  | { kind: 'update'; roomNumberChanged: boolean }
  | { kind: 'archive' }
  | { kind: 'status' }
  | { kind: 'refresh' };

export function invalidateRoomMutationCaches(
  queryClient: QueryClient,
  dormitoryId: string,
  impact: RoomMutationImpact
): void {
  // Always invalidate canonical rooms query for this dormitory
  queryClient.invalidateQueries({ queryKey: queryKeys.rooms(dormitoryId) });

  const shouldInvalidatePreview =
    impact.kind === 'create' ||
    impact.kind === 'archive' ||
    (impact.kind === 'update' && impact.roomNumberChanged);

  if (shouldInvalidatePreview) {
    // Invalidate all cached preview-context queries for the SAME dormitory across all cycles
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          Array.isArray(key) &&
          key[0] === 'meter' &&
          key[1] === dormitoryId &&
          key[3] === 'preview-context'
        );
      },
    });
  }
}
```

### B. Parent Coordinator Integration (`src/pages/owner.tsx`)

```ts
  const handleSaveRooms = (_newRooms: Room[], impact: RoomMutationImpact = { kind: 'refresh' }) => {
    invalidateRoomMutationCaches(queryClient, activeDormitoryId, impact);
  };
```

### C. Child Component Mutation Bridge (`src/pages/owner/rooms.tsx`)

- **Create Room**: calls `onSaveRooms(rooms, { kind: 'create' })`
- **Update Room (price/deposit/floor/etc.)**: calls `onSaveRooms(rooms, { kind: 'update', roomNumberChanged: false })`
- **Update Room (room number changed)**: calls `onSaveRooms(rooms, { kind: 'update', roomNumberChanged: true })`
- **Archive Room**: calls `onSaveRooms(rooms, { kind: 'archive' })`
- **Status Toggle**: calls `onSaveRooms(rooms, { kind: 'status' })`
- **OCC Reload**: calls `onSaveRooms(rooms, { kind: 'refresh' })`

---

## 5. Active Rental Snapshot Protection

A core invariant of the HorPlus billing architecture:

```text
Room Catalog Rent: 5,000 → 5,500
Active Contract Snapshot Rent: 4,500 (STRICTLY PRESERVED)
Provisional Rental Term: Locked at term agreement unitRentAmount / totalRentAmount
Daily Stay: Locked at daily stay invoice totalRentAmount
Meter Billing Preview: Continues to bill 4,500 based on Contract Snapshot
```

Room catalog edits apply strictly to new, future contracts. Active agreement snapshots and existing bills are immutable to room catalog edits.

---

## 6. Multi-Dormitory and Multi-Cycle Isolation

1. **Dormitory Isolation**:
   - Predicate matches `key[1] === dormitoryId`.
   - Mutations in Dormitory A invalidate Dormitory A queries only. Dormitory B queries remain completely clean (`isInvalidated: false`).
2. **Multi-Cycle Invalidation**:
   - On Room creation, archive, or rename, all cached cycles for that dormitory (`dormId`) are invalidated via the predicate.
   - `selectedBillingCycleId` is no longer a restriction for stale preview queries.
   - `meterWorkspace` (`key[3] === 'workspace'`) and `meterReadings` (`key[3] === 'readings'`) are never matched by the predicate and remain valid.

---

## 7. Verification Results

```text
# 1. Static TypeScript Compilation & Formatting
$ git diff --check
$ npm run lint
> tsc --noEmit
Result: PASS (0 errors)

# 2. Phase C.1 Focused Cache Coherence Suite
$ npx vitest run src/tests/owner-rooms-cache-coherence-phase-c.test.tsx --environment happy-dom
 ✓ src/tests/owner-rooms-cache-coherence-phase-c.test.tsx (11 tests) 1781ms
   ✓ Test 1: Price, Deposit, Status, and Refresh do NOT invalidate Preview Context (3 cases)
   ✓ Test 2: Room Rename invalidates all preview cycles in the SAME dorm only
   ✓ Test 3: Create and Archive invalidate rooms and all preview cycles in same dorm (2 cases)
   ✓ Test 4: OwnerRooms Component Mutation Metadata Bridge (3 cases: create, price update, archive)
   ✓ Test 5: OCC Conflict Reload Metadata (passes { kind: 'refresh' } on reload action)
   ✓ Test 6: Invariant Verification & Draft Store Integrity (proves draft store never cleared)
Result: PASS (11/11 tests passed)

# 3. Phase AB.1 Persistence & OCC Suite
$ npx vitest run src/tests/owner-rooms-persistence-phase-ab.test.tsx --environment happy-dom
 ✓ src/tests/owner-rooms-persistence-phase-ab.test.tsx (8 tests) 3693ms
Result: PASS (8/8 tests passed)
```

---

## 8. Tests Deliberately Not Run

Under the HorPlus **Impact-Based Testing Policy**, the following test suites were deliberately omitted:

- Full backend regression suite (921 tests across 62 files): No backend files were touched in Phase C.1.
- Backend lint / Prisma validation: No backend or Prisma changes.
- Full frontend regression suite (481 tests across 32 files): Unrelated features (payments, LINE OA, tenant onboarding, billing engine) were not modified.
- Full LOCAL-07 navigation suite: Navigation routing and query registration were not modified.

---

## 9. Deferred Work (Phases D–G)

- **Phase D**: Quick Add Tenant modal connection (`POST /contracts`).
- **Phase E**: Dynamic contract deposit formula policy.
- **Phase F**: Archive provisional & daily stay guards.
- **Phase G**: Legacy test modernization.
