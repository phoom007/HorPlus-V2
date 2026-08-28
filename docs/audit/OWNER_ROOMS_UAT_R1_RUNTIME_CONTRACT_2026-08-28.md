# OWNER ROOMS — UAT-R1 / UAT-R1.1 RUNTIME API CONTRACT & FINANCIAL INTEGRITY AUDIT

**Date:** 2026-08-28
**Branch:** `fix/owner-rooms-uat-r11-integrity-20260828`
**Base Commit:** `5e1da35282711ed9eeddabe272bdd4b40ea4673e` (UAT-R1 Remote HEAD)
**Status:** READY FOR PRODUCT OWNER RE-UAT

---

## 1. Executive Summary & UAT Root Cause Reconciliation

Following Product Owner manual runtime UAT on `/owner/rooms`, three core areas were investigated, resolved, and verified:

### 1.1 Create Room Endpoint Status
* **Original UAT Create Failure Root Cause:**
  `ORIGINAL ROOT CAUSE UNPROVEN — NO LONGER REPRODUCIBLE ON CURRENT SOURCE`
* **Current Source Create Result:**
  `HTTP 201 PASS` (authoritative transport enrichment and schema validation active)
* **Transport Consistency Improvements:**
  Enriched both `POST /api/v1/properties/rooms` and `PUT /api/v1/properties/rooms/:id` responses using `DefaultsService.buildAuthoritativeRoomResponse` so that mutations return canonical authoritative DTOs containing `currentEffectiveValues`.

### 1.2 Price Presentation & Financial Data Integrity
* **Root Cause (NaN Prices):** Authoritative backend returns rates in nested `currentEffectiveValues: { monthlyRent, termRent, dailyRent, depositAmount, maximumOccupants }`. Un-normalized DTOs in React Query caused `room.monthlyRent` to evaluate to `undefined`, producing `NaN`.
* **R1.1 Strict Numeric Contract:**
  - `parseRequiredFiniteNumber(value, fieldName)` enforces strict numeric parsing for required fields (`monthlyRent`, `depositAmount`, `maximumOccupants`). Malformed or missing required financial data **fails closed** (throws `[ROOM_TRANSPORT_INVALID] Invalid <fieldName>`), preventing fake `0 ฿` display.
  - `parseOptionalFiniteNumber(value, fieldName)` enforces strict parsing for optional fields (`termRent`, `dailyRent`). Non-empty malformed values fail closed rather than silently becoming `undefined`.

### 1.3 Occupancy & Deposit Payment Status Integrity
* **Occupancy Consistency:** In `DefaultsService.buildAuthoritativeRoomResponse`, resolved `currentTenantId: room.currentTenantId || activeContract?.tenantId || null` and `currentContractId: room.currentContractId || activeContract?.id || null`. Occupied rooms with active contracts consistently display the tenant name and *"ข้อมูลผู้เช่า"* action button.
* **Deposit Payment Status Non-Fabrication:**
  - Deposit payment status is **NEVER** inferred from occupancy, `room.status`, or `currentTenantId`.
  - Authoritative `depositStatus = 'paid'` → `'paid'`
  - Authoritative `depositStatus = 'unpaid'` → `'unpaid'`
  - Absent or unverified `depositStatus` → `undefined`
* **UI Presentation for Unknown Deposit Status:**
  - `depositStatus === 'paid'` → renders *"จ่ายแล้ว"* badge
  - `depositStatus === 'unpaid'` → renders *"ยังไม่จ่าย"* badge
  - `depositStatus === undefined` → renders deposit amount with **NO** paid/unpaid badge.

---

## 2. Authoritative Transport DTO Mapping Matrix

| Backend Authoritative DTO Field | Canonical Frontend `Room` Field | Normalization Strategy | Failure Mode |
| :--- | :--- | :--- | :--- |
| `currentEffectiveValues.monthlyRent` | `monthlyRent` | `parseRequiredFiniteNumber(effective.monthlyRent, 'monthlyRent')` | Fails closed (`[ROOM_TRANSPORT_INVALID]`) |
| `currentEffectiveValues.depositAmount` | `depositAmount` | `parseRequiredFiniteNumber(effective.depositAmount, 'depositAmount')` | Fails closed (`[ROOM_TRANSPORT_INVALID]`) |
| `currentEffectiveValues.maximumOccupants` | `maxOccupants` | `parseRequiredFiniteNumber(effective.maximumOccupants, 'maximumOccupants')` | Fails closed (`[ROOM_TRANSPORT_INVALID]`) |
| `currentEffectiveValues.termRent` | `termRent` | `parseOptionalFiniteNumber(effective.termRent, 'termRent')` | Fails closed on invalid non-empty string |
| `currentEffectiveValues.dailyRent` | `dailyRent` | `parseOptionalFiniteNumber(effective.dailyRent, 'dailyRent')` | Fails closed on invalid non-empty string |
| `initialWaterReading` | `initialWaterMeter` | `parseMeterReading(dto.initialWaterReading, 'initialWaterReading', 0)` | `0` fallback if empty; fails closed on malformed |
| `initialElectricityReading` | `initialElectricMeter` | `parseMeterReading(dto.initialElectricityReading, 'initialElectricityReading', 0)` | `0` fallback if empty; fails closed on malformed |
| `depositStatus` | `depositStatus` | Explicit `'paid'` | `'unpaid'` | `undefined` | Never fabricated from occupancy |
| `currentTenantId` (resolved) | `currentTenantId` | `dto.currentTenantId || undefined` | `undefined` |
| `status` | `status` | Safe enum validation | `'vacant'` |
| `version` | `version` | `typeof dto.version === 'number' ? dto.version : 1` | `1` |

---

## 3. Query Boundary Architecture

```
Backend DB (PostgreSQL)
        │
        ▼
DefaultsService.buildAuthoritativeRoomResponse (Server Transport DTO)
        │
        ▼  GET /rooms, POST /rooms, PUT /rooms
Data Boundary: fetchAuthoritativeRooms / ApiPropertyAdapter
        │
        ▼  normalizeAuthoritativeRoom(s) [Strict Financial & Fail-Closed Parsers]
React Query Cache (queryKeys.rooms(dormId)) [Stores Canonical Room[]]
        │
        ▼
Owner Screens (Rooms, Dashboard, Tenants, Meters, Contracts, etc.)
```

---

## 4. Verification Suite Results

### Automated Impact Test Results

| Test Suite | File | Tests Run | Result | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **T1 — UAT-R1.1 Financial Integrity** | `src/tests/owner-rooms-api-contract-uat-r1.test.tsx` | 9 | **9 passed (100%)** | Strict required numbers, fail-closed validation, deposit presentation |
| **T2 — Phase AB.1 Persistence** | `src/tests/owner-rooms-persistence-phase-ab.test.tsx` | 8 | **8 passed (100%)** | Canonical Create/Update/Archive, OCC conflict handling |
| **Frontend TypeScript Lint** | `npm run lint` (`tsc --noEmit`) | - | **0 errors (Pass)** | Strict type correctness |

---

## 5. Next Steps

The UAT-R1.1 financial integrity hardening is complete, verified, and ready for Product Owner re-verification.
