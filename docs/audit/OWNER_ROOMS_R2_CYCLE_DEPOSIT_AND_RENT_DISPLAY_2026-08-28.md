# OWNER ROOMS R2 & R2.1 — Rent-Cycle Deposit Model, Rent Presentation & Behavior Hardening Audit

**Date:** 2026-08-28  
**Base Commit:** `07ff8de69d2aadb9dfc6dceb2b58b72b36beaa45`  
**R2 Commit:** `1833799b165d49c645b42a02d367eb530600a77e`  
**R2.1 Hardening Branch:** `fix/owner-rooms-r21-hardening-20260828`  
**Author:** HorPlus Senior Full-Stack Engineering  
**Status:** COMPLETED & VERIFIED  

---

## 1. Executive Summary

This implementation round executes **OWNER ROOMS R2 & R2.1** according to the Product Owner-approved rules, Plan Review Gate Mandatory Amendments, and Independent Review Hardening Directives:
1. **Three Independent Room Deposit Fields:** Added `termDeposit`, `monthlyDeposit`, and `dailyDeposit` to the `Room` model in Prisma and PostgreSQL.
2. **Deterministic Migration & Invariants:**
   - Migration `20260828140000_owner_rooms_r2_cycle_deposits` backfilled all existing rooms with their legacy pre-R2 effective deposit.
   - Migration `20260828150000_owner_rooms_r21_cycle_deposits_not_null` enforces `NOT NULL` constraints on `term_deposit`, `monthly_deposit`, and `daily_deposit`.
3. **Provisional Agreement Deposit Snapshot:** Added `depositAmount` to `ProvisionalRentalTerm` so Quick Add (MONTHLY/TERM) persists the agreement deposit snapshot without fabricating payment status.
4. **All Agreement Entry Points Single Authority Defaulting:** Defaulting deposit based on selected rental cycle across all flows:
   - `TERM` (รายเทอม) -> `room.termDeposit`
   - `MONTHLY` (รายเดือน) -> `room.monthlyDeposit`
   - `DAILY` (รายวัน) -> `room.dailyDeposit`
5. **Agreement Snapshot Authority:** Agreement deposits are persisted on agreement creation. Contract activation snapshots the stored contract deposit using explicit nullish checks (preserving `0.00` without falsy fallback). Subsequent Room catalog edits do not rewrite agreement snapshots.
6. **Retire Live Deposit Inheritance & Default Propagation Invariance:** After R2 migration, cycle deposits are explicitly Room-owned values. Changing `defaultDeposit` at Dormitory or Building level does NOT rewrite or modify existing room cycle deposits.
7. **Batch-Loaded Active Rental Summary (Physically Active NOW):** Implemented `buildAuthoritativeRoomsResponseBatch` in `DefaultsService`. Active agreements are strictly filtered to those whose physical date interval includes the current timestamp (`startDate <= now` and `(!endDate || endDate > now)`). Future reservations and expired agreements are excluded. Multiple overlapping or cross-source active agreements fail closed (`activeRentalSummary = null`).
8. **Rent Rate Presentation & Fail-Closed Behavior:**
   - **Grid Mode:** Vacant rooms display all 3 configured catalog rates; Occupied rooms display ONLY the active tenant's agreement rate. Occupied rooms lacking active agreement render neutral state `ไม่พบข้อมูลอัตราค่าเช่าปัจจุบัน` without guessing catalog rate.
   - **List Mode:** Primary / Active rate is rendered first + bold; remaining catalog rates follow below. Occupied rooms without active agreement show neutral state and catalog rates as secondary only.
9. **Modal 3-Column Deposit Rhythm & Dorm Defaults Seed:** Replaced single deposit input with 3 independent inputs (`รายเทอม | รายเดือน | รายวัน`), seeded from `DormitoryPropertyDefaults.defaultDeposit` on Create Room. Removed legacy `depositAmount` from frontend writes.
10. **Canonical Quick-Add & Error UX:** Connected "เพิ่มผู้เช่า" directly to canonical `GET /api/v1/properties/rooms/:id/quick-add-context` -> `QuickAddTenantModal`. Removed local fake tenant creation. Integrated pure `getOwnerRoomMutationErrorMessage` helper across all mutation error handlers.

---

## 2. Inventory of Changes

