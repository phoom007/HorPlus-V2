# OWNER ROOMS — UAT-R1 RUNTIME API CONTRACT RECONCILIATION & ROOT CAUSE ANALYSIS

**Date:** 2026-08-28  
**Branch:** `fix/owner-rooms-uat-r1-runtime-contract-20260828`  
**Base Commit:** `a23e0492b29211458c767e9926cffaa302145e21` (Phase C.1 Remote HEAD)  
**Status:** READY FOR PRODUCT OWNER RE-UAT  

---

## 1. Executive Summary & Root Cause Analysis

Following the Phase C.1 release, Product Owner manual runtime UAT on `/owner/rooms` identified three major symptoms:
1. **Failure 1 — Create Room:** Attempting to create room `A111` surfaced the fallback message: *"ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง"* and room was not created.
2. **Failure 2 — NaN Prices:** Room cards on grid/floor view displayed *"฿ NaN / เดือน"*.
3. **Failure 3 — Occupancy Presentation Contradiction:** Several cards showed badge *"มีผู้เช่า"*, but the tenant block inside showed *"ไม่มีผู้เช่าลงทะเบียน"* and the action button remained *"เพิ่มผู้เช่า"*.

### Detailed Root Cause Breakdown

### Failure 2: Price Calculation & NaN Presentation
- **Root Cause:** The backend `GET /api/v1/properties/rooms` endpoint returns authoritative Room DTOs computed by `DefaultsService.buildAuthoritativeRoomResponse`. In this transport shape, effective room rates reside under nested object `currentEffectiveValues: { monthlyRent, termRent, dailyRent, depositAmount, maximumOccupants, ... }` rather than root-level properties.
- **Frontend Symptom:** The React Query cache stored the raw backend DTO without normalization. Frontend components reading `room.monthlyRent` received `undefined`, causing `formatBaht(undefined)` to format `NaN` as *"฿ NaN / เดือน"*.
- **Fix:** Introduced a canonical normalizer (`normalizeAuthoritativeRoom` and `normalizeAuthoritativeRooms`) at the data layer (`src/lib/roomNormalizer.ts` and `ApiPropertyAdapter` / `src/pages/owner.tsx` query boundary). All rates are parsed using `parseSafeNumeric` to guarantee `Number.isNaN` is never true.

### Failure 3: Occupancy Relationship Contradiction
- **Root Cause:** In `DefaultsService.buildAuthoritativeRoomResponse` (`server/src/services/defaults.service.ts`), `currentTenantId` was mapped directly from `room.currentTenantId` without falling back to `activeContract?.tenantId`. In PostgreSQL, rooms with an active contract might not have `current_tenant_id` back-filled on the `rooms` row. As a result, the backend returned `currentTenantId: null`.
- **Frontend Symptom:** Status badge inspected `room.status` (`'occupied'`), while tenant name and action button inspected `room.currentTenantId`. Because `room.currentTenantId` was `null`, the UI displayed badge *"มีผู้เช่า"* but rendered *"ไม่มีผู้เช่าลงทะเบียน"* and *"เพิ่มผู้เช่า"*.
- **Fix:** In `defaults.service.ts`, updated response building to resolve `currentTenantId: room.currentTenantId || activeContract?.tenantId || null` and `currentContractId: room.currentContractId || activeContract?.id || null`. The canonical normalizer projects this into `room.currentTenantId`, so card badge, tenant name, and button are 100% consistent.

### Failure 1: Create Room Endpoint Contract & Fallback Error
- **Root Cause:** 
  1. `POST /api/v1/properties/rooms` and `PUT /api/v1/properties/rooms/:id` previously returned raw un-enriched database records rather than authoritative room DTOs with `currentEffectiveValues`.
  2. If the frontend attempted to create a room before buildings data loaded, an empty `buildingId: ''` would be submitted, causing validation rejection or internal error.
