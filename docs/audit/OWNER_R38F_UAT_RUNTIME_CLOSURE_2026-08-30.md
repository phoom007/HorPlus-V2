# OWNER R3.8f — Manual-UAT Runtime Closure: Term Money Integrity, Room 302 Group Approval Forensics, Receipt Print & Local-07 Diagnostics

**Date**: 2026-08-30
**Branch**: `fix/owner-r38fr3-local07-cors-runtime-authority-20260830`
**Base Commit**: `3e4052dce8aaf567de47443ae8f8aa17b0955fff`
**Parent Commit**: `41d2d557426820933ecf902520027821c2f7082d`
**Status**: PASSED / READY FOR PRODUCT OWNER MANUAL UAT

---

## 1. Executive Summary

During manual UAT execution on the approved R3.8e source snapshot, the Product Owner identified 4 runtime defects:
1. **Quick Add TERM Money Type Error**: Typing Rent `20,000` + Deposit `4,000` over `2` installments caused string concatenation resulting in total agreed `฿200,004,000.00`.
2. **Room 302 Combined Slip Approval Failure**: Clicking "อนุมัติ" on the Room 302 ฿6,500 test slip returned `เกิดข้อผิดพลาดในการอนุมัติสลิป: ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง`.
3. **Receipt Print Preview Degradation**: Printing receipt modals lost table text, broke pagination across 2 pages, and suffered from modal CSS clipping.
4. **Local Docker Infra Port Collision**: `npm run uat:infra:up` reported `Bind for 0.0.0.0:5455 failed: port is already allocated`.

All 4 defects have undergone complete forensic root-cause analysis, surgical code corrections, and validation across automated frontend and backend suites. Room 302 remains in a clean, approvable `UNDER_REVIEW` state awaiting manual Product Owner action.

---

## 2. Forensic Root-Cause Analysis & Technical Corrections

### Defect 1: Quick Add TERM Arithmetic String Concatenation

#### Root Cause
In `src/components/QuickAddTenantModal.tsx`, input change handlers captured string values directly from HTML `<input>` elements (e.g. `totalRent = "20000"`, `depAmount = "4000"`). The binary `+` operator performed JavaScript string concatenation (`"20000" + "4000"` -> `"200004000"`), which formatted as `฿200,004,000.00`.

#### Surgical Correction
1. Introduced a canonical helper `normalizeMoneyInput(value: string | number): number` at the calculation boundary.
2. Normalized all inputs (`rent`, `deposit`, `advance`, `installments`) across `TERM`, `MONTHLY`, and `DAILY` modalities before any arithmetic operations.
3. Updated live breakdown calculation formulas and contract/bill creation payload builders.
4. Verified that:
   - **Case 1**: Rent `20,000`, 2 installments, Deposit `4,000` (Pay now) -> Total agreed: `฿24,000.00`, Total Rent: `฿20,000.00`, Deposit: `฿4,000.00`, 1st Installment Due: `฿14,000.00` (`฿10,000` rent + `฿4,000` deposit).
   - **Case 2**: Rent `20,000`, 2 installments, Deposit `4,000` (Pay later) -> Total agreed: `฿24,000.00`, Total Rent: `฿20,000.00`, Deposit: `฿4,000.00`, 1st Installment Due: `฿10,000.00`.
   - **Monthly & Daily Regressions**: Preserved accurate calculations with zero string concatenation.

---

### Defect 2: Room 302 Group Slip Approval Mismatch & Domain Visibility

#### Forensic Root Cause
The backend function `approvePaymentGroup` in `server/src/services/payment.service.ts` recomputes the canonical FIFO allocation plan using `computeCanonicalAllocationPlan(...)`.

In the seed fixture:
- Target Bill 1 (July, `INV-202607-009`) was seeded with `totalAmount = 6100.00`, `paidAmount = 0.00`, `outstandingAmount = 6100.00`.
- Target Bill 2 (August, `INV-202608-302-R`) was seeded with `totalAmount = 5000.00`, `paidAmount = 0.00`, `outstandingAmount = 5000.00`.
- Combined Payment Group Total = `฿6,500.00`.

When computing canonical FIFO allocation for ฿6,500:
- July bill needed ฿6,100 -> Allocated `฿6,100.00`.
- Remaining `฿400.00` allocated to August bill.

However, the seed script hardcoded child payment records as:
- Payment 1 (July) = `฿4,000.00` (intended as partial payment).
- Payment 2 (August) = `฿2,500.00` (intended as partial payment).

