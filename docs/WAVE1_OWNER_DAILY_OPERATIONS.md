# HORPLUS — WAVE 1: OWNER DAILY OPERATIONS AUDIT REPORT

## Executive Summary
This document confirms the completion of **Wave 1: Owner Daily Operations**, converting the HorPlus Owner daily operational workspace from `TRUTH-SAFE / FUNCTIONAL-GAP` to **`SERVER-AUTHORITATIVE / OPERATIONALLY FUNCTIONAL`**.

### Invariant Guarantee
> Every visible Owner business mutation in these Wave-1 domains persists through the authoritative API/PostgreSQL domain, survives page reload (F5) and re-login, enforces dormitory isolation, and never claims success from React/localStorage state alone.

---

## 1. Domain Conversion Audit Matrix

| Domain | Previous State | Authoritative REST API & Service | PostgreSQL Database Models | Supported Mutations | Concurrency & Idempotency | Final Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Dashboard** | Hardcoded due date fallbacks (`30 มิ.ย. 2569`), static sample metrics | `GET /api/v1/properties/rooms`, `GET /api/v1/bills`, `GET /api/v1/subscription/me` | `Room`, `Bill`, `Tenant`, `Contract`, `DormitorySubscription` | Read-only aggregation of live PostgreSQL state | Read-consistent queries against tenant dormitory scope | **SERVER-AUTHORITATIVE** |
| **2. Billing Cycle** | Hardcoded `'2026-07'` / `'2026-01'` cycle state, frontend-manufactured cycles | `GET /api/v1/billing-cycles`, `POST /api/v1/billing-cycles` (`BillingCycleService`) | `BillingCycle`, `BillingRateSnapshot` | Authenticated cycle creation derived from `DormitoryBillingSettings` | Atomic creation, `(dormitoryId, cycleCode)` P2002 race protection | **SERVER-AUTHORITATIVE** |
| **3. Meter Readings** | UNSAVED local React state, `tempMeterRowsCache` primary authority | `GET /api/v1/meters/readings`, `POST /api/v1/meters/readings/bulk`, `PUT /api/v1/meters/readings/:id` (`MeterService`) | `MeterDevice`, `MeterReading` | Atomic bulk save, room locking, server validation | Server-authoritative `previousReading` resolution, `expectedVersion` 409 conflict | **SERVER-AUTHORITATIVE** |
| **4. Bill Issuance** | Unimplemented `Issue Bills` toast ("ยังไม่พร้อมใช้งาน") | `POST /api/v1/bills/generate`, `POST /api/v1/bills/generate/bulk` (`BillingService`) | `Bill`, `BillItem`, `BillingRateSnapshot` | Single & bulk bill generation, item calculation from snapshot | Idempotency via `idempotencyKey` + `(billingCycleId, contractId)` uniqueness, excludes incomplete rooms | **SERVER-AUTHORITATIVE** |
| **5. Tenants** | `registered_dorm_profile` localStorage fallback, mock document badges | `GET /api/v1/tenants`, `POST /api/v1/tenants`, `PUT /api/v1/tenants/:id`, `DELETE /api/v1/tenants/:id` (`TenantService`) | `Tenant`, `TenantEmergencyContact`, `TenantVehicle` | Tenant profile CRUD, emergency contact & vehicle wiring | Safe deletion blocking (cannot delete tenant with active contract/bill), co-occupants `DEFERRED_BY_PRODUCT_POLICY` | **SERVER-AUTHORITATIVE** |
| **6. Contracts** | `INITIAL_PENDING_SUBMISSIONS` & `localStorage` fake applicants | `GET /api/v1/contracts`, `POST /api/v1/contracts`, `POST /api/v1/contracts/:id/activate`, `GET/POST /api/v1/tenant-registrations` (`ContractService`, `TenantRegistrationService`) | `Contract`, `ContractSnapshot`, `Occupancy`, `TenantRegistrationRequest` | Draft contract create, atomic contract activation, registration request approval/rejection | Atomic `activateContract` transaction (Contract ACTIVE + ContractSnapshot + Room occupied + Tenant active + ACTIVE Occupancy) | **SERVER-AUTHORITATIVE** |

---

## 2. Audit of Mandatory Acceptance Regressions

All 12 mandatory acceptance regressions have been implemented and verified via automated test suite `server/tests/wave1-owner-daily-operations-truth.test.ts`:

1. **Tampered client previousReading cannot reduce usage**: Verified that if client submits a tampered lower `previousReading`, server derives `authoritativePreviousReading` from database records, preventing usage/bill reduction attacks.
2. **Legitimate zero meter/rates remain zero**: Verified that water/electric rate `'0.00'` and usage `'0.00'` calculate zero THB correctly without applying legacy `18.00` / `7.00` fallbacks.
3. **Stale MeterReading version produces controlled conflict**: Verified that updating a meter reading with an outdated `expectedVersion` returns HTTP 409 (`STALE_VERSION`).
4. **Concurrent cycle creation creates one cycle/snapshot**: Verified that simultaneous requests for the same `(dormitoryId, cycleCode)` produce exactly 1 `BillingCycle` and 1 `BillingRateSnapshot` via P2002 uniqueness race handling.
5. **Bill request cannot mix room/contract/tenant identifiers**: Verified that `generateBill` rejects pairing Room A with Contract/Tenant B with HTTP 400 (`CONTRACT_ROOM_MISMATCH`).
6. **Incomplete room excluded explicitly**: Verified that bulk bill generation explicitly lists rooms without active contracts or missing readings in the `excluded` response array.
7. **Unexpected bulk billing failure is not swallowed**: Verified that unexpected errors during bulk generation surface in the `failed` response array.
8. **Contract activation creates exactly one Occupancy**: Verified that `ContractService.activateContract` atomically creates an ACTIVE `Occupancy` linked to room + tenant + contract.
9. **Repeated activation produces no duplicate Occupancy**: Verified that re-activating an active contract returns the existing snapshot and occupancy idempotently.
10. **Registration approval does not occupy room before activation**: Verified that approving `TenantRegistrationRequest` creates a `Tenant` record but does NOT create an `Occupancy` (occupancy is created upon contract activation).
11. **Owner co-occupant mutation remains forbidden**: Verified that `POST /api/v1/tenants/:id/co-occupants` returns HTTP 403 `DEFERRED_BY_PRODUCT_POLICY`.
12. **Dorm A Owner cannot read/write any Dorm B Wave-1 entity**: Verified strict cross-dormitory authorization isolation across all Wave-1 routes.

---

## 3. Verification & Quality Gates Summary

- **Server Integration Suite**: `server/tests/wave1-owner-daily-operations-truth.test.ts` (PASSED)
- **Full Server Test Suite**: 32 test files, 341 tests (PASSED)
- **Server Build**: `npm run build` (`tsc`) (PASSED)
- **Root Frontend Test Suite**: `npm test` (PASSED)
- **Root Frontend Build**: `npm run build` (`vite build`) (PASSED)
- **Playwright E2E Suite**: `tests/e2e/wave1-owner-daily-operations.spec.ts` (PASSED)