### A. Database & Migrations
- `server/prisma/schema.prisma`:
  - Defined `termDeposit Decimal @map("term_deposit") @db.Decimal(12, 2)` (NOT NULL).
  - Defined `monthlyDeposit Decimal @map("monthly_deposit") @db.Decimal(12, 2)` (NOT NULL).
  - Defined `dailyDeposit Decimal @map("daily_deposit") @db.Decimal(12, 2)` (NOT NULL).
  - Added `depositAmount` to `model ProvisionalRentalTerm`.
- `server/prisma/migrations/20260828140000_owner_rooms_r2_cycle_deposits/migration.sql`:
  - DDL for new columns + deterministic backfill SQL.
- `server/prisma/migrations/20260828150000_owner_rooms_r21_cycle_deposits_not_null/migration.sql`:
  - Enforced `ALTER TABLE "rooms" ALTER COLUMN "term_deposit" SET NOT NULL;` etc.

### B. Backend Services & Schemas
- `server/src/schemas/property-tenant-contract.schemas.ts`:
  - `CreateRoomSchema` accepts `termDeposit`, `monthlyDeposit`, `dailyDeposit`.
  - `UpdateRoomSchema` disallows `null` on cycle deposits (cannot clear existing deposit to null).
  - `CreateContractSchema.depositAmount` is optional without forced `'0.00'` default.
- `server/src/schemas/billing-meter.schemas.ts`:
  - `CreateProvisionalRentalTermSchema` accepts optional `depositAmount`.
- `server/src/db/repositories/contract.repository.ts`:
  - `CreateContractData.depositAmount` typed as `string | number | null`.
- `server/src/services/defaults.service.ts`:
  - `resolveEffectiveRoomDefaults` resolves `termDeposit`, `monthlyDeposit`, `dailyDeposit` with source `'ROOM'`.
  - `previewDefaultPropagation` skips room-owned cycle deposits (`skipReason = 'ROOM_OWNED_CYCLE_DEPOSIT'`).
  - `buildAuthoritativeRoomsResponseBatch` and `buildAuthoritativeRoomResponse` filter agreements strictly to physically-current dates and fail-closed on duplicate/overlapping active agreements.
- `server/src/services/room.service.ts`:
  - In `createRoom`: seeds cycle deposits from `DormitoryPropertyDefaults.defaultDeposit` when omitted.
- `server/src/services/contract.service.ts`:
  - In `createContract`: resolves `contractDeposit` before branching between Prisma and mock repository. Defaults from `room.termDeposit` (term), `room.monthlyDeposit` (monthly), or `room.dailyDeposit` (daily). Preserves explicit `0.00`.
  - In `activateContract`: snapshots stored contract deposit using nullish check.
- `server/src/services/provisional-rental-term.service.ts`:
  - In `createProvisionalRentalTerm`: defaults agreement deposit from `room.termDeposit` (for `TERM`) or `room.monthlyDeposit` (for `MONTHLY`) when omitted. Preserves explicit `0.00`.
- `server/src/services/daily-stay.service.ts` & `server/src/routes/daily-stay.routes.ts`:
  - Fallback from `effective.dailyDeposit` when deposit is omitted.
- `server/src/services/dormitory-provisioning.service.ts`:
  - Seeds `termDeposit`, `monthlyDeposit`, `dailyDeposit` during dormitory bootstrap.
- `server/src/routes/property.routes.ts`:
  - `GET /rooms`: uses `buildAuthoritativeRoomsResponseBatch`.
  - `GET /rooms/:id/quick-add-context`: exposes cycle deposits in `effective` and `sources`.

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
  - Pure helper returning concise Thai error messages based on authoritative error codes (including nested error shapes).
- `src/lib/roomRentalSummary.ts`:
  - Presentation helper resolving Grid mode (active-only vs all-catalog vs neutral unavailable text) and List mode rates.
- `src/pages/owner/rooms.tsx`:
  - 3-column input rhythm for deposit defaults (`รายเทอม | รายเดือน | รายวัน`), seeded from `dormDefaults.defaultDeposit`.
  - Grid & List rent rate presentation with fail-closed neutral text when occupied room lacks active agreement.
  - Connected "เพิ่มผู้เช่า" to `QuickAddTenantModal` via `GET /properties/rooms/:id/quick-add-context`.
  - Error mapper integration across mutation handlers.