When `approvePaymentGroup` checked `allocatedAmount !== payment.amount`, it found a reconciliation mismatch (`6100 != 4000` and `400 != 2500`) and threw `GROUP_ALLOCATION_RECONCILIATION_FAILED`.
The frontend previously did not map `GROUP_ALLOCATION_RECONCILIATION_FAILED` to user-friendly Thai, defaulting to generic `"ระบบไม่สามารถดำเนินการได้"`.

#### Surgical Correction
1. **Domain Error Visibility**:
   - `server/src/routes/payment.routes.ts`: Mapped `GROUP_ALLOCATION_RECONCILIATION_FAILED` to `'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ'`.
   - `src/data/contracts/index.ts` & `src/data/httpClient.ts`: Added `GROUP_ALLOCATION_RECONCILIATION_FAILED` and `GROUP_REJECTION_REQUIRED` to contract enum and default Thai translation maps.
2. **Deterministic Approvable Seed Fixture**:
   - In `scripts/local07/seed.mjs`, seeded July bill (`INV-202607-009`) with prior partial payment `paidAmount: 2100.00`, `outstandingAmount: 4000.00`, `status: 'partial'`.
   - Canonical FIFO allocation of ฿6,500 now computes:
     - Bill 1 (July, outstanding ฿4,000): Allocated `฿4,000.00` -> Closes July bill (`PAID`, `outstanding = 0.00`, `paidAt` recorded).
     - Bill 2 (August, outstanding ฿5,000): Allocated `฿2,500.00` -> Partially pays August bill (`PARTIALLY_PAID`, `outstanding = ฿2,500.00`).
     - Reconciliation mismatch: **0.00** (Exact match with child payments ฿4,000 / ฿2,500).
   - Generates exactly **ONE Combined Receipt** for `฿6,500.00`.
   - The test slip remains safely in `UNDER_REVIEW` state without approving on behalf of the Product Owner.

---

### Defect 3: Receipt Print Surface & Modal CSS Clipping

#### Root Cause
In `src/components/GlobalComponents.tsx`, the `PrintView` component rendered the printable content inside its existing React DOM location inside the modal hierarchy. The parent Tailwind modal containers had `overflow-hidden`, `max-h-[90vh]`, and `transform` CSS rules. When the browser triggered `@media print`, the print engine clipped content to the modal's bounded viewport height, causing:
1. Missing table rows and payment details.
2. Unnecessary page breaks across 2 pages.
3. Faded / low-contrast borders when "Background Graphics" was disabled in Chrome print dialog.

#### Surgical Correction
1. **DOM Extraction via Top-Level Print Container**:
   - Refactored `PrintView` to create a dedicated `#horplus-print-root` container directly under `document.body`.
   - During `window.print()`, `PrintView` clones the print component into `#horplus-print-root` and applies global `@page { size: A4 portrait; margin: 12mm 15mm; }` styling, while setting `display: none` for `#root` and all modal ancestors.
   - After the print dialog closes, the cloned root is automatically dismantled and cleaned up.
2. **High-Contrast Print Typography & Table Borders**:
   - In `src/pages/owner/payments.tsx`, updated receipt modal styles to use solid `#0f172a` (Slate 900) text, explicit `border: 1.5px solid #334155` borders, and high-contrast bold totals to guarantee crisp 1-page A4 printing even with background graphics disabled.
3. **Snapshot Immutability**:
   - Receipt printing renders strictly from immutable `Receipt.snapshotData` (`items`, `total`, `receiptNumber`, `roomNumber`, `tenantName`), preserving historical integrity.

---

### Defect 4: Local Port 5455 Infra Diagnostic & Ownership Analysis

#### Forensic Diagnostic Evidence
1. **Command**: `Get-NetTCPConnection -LocalPort 5455` and `docker ps`
2. **Findings**:
   - Port 5455 was actively bound and owned by Docker container `horplus_postgres` (Container ID `96a16dd731ec`, Image `postgres:16-alpine`), mapping `0.0.0.0:5455->5432/tcp`.
   - Container `horplus-v2-db-1` was in `Created` state because `docker-compose` attempted to bind port 5455 when `horplus_postgres` was already running.
   - TCP probe `Test-NetConnection localhost -Port 5455` verified `TcpTestSucceeded : True`.
