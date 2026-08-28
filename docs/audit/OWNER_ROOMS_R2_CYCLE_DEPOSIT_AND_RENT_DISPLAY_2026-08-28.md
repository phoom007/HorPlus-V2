# OWNER ROOMS R2 — Rent-Cycle Deposit Model, Rent Presentation & Concise Error UX Audit

**Date:** 2026-08-28
**Branch:** `fix/owner-rooms-cycle-deposits-display-r2-20260828`
**Baseline Base Commit:** `07ff8de69d2aadb9dfc6dceb2b58b72b36beaa45`
**Author:** HorPlus Senior Full-Stack Engineering
**Status:** COMPLETED & VERIFIED

---

## 1. Executive Summary

This implementation round executes **OWNER ROOMS R2** according to the Product Owner-approved rules and Plan Review Gate Mandatory Amendments:
1. **Three Independent Room Deposit Fields:** Added `termDeposit`, `monthlyDeposit`, and `dailyDeposit` to the `Room` model in Prisma and PostgreSQL.
2. **Deterministic Migration & Backfill:** Created migration `20260828140000_owner_rooms_r2_cycle_deposits` which backfills all existing rooms (including archived rooms) with their exact legacy pre-R2 effective deposit (`r.deposit_amount` override -> `b.deposit_amount` -> `dpd.default_deposit` -> `0.00`).
3. **Provisional Agreement Deposit Snapshot:** Added nullable `depositAmount` to `ProvisionalRentalTerm` so Quick Add (MONTHLY/TERM) persists the agreement deposit snapshot without fabricating payment status.
4. **All Agreement Entry Points Defaulting:** Defaulting deposit based on selected rental cycle:
   - `TERM` (รายเทอม) -> `room.termDeposit`
   - `MONTHLY` (รายเดือน) -> `room.monthlyDeposit`
   - `DAILY` (รายวัน) -> `room.dailyDeposit`
5. **Agreement Snapshot Authority:** Agreement deposits are persisted on agreement creation. Contract activation snapshots the stored contract deposit using explicit nullish checks (preserving `0.00` without falsy fallback). Subsequent Room catalog edits do not rewrite agreement snapshots.
6. **Retire Live Deposit Inheritance:** After R2 migration, cycle deposits are explicitly Room-owned values and do not dynamically inherit or rewrite when Dormitory/Building defaults change.
7. **Batch-Loaded Active Rental Summary:** Implemented `buildAuthoritativeRoomsResponseBatch` in `DefaultsService` to batch-load active contracts, snapshots, provisional terms, and daily stays in single queries, preventing N+1 queries. Conflicting active agreements fail closed.
8. **Rent Rate Presentation:**
   - **Grid Mode:** Vacant rooms display all 3 configured catalog rates; Occupied rooms display ONLY the active tenant's agreement rate.
   - **List Mode:** Primary / Active rate is rendered first + bold; remaining catalog rates follow below.
9. **Modal 3-Column Deposit Rhythm:** Replaced the single deposit input in Room modal with 3 independent inputs matching the rent input layout (`รายเทอม | รายเดือน | รายวัน`).
10. **Concise Room Error UX:** Implemented pure `getOwnerRoomMutationErrorMessage` helper returning clear, concise Thai error messages.

---

## 2. Inventory of Changes

### A. Database & Migrations
- `server/prisma/schema.prisma`:
  - Added `termDeposit`, `monthlyDeposit`, `dailyDeposit` to `model Room`.
  - Added `depositAmount` to `model ProvisionalRentalTerm`.
- `server/prisma/migrations/20260828140000_owner_rooms_r2_cycle_deposits/migration.sql`:
  - DDL for new columns + deterministic backfill SQL.

### B. Backend Services & Schemas
- `server/src/schemas/property-tenant-contract.schemas.ts`:
  - `CreateRoomSchema` and `UpdateRoomSchema` accept `termDeposit`, `monthlyDeposit`, `dailyDeposit`.
- `server/src/schemas/billing-meter.schemas.ts`:
  - `CreateProvisionalRentalTermSchema` accepts optional `depositAmount`.
