# HORPLUS-V2 — OWNER ROOMS PHASE AB.1 CORRECTNESS HARDENING REPORT

**Document ID**: `DOC-OWNER-ROOMS-PHASE-AB1-20260828`  
**Date**: August 28, 2026  
**Repository**: `phoom007/HorPlus-V2`  
**Implementation Branch**: `fix/owner-rooms-phase-ab1-hardening-20260828`  
**Base Commit**: `104840d6819904dd696ce5365d4e2899263856e6` (`origin/fix/owner-rooms-persistence-phase-ab-20260828`)  
**Current `origin/main`**: `7609817303e1403b87ab790935941ee8f90f1258`  
**Scope**: Phase AB.1 Correctness Hardening & Full Regression Verification (Phases C–G strictly deferred)

---

## 1. Git Truth

| Parameter | Value / Commit SHA |
| :--- | :--- |
| **Top-Level Directory** | `D:/HorPlus-V2` |
| **Implementation Branch** | `fix/owner-rooms-phase-ab1-hardening-20260828` |
| **Base Phase A+B Commit** | `104840d6819904dd696ce5365d4e2899263856e6` |
| **Current origin/main** | `7609817303e1403b87ab790935941ee8f90f1258` |
| **Phase AB.1 Commit 1 (Backend Status)** | `ecab82a` (`fix(api): persist room status on creation`) |
| **Phase AB.1 Commit 2 (Deposit & Persistence)** | `97ca921` (`fix(owner-rooms): align deposit UI and harden canonical room persistence`) |
| **Phase AB.1 Commit 3 (Regression Coverage)** | `929a1b8` (`test(owner-rooms): strengthen persistence regression coverage`) |
| **Working Tree Invariant** | `docs/uat/local07-expected-results.json` preserved untouched. |

---

## 2. Review Findings Confirmed / Rejected

| # | Finding Description | Status | Evidence & Resolution |
| :--- | :--- | :--- | :--- |
| **1** | **Non-canonical deposit UI & false success**: Modal still rendered 3 deposit inputs (`monthlyDeposit`, `termDeposit`, `dailyDeposit`), while only `monthlyDeposit` was mapped to `depositAmount`, silently dropping edits to term/daily deposits. | **CONFIRMED & FIXED** | Removed all 3 redundant state variables and inputs. Replaced with single canonical `depositAmount` (`เงินประกันห้องพัก`) mapped directly to backend persistence. |
| **2** | **Create Room status accepted by schema but not persisted**: `CreateRoomSchema` accepts `status`, but `RoomService.createRoom()` omitted `status` in `tx.room.create()` data. | **CONFIRMED & FIXED** | Added `status: data.status || 'vacant'` in `RoomService.createRoom()` and proved via unit test `room-service-creation.test.ts`. |
| **3** | **Type-unsafe persistence paths**: Logic used `as any` and `Record<string, any>` for mutations. | **CONFIRMED & FIXED** | Defined and exported explicit `CreateRoomPayload` and `UpdateRoomChanges` interfaces in `src/data/contracts/index.ts`, eliminating unsafe casts. |
| **4** | **Legacy Room mutation fallback**: `/owner/rooms` fell back to legacy in-memory `dataProvider.rooms` when `properties` was absent. | **CONFIRMED & FIXED** | Made `dataProvider.properties` mandatory for Room operations; fails closed with an explicit Thai error toast if unavailable. |
| **5** | **Fabricated OCC version display**: Code used `expectedVersion + 1` when `currentVersion` was absent in error details. | **CONFIRMED & FIXED** | Removed guessed version math. Only displays `currentVersion` if verified by server; otherwise renders generic conflict guidance. Reload action resets editing state safely. |
| **6** | **Archive UI says permanent delete**: UI displayed `ลบห้องพักถาวร` despite backend performing soft-delete/archive. | **CONFIRMED & FIXED** | Replaced wording with canonical Thai archive terminology: `จัดเก็บห้องพัก` in modal footer, confirm dialogs, logs, and toasts. |
| **7** | **Tests did not prove end-to-end persistence**: Previous tests spied on `ApiPropertyAdapter` itself, missing real serialization and backend status bugs. | **CONFIRMED & FIXED** | Added backend unit test for `RoomService.createRoom` status persistence and real HTTP boundary tests for `ApiPropertyAdapter`. |