3. **Actual Database Target Verification**:
   - `server/.env` and `scripts/local07/refresh.mjs` both target `DATABASE_URL=postgresql://horplus:horplus_test_password@127.0.0.1:5455/horplus_wave1d_fasttrack_test`.
   - `horplus_postgres` is the single authoritative container hosting the UAT database.
4. **Infra Recommendation**:
   - Running `npm run uat:infra:up` is only necessary if no container is running.
   - If `horplus_postgres` is already active, `npm run uat:refresh` connects directly and executes clean reset and deterministic seeding.

---

## 3. Automated Verification Matrix

### Automated Test Results

| Test File | Scope | Tests | Result |
| :--- | :--- | :---: | :---: |
| `src/tests/owner-r38f-quickadd-and-print.test.tsx` | Quick Add TERM Case 1/2, Monthly/Daily Regressions, PrintView DOM Cloning | 5 | **PASSED** |
| `src/tests/owner-payments-r38e-receipt.test.tsx` | Receipt Snapshot Authority, Paid Tab Filtering, Modal Rendering | 2 | **PASSED** |
| `server/src/__tests__/integration/owner-r38f-group-approval-forensics.test.ts` | 400 Allocation Mismatch Thai Error + Clean Combined Group Approval | 2 | **PASSED** |
| `server/src/__tests__/integration/owner-r38e-synthetic-storage-and-http.test.ts` | Group Reject, Intent Creation, Idempotent Approval Replay | 4 | **PASSED** |
| `server/src/__tests__/integration/owner-r38e-postgresql-locked-and-paidat.test.ts` | Locked-State Late Fee Validation & Canonical paidAt Authority | 10 | **PASSED** |
| `scripts/local07/refresh.mjs` (`npm run uat:refresh`) | Deterministic UAT Reset, Seeding & Full 13-Point Oracle Verification | 60+ assertions | **PASSED (0 FAILURES)** |

---

## 4. Room 302 State Verification for Product Owner

Following `npm run uat:refresh`:

```
Room 302:
  - July Bill: INV-202607-009 (2026-07) -> status: partial, total: 6100.00, paid: 2100.00, outstanding: 4000.00
  - August Bill: INV-202608-302-R (2026-08) -> status: unpaid, total: 5000.00, paid: 0.00, outstanding: 5000.00
  - Combined Group: status: UNDER_REVIEW, totalAmount: 6500.00
    - Child Payment 1 (July): status: UNDER_REVIEW, amount: 4000.00
    - Child Payment 2 (August): status: UNDER_REVIEW, amount: 2500.00
    - Synthetic Slip: Attached and viewable in modal
```

**Non-Interference Guarantee**:
Antigravity has **NOT** approved or rejected the test slip. The Product Owner can now open the Owner Payments page (`http://localhost:5173/owner/dashboard` or `/owner/payments`), review the Room 302 slip in "รอตรวจสอบ", and manually click **"อนุมัติ"** or **"ปฏิเสธ"**.

---

---

## 5. Git Snapshot Summary

- **Branch**: `fix/owner-r38fr1-financial-fixture-source-cleanup-20260830`
- **Parent Commit**: `189ddd61416e97c808811f67bc9137669136b609`
- **R3.8f Base**: `3e4052dce8aaf567de47443ae8f8aa17b0955fff`
- **origin/main**: Preserved untouched at `7609817303e1403b87ab790935941ee8f90f1258`

---

## 6. R3.8fR1 — Independent Source-Gate Correction & Canonical Financial Fixture

### 6.1 Independent Source Gate Blocker & Root Cause
During independent source review, a P0 fixture integrity blocker was identified:
- In `scripts/local07/seed.mjs`, Room 302 July bill (`INV-202607-009`) had its `paidAmount` directly set to `2,100.00` (leaving `4,000.00` outstanding) without creating canonical financial event records (Payment, PaymentAllocation, Receipt, CombinedPaymentGroup).
- This shortcut caused the modern Room 302 fixture to rely on `legacyUnallocatedPaidAmount`, which violated financial integrity since Room 302 is not a legacy ambiguous fixture.
- Furthermore, integration test CASE 2 replicated this shortcut by creating a bill with `paidAmount: 2100` and zero backing payment evidence.