- `server/src/services/defaults.service.ts`:
  - Extended `EffectiveRoomDefaults` and `resolveEffectiveRoomDefaults` to resolve `termDeposit`, `monthlyDeposit`, `dailyDeposit`.
  - Added `ActiveRentalSummary` interface and fail-closed resolution.
  - Implemented `buildAuthoritativeRoomsResponseBatch` for batch loading without N+1 overhead.
- `server/src/services/room.service.ts`:
  - In `createRoom`: seeds cycle deposits from `DormitoryPropertyDefaults.defaultDeposit` when omitted.
- `server/src/services/provisional-rental-term.service.ts`:
  - Persists `depositAmount` in `tx.provisionalRentalTerm.create`.
- `server/src/services/contract.service.ts`:
  - In `createContract`: defaults `depositAmount` from room cycle deposit if omitted.
  - In `activateContract`: snapshots `resolvedDeposit` and `resolvedRent` using explicit nullish checks.
- `server/src/services/dormitory-provisioning.service.ts`:
  - Seeds `termDeposit`, `monthlyDeposit`, `dailyDeposit` during dormitory bootstrap.
- `server/src/routes/property.routes.ts`:
  - `GET /rooms`: uses `buildAuthoritativeRoomsResponseBatch`.
  - `GET /rooms/:id/quick-add-context`: exposes `monthlyDeposit`, `termDeposit`, `dailyDeposit` in `effective` and `sources`.

### C. Frontend Architecture & Types
- `src/types.ts`:
  - Added `termDeposit`, `monthlyDeposit`, `dailyDeposit`, and `activeRentalSummary` to `Room`.
  - Added `ActiveRentalSummary` and updated `RoomFieldSources` & `EffectiveValues`.
- `src/data/contracts/index.ts`:
  - Added `termDeposit`, `monthlyDeposit`, `dailyDeposit` to `CreateRoomPayload` and `UpdateRoomChanges`.
- `src/lib/roomNormalizer.ts`:
  - Strict parsing of `termDeposit`, `monthlyDeposit`, `dailyDeposit` with `parseRequiredFiniteNumber`.
  - Normalization of `activeRentalSummary`.
- `src/lib/roomErrorMapper.ts`:
  - Pure helper returning concise Thai error messages based on authoritative error codes.
- `src/lib/roomRentalSummary.ts`:
  - Pure presentation helper resolving Grid mode (active-only vs all-catalog) and List mode (primary first + bold) rates.
- `src/pages/owner/rooms.tsx`:
  - 3-column input rhythm for deposit defaults (`รายเทอม | รายเดือน | รายวัน`).
  - Grid & List rent rate presentation using `getGridRentRates` and `getListRentRates`.
  - Error mapper integration in mutation handlers.
- `src/components/QuickAddTenantModal.tsx`:
  - Prefills cycle-specific deposits and sends `depositAmount` in provisional term payloads.

---

## 3. Verification Results

### Automated Impact Tests
1. `src/tests/owner-rooms-r2-cycle-deposits.test.tsx` (9 tests): **PASSED**
   - Normalizer parses 3 cycle deposits and activeRentalSummary.
   - Fail-closed transport validation on malformed financial numbers.
   - Error mapper exact Thai message mappings.
   - Grid mode active-only vs vacant-all rates.
   - List mode primary rate first + bold ordering.
   - Cycle deposit resolver.
2. `src/tests/owner-rooms-api-contract-uat-r1.test.tsx` (9 tests): **PASSED**
3. `src/tests/owner-rooms-persistence-phase-ab.test.tsx` (8 tests): **PASSED**
4. `src/tests/owner-rooms-cache-coherence-phase-c.test.tsx` (11 tests): **PASSED**

**Total Test Count:** 37 passed, 0 failed.

### Static Code & Type Checking
- `npm run lint` (`tsc --noEmit`): **PASSED (0 errors)**
- `npm run lint:api` (`tsc --noEmit`): **PASSED (0 errors)**
- `git diff --check`: **PASSED (0 whitespace/CRLF errors)**
- `docs/uat/local07-expected-results.json`: **Preserved untouched, uncommitted, and unstaged**.
