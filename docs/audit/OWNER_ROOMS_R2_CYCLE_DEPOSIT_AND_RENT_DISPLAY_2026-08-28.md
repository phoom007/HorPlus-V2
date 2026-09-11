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


### 3.1. R2.1a — Independent Review Corrections

Independent review of R2.1 identified surgical gaps that required correction before runtime UAT:

1. **Tenant Registration Hardcoded Defaults**:
   - *Prior Gap*: `src/pages/owner/tenants.tsx` still had initial state '4500' / '9000', on-click fallbacks '5000' / '10000', and submit fallbacks '5000' / '10000'.
   - *R2.1a Correction*: All initial states and hardcoded fallbacks removed. Requested room is resolved from `rooms` prop. `approveRent = room.monthlyRent`, `approveDeposit = room.monthlyDeposit` with nullish semantics. Explicit 0 deposit is preserved. If room or required financial data is missing, fails closed with user-visible alert ('ไม่พบข้อมูลห้องพักหรืออัตราค่าเช่าที่กำหนดสำหรับคำขอนี้').

2. **Daily Agreement Defaulting**:
   - *Prior Gap*: `ownerQuickAddDailyStay` in `server/src/services/daily-stay.service.ts` still fell back to legacy `effective.depositAmount`.
   - *R2.1a Correction*: Fallback changed strictly to `effective.dailyDeposit`. Explicit 0 is preserved. Legacy `effective.depositAmount` fallback completely removed.

3. **Contract Single Authority Execution**:
   - *Prior Gap*: Non-Prisma repository create path in `server/src/services/contract.service.ts` spread original data without the resolved `contractDeposit`. Cross-cycle fallbacks were still present in fallback branches.
   - *R2.1a Correction*: `contractDeposit` resolved strictly per cycle (`term` -> `termDeposit`, `daily` -> `dailyDeposit`, `monthly` -> `monthlyDeposit`) and fails closed (`ROOM_DEPOSIT_NOT_CONFIGURED`) if unconfigured. Both Prisma and non-Prisma execution paths call create with `depositAmount: contractDeposit`.

4. **Active Rental Summary Bangkok Physical Intervals**:
   - *Prior Gap*: Date strings were compared directly against UTC `now`, missing inclusive Bangkok end-of-day boundaries and exact Daily Stay check-in/out timestamps.
   - *R2.1a Correction*: Integrated canonical interval utilities from `server/src/utils/occupancy-interval.util.ts` (`getContractPhysicalInterval`, `getProvisionalTermPhysicalInterval`, `getDailyStayPhysicalInterval`). Created shared pure helper `resolveCurrentActiveRentalSummary` used identically in `buildAuthoritativeRoomResponse` (single) and `buildAuthoritativeRoomsResponseBatch` (batch). Contract inclusive final day in Bangkok is CURRENT; future agreements/stays are NOT CURRENT; RESERVED daily stays are NOT CURRENT; conflicts fail closed (`null`).

5. **Create Room Dorm Default Loading & Race Prevention**:
   - *Prior Gap*: Truthy checks in `rooms.tsx` prevented `defaultDeposit = 0` from resolving correctly. Potential race existed if modal opened before defaults loaded.
   - *R2.1a Correction*: Explicit nullish checks (`value !== null && value !== undefined`) implemented. Explicit 0 resolves to `TERM: 0, MONTHLY: 0, DAILY: 0`. `handleOpenModal` awaits `loadDormDefaults()`; if defaults fail to load, fails closed with a concise Thai message without guessing 4500.

6. **Fake Quick Add Legacy Code Elimination**:
   - *Prior Gap*: Unreachable fake local modal state and handler generating fake tenant and contract IDs remained in `rooms.tsx`.
   - *R2.1a Correction*: Completely purged dead fake handler and state variables. Canonical `QuickAddTenantModal` is the sole authority.


### 3.2. R2.1b — Agreement Deposit Display Authority