### 6.2 Canonical Prior Payment Fixture Correction
1. **Full Canonical Monetary Graph Constructed**:
   - `CombinedPaymentGroup`: Total `฿2,100.00`, method `CASH`, status `APPROVED`, date `2026-08-10`.
   - `CombinedPaymentGroupBillTarget`: Target order 1 linked to July Bill.
   - `Payment`: Amount `฿2,100.00`, status `APPROVED`, method `CASH`.
   - `PaymentStatusHistory`: `toStatus = 'APPROVED'`.
   - `PaymentAllocation`: Exactly `฿2,100.00` allocated against July rent item.
   - `BillStatusHistory`: `fromStatus = 'unpaid'`, `toStatus = 'partial'`.
   - `Receipt`: Exactly 1 immutable receipt (`RCP-202607-302-P1`) with snapshot total `฿2,100.00`.
   - `Bill`: `paidAmount = 2100.00`, `outstandingAmount = 4000.00`, `status = 'partial'`.

2. **Invariants Proven**:
   - `SUM(approved allocations against July Bill) = 2,100.00 = Bill.paidAmount`.
   - `Bill.totalAmount - Bill.paidAmount = 6,100.00 - 2,100.00 = 4,000.00 = Bill.outstandingAmount`.
   - `legacyUnallocatedPaidAmount = Bill.paidAmount - allocationsSum = 0.00` (Strict non-legacy proof).

3. **Pending Slip & Post-Approval Verification**:
   - Pending Combined Group (`฿6,500.00`, `UNDER_REVIEW`) with child payments July `฿4,000.00` and August `฿2,500.00`.
   - Canonical FIFO allocation of ฿6,500 produces July `฿4,000.00` (closes bill to `PAID`, `outstanding = 0`, `paidAt` recorded) and August `฿2,500.00` (`PARTIALLY_PAID`, `outstanding = 2,500.00`).
   - Post-approval creates exactly **1 NEW Combined Receipt** (`฿6,500.00`).
   - Total monetary evidence across both events = `฿2,100.00 + ฿6,500.00 = ฿8,600.00` with **0 orphan/phantom paidAmount**.

### 6.3 Receipt Count Reconciliations
- July 2026 cycle bills receipt count updated from 8 to **9** (7 regular paid bills + 1 deposit bill + 1 Room 302 prior partial payment receipt).

### 6.4 Single Shared Money Normalizer
- Removed local duplicate `normalizeMoneyInput` in `src/components/QuickAddTenantModal.tsx`.
- Widened shared `normalizeMoneyInput` in `src/components/GlobalComponents.tsx` to handle `null | undefined | string | number`, ensuring single authority.

### 6.5 True DAILY 2-Day Test
- Updated `src/tests/owner-r38f-quickadd-and-print.test.tsx` to set checkout date to tomorrow, verifying actual 2-day calculation: `฿800 x 2 days (฿1,600) + ฿1,000 deposit = ฿2,600.00`.

### 6.6 Diff Hygiene & Timestamp Churn Removal
- Preserved stable `generatedAt` in `scripts/local07/generate-oracle.mjs` to eliminate timestamp churn on `docs/uat/local07-expected-results.json`.
- Restored repository-native LF line endings to `src/components/GlobalComponents.tsx` and `server/src/tests/local07-line-tenant-onboarding-a2.test.ts`, eliminating whole-file diffs.

### 6.7 PrintView Status
- Top-level print root DOM-cloning verified via unit tests.
- Physical Chrome one-page layout status: **SOURCE PRINT FIX READY FOR MANUAL CHROME PRINT UAT**.

---

## 7. R3.8fR2 — Canonical Cash-Actor Status + LOCAL07 Oracle Truth Closure

### 7.1 Canonical Bill Status Correction
- **Issue**: R3.8fR1 used `'partial'` for `Bill.status` and `BillStatusHistory.toStatus`, which deviated from production canonical settlement authority (`PARTIALLY_PAID`).
- **Correction**: Updated `scripts/local07/seed.mjs` to transition Room 302 July bill (`INV-202607-009`) to `status = 'PARTIALLY_PAID'` and `BillStatusHistory.toStatus = 'PARTIALLY_PAID'`, matching production allocation and test semantics.
- **Verification**: Updated `scripts/local07/verify.mjs` with `normalizeBillStatus` helper (`PAID`, `PARTIALLY_PAID`, `UNPAID`) and strict assertion `bill302July.status === 'PARTIALLY_PAID'`.