- **Fix:** 
  1. Enriched `POST /rooms` and `PUT /rooms/:id` route handlers using `defaultsService.buildAuthoritativeRoomResponse(dormId, room)` to enforce consistent authoritative transport contracts.
  2. Added pre-submission validation in `OwnerRooms` (`src/pages/owner/rooms.tsx`) to verify building presence before dispatching network requests.
  3. Integrated `normalizeAuthoritativeRoom` into `ApiPropertyAdapter.createRoom` and `ApiPropertyAdapter.updateRoom`.

---

## 2. Authoritative Transport DTO Mapping Matrix

| Backend Authoritative DTO Field | Canonical Frontend `Room` Field | Normalization Strategy | Fallback |
| :--- | :--- | :--- | :--- |
| `currentEffectiveValues.monthlyRent` | `monthlyRent` | `parseSafeNumeric(effective.monthlyRent, 0)` | `dto.monthlyRent ?? 0` |
| `currentEffectiveValues.termRent` | `termRent` | `parseOptionalSafeNumeric(effective.termRent)` | `dto.termRent` |
| `currentEffectiveValues.dailyRent` | `dailyRent` | `parseOptionalSafeNumeric(effective.dailyRent)` | `dto.dailyRent` |
| `currentEffectiveValues.depositAmount` | `depositAmount` | `parseSafeNumeric(effective.depositAmount, 0)` | `dto.depositAmount ?? 0` |
| `currentEffectiveValues.maximumOccupants` | `maxOccupants` | `parseSafeNumeric(effective.maximumOccupants, 2)` | `dto.maxOccupants ?? 2` |
| `initialWaterReading` | `initialWaterMeter` | `parseSafeNumeric(dto.initialWaterReading, 0)` | `dto.initialWaterMeter ?? 0` |
| `initialElectricityReading` | `initialElectricMeter` | `parseSafeNumeric(dto.initialElectricityReading, 0)` | `dto.initialElectricMeter ?? 0` |
| `currentTenantId` (resolved) | `currentTenantId` | `dto.currentTenantId || undefined` | `undefined` |
| `currentContractId` (resolved) | `currentContractId` | `dto.currentContractId || undefined` | `undefined` |
| `status` | `status` | Safe enum validation | `'vacant'` |
| `version` | `version` | `typeof dto.version === 'number' ? dto.version : 1` | `1` |

---

## 3. Query Boundary Architecture

Rather than teaching every Owner screen how to navigate nested backend objects, all queries and mutations flow through a single projection pipeline:

```
Backend DB (PostgreSQL)
        │
        ▼
DefaultsService.buildAuthoritativeRoomResponse (Server Transport DTO)
        │
        ▼  GET /rooms, POST /rooms, PUT /rooms
Data Boundary: fetchAuthoritativeRooms / ApiPropertyAdapter
        │
        ▼  normalizeAuthoritativeRoom(s)
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
| **T1 — UAT-R1 API Contract** | `src/tests/owner-rooms-api-contract-uat-r1.test.tsx` | 8 | **8 passed (100%)** | NaN safety, DTO normalization, Occupancy presentation |
| **T2 — Phase AB.1 Persistence** | `src/tests/owner-rooms-persistence-phase-ab.test.tsx` | 8 | **8 passed (100%)** | Canonical Create/Update/Archive, OCC conflict handling |
| **T2 — Phase C.1 Cache Coherence** | `src/tests/owner-rooms-cache-coherence-phase-c.test.tsx` | 11 | **11 passed (100%)** | Precise dependency invalidation matrix |
| **T2 — Backend Creation Unit** | `server/src/__tests__/unit/room-service-creation.test.ts` | 3 | **3 passed (100%)** | Room creation, duplicate validation, limits |
| **Frontend TypeScript Lint** | `npm run lint` (`tsc --noEmit`) | - | **0 errors (Pass)** | Strict type correctness |
| **Backend TypeScript Lint** | `npm run lint:api` (`tsc --noEmit`) | - | **0 errors (Pass)** | Strict type correctness |

---

## 5. Next Steps

The UAT-R1 runtime reconciliation is complete, verified, and ready for Product Owner re-verification.