---

## 3. Canonical Deposit Correction

### Architecture: Before vs After

**Before (Ambiguous & False-Success Risk):**
```text
Form State: [monthlyDeposit, termDeposit, dailyDeposit]
     ↓ (User edits termDeposit)
isFormModified: true
     ↓ (User clicks Save)
Payload Mapping: depositAmount = monthlyDeposit (termDeposit dropped)
     ↓
Backend receives unchanged/stale depositAmount (Silent Data Loss)
```

**After (Single Authoritative Canonical Path):**
```text
UI: single canonical "เงินประกันห้องพัก (บาท)" input
     ↓ (User edits depositAmount)
Form State: depositAmount
     ↓
isFormModified: compares depositAmount !== editingRoom.depositAmount
     ↓
API Payload: { depositAmount: String(depositAmount) }
     ↓
CreateRoomSchema / UpdateRoomSchema: validates decimal string
     ↓
RoomService: tx.room.create / tx.room.update
     ↓
Prisma: Room.depositAmount Decimal(12, 2)
     ↓
PostgreSQL: rooms.deposit_amount
```

---

## 4. Create Status Persistence Fix

- **Route & Validation Layer**: `POST /api/v1/properties/rooms` validates incoming payload against `CreateRoomSchema` (`status: z.enum(['vacant', 'occupied', 'reserved', 'maintenance']).default('vacant')`).
- **Service Layer**: In `server/src/services/room.service.ts`:
  ```ts
  const created = await tx.room.create({
    data: {
      dormitoryId,
      buildingId: data.buildingId,
      roomNumber: data.roomNumber,
      normalizedRoomNumber,
      floor: data.floor || 1,
      roomType: data.roomType || 'standard',
      status: data.status || 'vacant', // <--- Persists validated status directly
      rentCycle: data.rentCycle || 'monthly',
      ...
    },
  });
  ```
- **Database Verification**: Persisted directly into `rooms.status: VARCHAR(50)`.

---

## 5. Type-Safety Hardening

Introduced canonical typed contracts in `src/data/contracts/index.ts`:

```ts
export interface CreateRoomPayload {
  buildingId: string;
  roomNumber: string;
  floor?: number;
  roomType?: string;
  status?: RoomStatus;
  rentCycle?: 'monthly' | 'term' | 'daily';
  monthlyRent?: string | number | null;
  termRent?: string | number | null;
  dailyRent?: string | number | null;
  depositAmount?: string | number | null;
  depositInheritsBuildingDefault?: boolean;
  parkingFee?: string | number | null;
  maximumOccupants?: number;
  waterMeterNumber?: string | null;
  electricityMeterNumber?: string | null;
  initialWaterReading?: string | number | null;
  initialElectricityReading?: string | number | null;
  amenities?: string[];
  images?: string[];
  notes?: string | null;
}

export interface UpdateRoomChanges {
  roomNumber?: string;
  buildingId?: string;
  floor?: number;
  roomType?: string;
  status?: RoomStatus;
  rentCycle?: 'monthly' | 'term' | 'daily';
  monthlyRent?: string | number | null;
  termRent?: string | number | null;
  dailyRent?: string | number | null;
  depositAmount?: string | number | null;
  depositInheritsBuildingDefault?: boolean;
  parkingFee?: string | number | null;
  maximumOccupants?: number;
  waterMeterNumber?: string | null;
  electricityMeterNumber?: string | null;
  initialWaterReading?: string | number | null;
  initialElectricityReading?: string | number | null;
  amenities?: string[];
  images?: string[];
  notes?: string | null;
}
```

All room mutations in `src/pages/owner/rooms.tsx` and `ApiPropertyAdapter` consume these types directly without any `as any` casts.

---

## 6. Fail-Closed Mutation Path

In `src/pages/owner/rooms.tsx`, every room mutation checks:
```ts
const dataProvider = getDataProvider();
const propertyApi = dataProvider.properties;

if (!propertyApi) {
  setErrorText('ระบบไม่สามารถเชื่อมต่อบริการจัดการห้องพักหลักได้ (PropertyDataSource unavailable)');
  setIsSubmitting(false);
  return;
}
```
If `PropertyDataSource` is unavailable, the UI fails closed immediately, shows an informative error, and refuses to fabricate success or mutate local arrays as durable truth.