### 7.2 Cash Audit Actor Authority
- **Actor Invariant**: Historical Cash payments must reflect authenticated logged-in actor relationships.
- **Seeded Actor ID**: `COMP_DORM.owner.id` (`20000002-0000-4000-8000-000000000002`)
- **Seeded Actor Name**: `COMP_DORM.owner.name` (`'เจ้าของทดสอบ Comprehensive Owner'`)
- **Relationships Established & Verified**:
  - `CombinedPaymentGroup.recordedByUserId = COMP_DORM.owner.id`
  - `Payment.reviewedByUserId = COMP_DORM.owner.id`
  - `Payment.reviewedAt = 2026-08-10T10:00:00.000Z`
  - `PaymentStatusHistory.changedByUserId = COMP_DORM.owner.id`
  - `BillStatusHistory.changedByUserId = COMP_DORM.owner.id`
  - `Receipt.issuedByUserId = COMP_DORM.owner.id`
  - `Receipt.snapshotData.receiverName = COMP_DORM.owner.name`
- **Backend Integration Test**: Updated CASE 2 in `server/src/__tests__/integration/owner-r38f-group-approval-forensics.test.ts` to assert all 7 actor identity fields explicitly.

### 7.3 LOCAL07 Committed Oracle Truth Closure
- **Root Problem**: `docs/uat/local07-expected-results.json` and `scripts/local07/generate-oracle.mjs` previously described Room 302 as `UNPAID` with null receipt, missing the canonical prior ฿2,100 Cash payment.
- **Semantic Oracle Updates in `generate-oracle.mjs`**:
  - **Room 302 Entry**: `status = 'PARTIALLY_PAID'`, `paidAmount = 2100`, `outstandingAmount = 4000`, `receipt = 'RCP-202607-302-P1'`.
  - **Bill Counts**: `totalBills = 11`, `paidBillsCount = 7`, `partialBillsCount = 1`, `unpaidBillsCount = 3` (7 + 1 + 3 = 11).
  - **Financial Totals**:
    - `totalBilledAmount = 65899.0`
    - `totalPaidRevenue = 44094.0` (`41994.0 + 2100.0`)
    - `totalOutstandingUnpaid = 21805.0` (`23905.0 - 2100.0`)
    - `paidPercent = 67` (`Math.round(44094 / 65899 * 100)`)
    - `unpaidPercent = 33` (`Math.round(21805 / 65899 * 100)`)
    - `averageRevenuePerUser = 5991` (`Math.round(65899 / 11)`)
  - **Markdown Guide (`docs/uat/LOCAL07_EXPECTED_RESULTS_TH.md`)**: Updated summary tables to show 8 paid/partial receipts and Room 302 breakdown.

### 7.4 Generator Idempotency & Timestamp Stability
- `generatedAt` remains locked at `2026-08-27T03:55:02.317Z` without timestamp churn.
- Double execution of `node scripts/local07/generate-oracle.mjs` produces exact **0 diff**, proving deterministic generation.

### 7.5 Database $\leftrightarrow$ Oracle Reconciliation
| Entity / Field | Oracle Value | DB Value (`npm run uat:refresh`) | Reconciled? |
| :--- | :--- | :--- | :---: |
| Room 302 July Status | `PARTIALLY_PAID` | `PARTIALLY_PAID` | **YES** |
| Room 302 July Paid | `฿2,100.00` | `฿2,100.00` | **YES** |
| Room 302 July Outstanding | `฿4,000.00` | `฿4,000.00` | **YES** |
| Room 302 July Receipt | `RCP-202607-302-P1` | `RCP-202607-302-P1` | **YES** |
| July Fully Paid Bills | 7 | 7 | **YES** |
| July Partially Paid Bills | 1 | 1 | **YES** |
| July Unpaid Bills | 3 | 3 | **YES** |
| July Total Paid Revenue | `฿44,094.00` | `฿44,094.00` (11 monthly bills) | **YES** |
| July Total Outstanding | `฿21,805.00` | `฿21,805.00` (11 monthly bills) | **YES** |
| Room 302 Pending Group | `UNDER_REVIEW` (฿6,500) | `UNDER_REVIEW` (฿6,500) | **YES** |
| Room 302 Pending Approval | Pending manual PO action | Pending manual PO action | **YES** |
| Receipt Print Status | Source print fix ready | Source print fix ready | **YES** |

---

## 8. R3.8fR3 — LOCAL-07 Mutation CORS + Docker Runtime Authority Closure