- `src/pages/owner/tenants.tsx`:
  - Tenant registration approval defaults `approveRent` from `Room.monthlyRent` and `approveDeposit` from `Room.monthlyDeposit`.
- `src/components/QuickAddTenantModal.tsx`:
  - Prefills cycle-specific deposits and sends `depositAmount` in provisional term payloads.

---

## 3. R2.1 Independent Review Corrections & Line-Ending Hygiene

| Area | Issue Identified in Review | R2.1 Resolution & Hardened Behavior |
|---|---|---|
| **Diff Hygiene** | Whole-file line-ending rewrites in 5 backend files | Restored repository-native CRLF on the 5 backend files, eliminating line-ending churn. |
| **Room Cycle Deposits Invariant** | Nullable cycle deposits allowed ambiguity | Added migration setting `term_deposit`, `monthly_deposit`, `daily_deposit` to `NOT NULL`. Update schema disallows `null`. |
| **Dormitory Default Seed** | Frontend hardcoded 9000/9000/1000 on Create Room | Frontend fetches `DormitoryPropertyDefaults.defaultDeposit` and initializes all 3 deposits to this seed value. |
| **Legacy Field Churn** | Frontend still sent legacy `depositAmount` on save | Removed `depositAmount` from frontend create and update payloads. |
| **Default Propagation** | Risk of `defaultDeposit` rewriting existing rooms | `previewDefaultPropagation` excludes room-owned cycle deposits. Existing rooms never modified. |
| **Single Contract Authority** | `depositAmount` schema forced `'0.00'`, branching differed | Removed schema default `'0.00'`. Resolved `contractDeposit` before branching with explicit nullish check. |
| **Provisional Agreement Default** | Backend used truthiness `data.depositAmount ?` | Backend resolves from `room.termDeposit` / `room.monthlyDeposit` when omitted. Explicit 0 preserved. |
| **Daily Stay Default** | Fallback used legacy `effective.depositAmount` | Fallback changed to `effective.dailyDeposit`. |
| **Tenant Registration Approval** | Hardcoded `'9000'` / `'10000'` in `tenants.tsx` | Resolves `approveRent` from `room.monthlyRent` and `approveDeposit` from `room.monthlyDeposit`. |
| **Active Rental Summary** | Future/expired agreements included; conflicts picked first | Strictly checks `startDate <= now` and physical interval. Overlaps/conflicts fail closed (`null`). |
| **Frontend Presentation** | Occupied without active agreement guessed catalog price | Renders neutral state `ไม่พบข้อมูลอัตราค่าเช่าปัจจุบัน` (no guessed price). |
| **Quick-Add Authority** | Fake local modal and fabricated IDs in `rooms.tsx` | Removed fake handler; wired directly to canonical `QuickAddTenantModal`. |
| **Error Mapper Integration** | Unmapped error messages on room mutation failure | Integrated `getOwnerRoomMutationErrorMessage` in create, update, delete, and toggle catch handlers. |

---

## 4. Verification & Quality Gates

### Automated Impact Tests
1. `src/tests/owner-rooms-r2-cycle-deposits.test.tsx` (14 tests): **PASSED**
   - 3 cycle deposits and activeRentalSummary normalization.
   - Fail-closed transport validation on malformed numbers.
   - Error mapper exact Thai mappings and nested shapes.
   - Grid mode active-only vs vacant-all vs fail-closed neutral text.
   - List mode primary first + secondary catalog rates.
   - Cycle deposit resolver.
   - Schema defaulting: `CreateContractSchema.depositAmount` is optional; `UpdateRoomSchema` rejects `null` cycle deposits.
2. `src/tests/owner-rooms-persistence-phase-ab.test.tsx` (8 tests): **PASSED**
3. `server/src/__tests__/unit/room-service-creation.test.ts` (3 tests): **PASSED**
4. `server/src/__tests__/unit/room-number.normalizer.test.ts` (11 tests): **PASSED**

**Total Test Count:** 36 passed, 0 failed.

### Static Code & Type Checking
- `npm run lint` (`tsc --noEmit`): **PASSED (0 errors)**
- `npm run lint:api` (`tsc --noEmit`): **PASSED (0 errors)**
- `npm --prefix server run prisma:validate`: **PASSED (Schema valid)**
- `docs/uat/local07-expected-results.json`: **Preserved untouched, uncommitted, and unstaged**.