Independent review of R2.1a identified a defect in occupied Room deposit presentation in Grid and List modes:

1. **Defect Identified**:
   - Both Grid and List modes rendered occupied Room deposit from `room.depositAmount` (a legacy catalog alias).
   - In R2, `room.depositAmount` is only a legacy catalog compatibility alias and does not reflect the current tenant's agreement deposit.
   - Example: A Room with catalog `termDeposit = 9000`, `monthlyDeposit = 4500`, and `depositAmount = 4500` having an active TERM agreement with `depositAmount = 8000` incorrectly displayed `4500` instead of `8000`.

2. **R2.1b Product Authority & Single Helper**:
   - Created pure production helper `getCurrentAgreementDepositDisplay(room)` in `src/lib/roomRentalSummary.ts`.
   - **Occupied Room Authority**:
     - Current rent authority: `room.activeRentalSummary.rentAmount`
     - Current deposit authority: `room.activeRentalSummary.depositAmount`
   - **Room Catalog Cycle Deposits**: defaults for future agreements only.
   - **Explicit 0 Deposit**: preserved and displayed as `฿ 0.00`.
   - **Fail-Closed on Missing Agreement Deposit**: if an occupied room lacks `activeRentalSummary` or its `depositAmount` is null/undefined/non-finite, displays neutral text `ไม่พบข้อมูลค่าประกันปัจจุบัน` without guessing or falling back to Room catalog deposits.
   - **Grid & List Synchronization**: Both Grid and List views call `getCurrentAgreementDepositDisplay(room)`, eliminating duplicate JSX logic and legacy `formatBaht(room.depositAmount)` usage for occupied rooms.

## 4. Verification & Quality Gates

### Automated Impact Tests
1. `src/tests/owner-rooms-r2-cycle-deposits.test.tsx` (25 tests): **PASSED**
   - 3 cycle deposits and activeRentalSummary normalization.
   - Fail-closed transport validation on malformed numbers.
   - Error mapper exact Thai mappings and nested shapes.
   - Grid mode active-only vs vacant-all vs fail-closed neutral text.
   - List mode primary first + secondary catalog rates.
   - Cycle deposit resolver.
   - Schema defaulting: `CreateContractSchema.depositAmount` optional; `UpdateRoomSchema` rejects `null` cycle deposits.
   - Tenant registration approval defaulting strictly to `room.monthlyRent` / `room.monthlyDeposit` with 0 preserved and fail-closed validation.
   - Dormitory `defaultDeposit` seeding (7000 -> 7000/7000/7000, 0 -> 0/0/0) and absence of legacy `depositAmount` in create payload.
   - **R2.1b Agreement Deposit Display Authority**:
     - Occupied TERM agreement displays `8000` (not catalog 9000 or 4500).
     - Occupied DAILY agreement displays `500` (not catalog 1000).
     - Explicit agreement deposit `0` preserved and rendered.
     - Occupied room with missing/null summary deposit fails closed with neutral `ไม่พบข้อมูลค่าประกันปัจจุบัน` (no catalog fallback).
     - Vacant room indicates no current agreement deposit.

2. `server/src/__tests__/unit/owner-rooms-r21a-services.test.ts` (12 tests): **PASSED**
   - `ContractService.createContract` on non-Prisma repository.
   - `DailyStayService.ownerQuickAddDailyStay` defaulting.
   - `DefaultsService` and canonical Bangkok physical intervals.

3. `src/tests/owner-rooms-persistence-phase-ab.test.tsx` (8 tests): **PASSED**

**Total Test Count:** 45 passed, 0 failed.

### Static Code & Type Checking
- `npm run lint` (`tsc --noEmit`): **PASSED (0 errors)**
- `npm run lint:api` (`tsc --noEmit`): **PASSED (0 errors)**
- `docs/uat/local07-expected-results.json`: **Preserved untouched, uncommitted, and unstaged**.