### 8.1 Product Owner CORS Runtime Evidence
- **Browser Origin**: `http://127.0.0.1:5173/owner/payments`
- **Symptom**: Read requests (`GET /api/v1/payments`, `GET /api/v1/properties/dormitory/defaults`) succeeded, but clicking "อนุมัติ" on Room 302 failed before the Payment API route could execute.
- **Server Runtime Log**: `CORS policy blocked access from origin: http://127.0.0.1:5173`
- **Root Cause**: Backend default `CORS_ORIGINS` was configured strictly to `http://localhost:5173`. When accessing via loopback IP `http://127.0.0.1:5173`, CORS preflight (`OPTIONS`) and mutations were blocked.

### 8.2 Safe Loopback CORS Resolution
- **Design Authority**: Preserved explicit `CORS_ORIGINS` configuration while updating the safe development default to both standard local loopback origins:
  `http://localhost:5173,http://127.0.0.1:5173`
- **Files Synchronized**:
  - `server/src/config/env.ts`: Default updated to `'http://localhost:5173,http://127.0.0.1:5173'`.
  - `server/.env`: Set `CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`.
  - `server/.env.example`: Set `CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`.
- **Security Invariant**: Production CORS wildcard `*` remains strictly prohibited and fails closed at startup.

### 8.3 Docker & Host Runtime Container Classification
| Container Name | Image | Host Port Mappings | Status | Classification | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `horplus_postgres` | `postgres:16-alpine` | `5455->5432`, `5432->5432` | Up (healthy) | **CURRENT_UAT_REQUIRED** | Hosts active PostgreSQL database target (`horplus_wave1d_fasttrack_test`) |
| `horplus-v2-redis-1` | `redis:7-alpine` | `6380->6379` | Up (healthy) | **CURRENT_UAT_REQUIRED** | Active Redis cache for HorPlus-V2 backend |
| `horplus-v2-db-1` | `postgres:15` | None (standby) | Created | **CURRENT_OPTIONAL** | Defined in `docker-compose.windows-pilot.yml`, standby |
| `horplus_api` | `horplus_wave1d_fasttrack-api` | `3000->3000` | Up (healthy) | **LEGACY_NOT_USED_BY_CURRENT_UAT** | Legacy stack API; current UAT uses host Node.js API on port 3001 |
| `horplus_redis` | `redis:7-alpine` | `6379` (internal) | Up (healthy) | **LEGACY_NOT_USED_BY_CURRENT_UAT** | Legacy stack internal Redis |
| `horplus_wave1d_fasttrack-db-1` | `postgres:15` | `5432` (internal) | Up (healthy) | **LEGACY_NOT_USED_BY_CURRENT_UAT** | Legacy stack internal DB |
| `horplus_wave1d_redis` | `redis:7-alpine` | `6379->6379` | Up | **LEGACY_NOT_USED_BY_CURRENT_UAT** | Legacy stack host Redis on port 6379 |
| `chatbot_*` | Multiple | `8000`, `6333` | Paused | **UNKNOWN_DO_NOT_TOUCH** | Unrelated enterprise chatbot stack |

### 8.4 Legacy Stack Safety Assessment
- The legacy `horplus_wave1d_fasttrack` stack does not own ports `5455`, `6380`, `3001`, or the active `DATABASE_URL` target.
- **Old Stack Status**: **SAFE TO STOP OLD STACK**
- **Volume Safety**: **NOT SAFE TO DELETE VOLUMES YET** (Retain for data preservation).

### 8.5 Unified Database Authority Verification
- **API DB Target**: `127.0.0.1:5455 / horplus_wave1d_fasttrack_test`
- **LOCAL-07 Script DB Target**: `127.0.0.1:5455 / horplus_wave1d_fasttrack_test`
- **Result**: Unified single-database authority (Zero split).

### 8.6 Room 302 Pending State Integrity
- Room 302 was **NOT** approved or modified during automated test runs.
- **Live Database Graph Verified**:
  - July Bill (`INV-202607-009`): `PARTIALLY_PAID`, Paid `฿2,100.00`, Outstanding `฿4,000.00`.
  - August Bill (`INV-202608-302-R`): `UNPAID`, Outstanding `฿5,000.00`.
  - Pending Group (`฿6,500.00`): `UNDER_REVIEW`, Child Payments `UNDER_REVIEW` (July `฿4,000.00`, August `฿2,500.00`), Receipts `0`.
  - Mutated by Agent: **NO**.

---

## 9. R3.8fR4 — Monthly Bill Lifecycle Authority, In-Place Recalculation, Duplicate Bill Forensics & Chrome Print Closure