---

## 7. OCC Hardening

1. **409 Conflict Interception**:
   When the backend returns HTTP 409 (`VERSION_CONFLICT`), the HTTP client maps this to domain code `CONFLICT` and attaches the server error payload in `res.error.details`.
2. **Zero Fabricated Versions**:
   The code extracts:
   ```ts
   const details = res.error.details as { currentVersion?: number; error?: { currentVersion?: number } } | undefined;
   const serverVersion = details?.currentVersion ?? details?.error?.currentVersion;
   ```
   If `serverVersion` is absent, it is passed as `undefined`, rendering the canonical Thai message without displaying a guessed version number (`expectedVersion + 1`).
3. **No Automatic Stale Retry**:
   Version conflict resolution requires clicking **"โหลดข้อมูลล่าสุด"** (`btn-reload-latest`), which closes the modal, dismisses stale form state, and invalidates React Query cache to re-sync with true server state.

---

## 8. Archive Terminology Alignment

Aligned UI terminology with backend soft-delete semantics (`RoomService.archiveRoom`):
- Modal delete button title & label: `จัดเก็บห้องพัก`
- Confirmation dialog title: `ยืนยันการจัดเก็บห้องพัก [เลขห้อง]`
- Confirmation action button: `จัดเก็บห้องพัก`
- Warning prompt: *"คุณแน่ใจหรือไม่ว่าต้องการจัดเก็บห้องพัก [เลขห้อง] ออกจากระบบ? (ห้องพักที่ถูกจัดเก็บจะไม่แสดงในรายการห้องว่าง)"*
- Audit log & toast: *"จัดเก็บห้องพัก [เลขห้อง] เรียบร้อยแล้ว"*

---

## 9. Test Execution & Coverage

### A. Static Type & Schema Checks
```bash
$ npm run lint
> tsc --noEmit
# Result: PASS (0 errors)

$ npm run lint:api
> npm --prefix server run lint
> tsc --noEmit
# Result: PASS (0 errors)

$ npm --prefix server run prisma:validate
> prisma validate
# Result: PASS (The schema at prisma\\schema.prisma is valid 🚀)
```

### B. Backend Room Service Unit Tests
```bash
$ npm --prefix server run test -- src/__tests__/unit/room-service-creation.test.ts
 ✓ src/__tests__/unit/room-service-creation.test.ts (3 tests) 26ms
   ✓ validates status in CreateRoomSchema with maintenance support and default vacant
   ✓ persists status="maintenance" when creating a room with maintenance status
   ✓ persists status="vacant" by default when status is omitted
```

### C. Focused Frontend Hardening & HTTP Boundary Suite
```bash
$ npx vitest run src/tests/owner-rooms-persistence-phase-ab.test.tsx --environment happy-dom
 ✓ src/tests/owner-rooms-persistence-phase-ab.test.tsx (8 tests) 3590ms
   ✓ 1. CREATE ROOM Persistence & Canonical Deposit > calls ApiPropertyAdapter.createRoom with single canonical depositAmount and status
   ✓ 2. UPDATE ROOM Persistence & ExpectedVersion > calls ApiPropertyAdapter.updateRoom with expectedVersion and editable canonical deposit
   ✓ 3. OCC / Version Conflict UX & No Fabricated Version > surfaces VersionConflictModal without fabricated version on 409 conflict and reloads on reload action
   ✓ 4. ARCHIVE ROOM Persistence & Terminology > uses archive terminology (จัดเก็บห้องพัก) and calls ApiPropertyAdapter.archiveRoom with expectedVersion
   ✓ 5. Fail-Closed Resilience when PropertyDataSource is Unavailable > fails closed and surfaces error without fake save when properties API is unavailable
   ✓ 6. Real ApiPropertyAdapter HTTP Boundary Tests > formats createRoom request payload correctly for POST /properties/rooms
   ✓ 6. Real ApiPropertyAdapter HTTP Boundary Tests > formats updateRoom request payload correctly for PUT /properties/rooms/:id with expectedVersion
   ✓ 6. Real ApiPropertyAdapter HTTP Boundary Tests > formats archiveRoom request payload correctly for DELETE /properties/rooms/:id with expectedVersion
```