### 9.1 Monthly Bill Lifecycle Authority (Owner Decisions 1A, 2A & 3A)
- **Decision 3A — Save Meter != Issue Bill**:
  - `POST /api/v1/meters/workspace/bulk` is strictly a workspace snapshot mutation.
  - When no bill exists for a room in the billing cycle, saving meter readings, people counts, other fees, and manual adjustments persists workspace readings and snapshot records (`roomBillingCycleSnapshot`) but creates **0 bills**.
  - Tenant visibility remains **"ยังไม่ออกบิล"** (no canonical monthly bill is visible to tenant).
  - An issued monthly bill is only created via explicit bill issuance (`POST /api/v1/bills/generate`, `POST /api/v1/bills/generate/bulk`, or meter toggle switch `action: 'issue'`).
- **Decision 1A — Issued but Financially Untouched Bill In-Place Recalculation**:
  - If a canonical `MONTHLY_UTILITY` bill already exists for the room + cycle and has **0 financial evidence** (`paidAmount = 0`, status `unpaid` or `overdue`, zero approved/pending payments, zero allocations, zero receipts, zero active upload intents), saving modified meter workspace inputs **recalculates the SAME Bill in place**.
  - **Preserved Invariants**:
    - `Bill.id` (unchanged)
    - `Bill.billNumber` (unchanged)
    - `Bill.billingDate` (original issue date preserved)
    - `Bill.dueDate` (original due date preserved; for `OVERDUE` bills, late fee is reconciled consistently against original due date without resetting or backdating)
    - `Bill.generatedAt` & `Bill.generatedByUserId` (preserved)
    - `Bill.billingCycleId`, `Bill.roomId`, `Bill.tenantId`, `Bill.contractId` (preserved)
  - **Mutations Applied**:
    - Bill items replaced with newly computed items from canonical `generateBillPreview` authority.
    - `subtotal`, `fineAmount`, `totalAmount`, `outstandingAmount` updated (`paidAmount` remains `0.00`).
    - `Bill.version` incremented atomically.
    - Audit log entry emitted: `action: 'METER_WORKSPACE_RECALCULATION'` with `oldTotal` and `newTotal`.
- **Decision 2A — Financial Evidence Guard (Fail Closed)**:
  - Implemented `resolveBillDirectRecalculationEligibilityInTx` to inspect the full relational graph within the active database transaction:
    - `bill.paidAmount > 0`
    - Status in `PAID`, `PARTIALLY_PAID`, `REFUNDED`, `REVERSED`
    - Any `Payment` with status `APPROVED`, `VERIFIED`, `UNDER_REVIEW`, `PENDING`
    - Any `PaymentAllocation` with `allocatedAmount > 0`
    - Any `CombinedPaymentGroup` with status `APPROVED`, `PARTIALLY_APPROVED`, `UNDER_REVIEW`, `PENDING`
    - Any active `Receipt` (status not `CANCELLED` or `VOID`)
    - Any active `PaymentUploadIntent`
  - If financial evidence exists, direct meter recalculation and meter switch cancellation fail closed with HTTP 409:
    - Code: `BILL_HAS_FINANCIAL_EVIDENCE`
    - Message: `บิลนี้มีรายการชำระเงินหรือสลิปที่เกี่ยวข้องแล้ว\nไม่สามารถแก้ยอดโดยตรงได้`

### 9.2 Database Partial Unique Index Migration
- **Migration**: `server/prisma/migrations/20260830180000_owner_r38fr4_active_monthly_utility_unique/migration.sql`
- **SQL DDL**:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS "bills_active_monthly_utility_unique"
  ON "bills" ("dormitory_id", "billing_cycle_id", "room_id")
  WHERE "bill_kind" = 'MONTHLY_UTILITY'
    AND LOWER("status") NOT IN ('cancelled', 'void', 'voided');
  ```
- **Database Forensics**: Verified across the entire database with `HAVING count(*) > 1` on active `(dormitory_id, billing_cycle_id, room_id, bill_kind)`. Result: **0 duplicates found**. Migration deployed successfully with zero schema conflicts.

### 9.3 Room 101 Duplicate Bill Forensics & Payments Tab Card Authority
- **UAT Runtime Forensics (Pre-Refresh State)**:
  - `Bill A` (`d08b39ba-935d-451f-89c2-5f5b5fc6c3ed`): `INV-202608-101`, `MONTHLY_UTILITY`, `status: cancelled`, Total `฿1,268.00`, Paid `฿0.00`, Outstanding `฿1,268.00`. Cancelled at `2026-08-30T08:24:19.935Z`.
  - `Bill B` (`7d0b6b37-e367-4dba-b54a-b2769a91f103`): `INV-2026-08-0001`, `MONTHLY_UTILITY`, `status: PAID`, Total `฿1,286.00`, Paid `฿1,286.00`, Outstanding `฿0.00`, 1 approved Cash payment (`฿1,286.00`), Receipt `RC-202608-101-0005`. Created at `2026-08-30T08:24:21.499Z`.
  - **Duplicate Classification**: **Class A (same MONTHLY_UTILITY duplicate)** resulting from manual UAT workflow where an older bill was cancelled and replaced by a new bill.
- **Frontend Payments Card Root Cause**:
  - In `src/pages/owner/payments.tsx`, `unpaidBills` filter evaluated:
    `const isPaid = (b.status || '').toLowerCase() === 'paid'; if (isPaid) return false;`
  - It failed to exclude bills with `status: 'cancelled'` or `status: 'void'`. Because Bill A was `cancelled` but retained its original `outstandingAmount: 1268.00`, it erroneously rendered as an unpaid card alongside other cards.
- **Resolution**:
  - Updated `src/pages/owner/payments.tsx` `unpaidBills` filter to strictly exclude `['PAID', 'CANCELLED', 'VOID', 'VOIDED']`.
  - Non-utility bills (`RENT`, `DEPOSIT`) with active unpaid status continue to display distinct cards with their full canonical identity.

### 9.4 Chrome Blank Print Preview Final Closure
- **Root Cause**:
  - In `src/components/GlobalComponents.tsx`, `handlePrint` attached an `afterprint` cleanup listener but also started a fixed fallback timer: `setTimeout(cleanup, 2000)`.
  - In Google Chrome, when the system Print Preview dialog opens, the rendering engine continues to hold references to `#horplus-print-root` in the parent document. The 2-second timeout unconditionally removed `#horplus-print-root` from the DOM while Print Preview was still evaluating, resulting in a blank 1-page preview.
- **Resolution**:
  - Removed `setTimeout(cleanup, 2000)` from `handlePrint`.
  - Print root cleanup is now governed exclusively by the browser `afterprint` event listener.
  - If `afterprint` does not fire, the print root safely remains attached in the DOM without causing memory leaks or UI corruption (as subsequent print calls clean up existing print roots idempotently).
- **Automated Lifecycle Test Verification**:
  - Added unit test in `src/tests/owner-r38f-quickadd-and-print.test.tsx` utilizing Vitest fake timers:
    - Asserts `#horplus-print-root` persists at `t = 2,500 ms` and `t = 5,500 ms`.
    - Asserts `#horplus-print-root` and `#horplus-print-style` are removed immediately when `window.dispatchEvent(new Event('afterprint'))` fires.

### 9.5 Verification & Test Matrix Results
| Suite / Command | Scope | Result |
| :--- | :--- | :---: |
| `git -c core.whitespace=cr-at-eol diff --check` | Whitespace & CR/LF hygiene | **PASS (0 errors)** |
| `npm run lint` | TypeScript type-checking (`tsc --noEmit`) | **PASS (0 errors)** |
| `npm --prefix server run build` | Backend TypeScript build | **PASS (0 errors)** |
| `npm run build` | Frontend Vite production build | **PASS (0 errors)** |
| `npx vitest run src/tests/owner-r38f-quickadd-and-print.test.tsx` | QuickAdd & Print Lifecycle (fake timers > 5s) | **PASS (6/6 tests)** |
| `cd server && npx vitest run src/__tests__/integration/owner-r38fr4-monthly-bill-lifecycle.test.ts` | Complete R3.8fR4 Lifecycle & In-Place Recalculation | **PASS (8/8 tests)** |
| `cd server && npx vitest run src/__tests__/integration/owner-r38f-group-approval-forensics.test.ts` | Group Payment Approval & Actor Authority | **PASS (2/2 tests)** |
| `cd server && npx vitest run src/__tests__/integration/owner-r38fr3-cors-mutation.test.ts` | CORS Preflight & Loopback Mutation Authority | **PASS (6/6 tests)** |
| `npm run uat:verify` | LOCAL-07 Sandbox Financial Oracle Integrity | **PASS (0 failures)** |