---

## 10. Full Regression Results

### Full Backend Test Suite (`npm run test:api`)
- **Command**: `npm run test:api`
- **Result**: **PASS**
- **Passed Files**: **62 passed (62 files)**
- **Passed Tests**: **921 passed (921 tests)**
- **Failed Tests**: **0**
- **Skipped Tests**: **0**

### Full Frontend Test Suite (`npm run test`)
- **Command**: `npm run test`
- **Result**: 30 files passed (32 total), 477 tests passed, 3 failed, 1 skipped.
- **Analysis of Failed Tests (Pre-existing & Out of Scope)**:
  1. `src/tests/wave1g-owner-ui.test.tsx` (2 failures): Prototype tests asserting deprecated elements (`[data-testid="badge-room"]` and `[data-testid="btn-edit-building"]`). Pre-existing from Phase 1G prototype; scheduled for Phase G modernization.
  2. `src/tests/local07-quick-add-table-list-parity.test.tsx` (1 failure): Q2-Q14 happy-dom async timer timeout (5000ms). Pre-existing; specifically marked as out-of-scope for Phase AB.1.

---

## 11. Remaining Out-of-Scope Work (Phases C–G)

- **Phase C**: Cross-menu invalidations (`bills`, `contracts`, `dashboard` metrics).
- **Phase D**: Connecting Quick Add Tenant modal to real contract creation API (`POST /contracts`).
- **Phase E**: Implementing dynamic contract deposit formula policies (`monthlyRent * 2`).
- **Phase F**: Adding room archive provisional & daily stay guards.
- **Phase G**: Modernizing legacy prototype tests (`wave1g-owner-ui.test.tsx`, etc.) to the new 3-view room layout.

---

## 12. Manual UAT Checklist for Product Owner

### A. Create Room Persistence
1. Navigate to `/owner/rooms`.
2. Click **"+ เพิ่มห้องพัก"**.
3. Fill in Room Number: `901`, Monthly Rent: `5000`, Deposit Amount: `10000`.
4. Click **"บันทึกข้อมูล"**.
5. Press **F5** (hard reload).
6. **Expected**: Room `901` appears with 5,000 rent and 10,000 deposit.

### B. Create Maintenance Room
1. Click **"+ เพิ่มห้องพัก"**.
2. Enter Room Number: `902`.
3. Under สถานะห้องพัก, select **"ปิดปรับปรุง"** (red button).
4. Click **"บันทึกข้อมูล"**.
5. Press **F5** (hard reload).
6. **Expected**: Room `902` persists with "ปิดปรับปรุง" (maintenance) status.

### C. Single Canonical Deposit Editing
1. Open Edit modal for any vacant room.
2. Observe single input **"เงินประกันห้องพัก (บาท)"**.
3. Change deposit to `12500`.
4. Click **"บันทึกการแก้ไข"**.
5. Press **F5**.
6. **Expected**: Deposit amount `12,500` persists accurately in PostgreSQL.

### D. Archive Room & Terminology
1. Open Edit modal for a vacant room without tenant.
2. Observe modal footer button: **"จัดเก็บห้องพัก"** (red trash icon).
3. Click **"จัดเก็บห้องพัก"**.
4. Confirm dialog opens with title: *"ยืนยันการจัดเก็บห้องพัก..."* and confirm button: *"จัดเก็บห้องพัก"*.
5. Click **"จัดเก็บห้องพัก"**.
6. **Expected**: Room is archived, removed from active lists, and audit log records *"จัดเก็บห้องพัก"*.

### E. Optimistic Concurrency Control (OCC)
1. Open the same room in **Tab A** and **Tab B**.
2. In **Tab A**, change rent to `5200` and click Save.
3. In **Tab B**, without refreshing, change rent to `5800` and click Save.
4. **Expected**: **Tab B** surfaces `VersionConflictModal` with Thai prompt *"ตรวจพบการแก้ไขข้อมูลซ้ำซ้อน"*. Tab B does not overwrite Tab A.
5. In **Tab B**, click **"โหลดข้อมูลล่าสุด"**.
6. **Expected**: Modal closes, latest server data (`5200`) is loaded.
