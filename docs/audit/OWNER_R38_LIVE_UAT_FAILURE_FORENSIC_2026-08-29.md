# OWNER R3.8 — LIVE UAT FAILURE FORENSIC REPORT
**Date**: 2026-08-29  
**Target Environment**: HorPlus LOCAL-07 PostgreSQL (Port 5455) & Dev API Server  
**Auditor**: Antigravity Assistant Pair Engineering

---

## 1. Executive Summary & Forensic Context

During the manual Product Owner UAT session on the deterministic LOCAL-07 environment, two primary runtime failures were reproduced:
1. **Meter Save (จดมิเตอร์ — August 2569)**: Produced generic error toast `ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง` due to HTTP client discarding explicit safe backend domain error codes (`CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL` / `VALIDATION_ERROR`) and falling back to a generic `HTTP 500` / status-derived error.
2. **Cash Settlement (รับเงินสด — August 2569)**: Produced `เกิดข้อผิดพลาดในการบันทึกเงินสด: ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง` on partially-paid bills (such as Room 104) because `recordCashPaymentInTx` strictly enforced `submitAmount === bill.totalAmount` instead of validating against `bill.outstandingAmount`, and threw `UNSUPPORTED_AMOUNT` with an unnormalized error transport payload `{ error: err.message }`.
3. **June Contradiction**: `Comprehensive Owner` was seeded with an artificial June 2026 (`2026-06`) BillingCycle and Deposit Bill (`INV-202606-101-D`), despite the canonical operational start being July 2026 (`2026-07`).
4. **Deposit Fixture Gaps**: Room 102 active agreement had 0 deposit bills, showing `ค่าประกัน 4,500 ยังไม่ออกบิล` instead of an authoritative July UNPAID deposit bill.

---

## 2. Forensic Capture: The Two Real Failures

### 2.1 Failure 1: Meter Save Generic Error (จดมิเตอร์ — August 2569)

- **User Action**: Owner clicks **บันทึกข้อมูล** on `/owner/meters` for cycle `2026-08`.
- **HTTP Method**: `POST`
- **Endpoint**: `/api/v1/meters/workspace/bulk`
- **Request ID Pattern**: `req_c0492c4e-55e1-4ef8-83fa-444b01ac5a3e`
- **HTTP Status**: `400 Bad Request`
- **Domain Code Sent by Server**: `CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL`
- **Server Exception Message**: `ห้องนี้มีบิลที่ออกแล้ว หากต้องการล้างเลขมิเตอร์ปัจจุบัน กรุณายกเลิกบิลก่อน`
- **Affected Service**: `MeterService.saveBulkMeterWorkspace`
- **Root Cause**:
  1. Frontend `httpClient.ts` forcibly overwrote all HTTP 400 responses with `DomainErrorCode = 'VALIDATION_ERROR'` via `mapStatusToDomainCode(response.status)`, ignoring `response.error.code`.
  2. `meters.tsx` invoked `mapErrorMessageToThai(res?.error?.message)` passing the string message rather than the full error object containing `code`, resulting in fallback to the generic Thai error toast `เกิดข้อผิดพลาดในการบันทึกข้อมูลมิเตอร์`.
- **DB State & Partial Commit**: `NO` partial commit (atomic transaction rolled back cleanly).

---

### 2.2 Failure 2: Cash Settlement Invariant Failure (รับเงินสด)

- **Target Room**: Room 104 (or partially paid bill)
- **Bill ID**: `df6c18fc-ef06-4022-bf65-97f330bf3f3f`
- **Bill Number**: `INV-202608-104-COMBINED`
- **Bill Kind**: `LEGACY_COMBINED`
- **Bill Financial State**:
  - `totalAmount`: `10,600.00`
  - `paidAmount`: `3,000.00`
  - `outstandingAmount`: `7,600.00`
  - `status`: `partial`
- **Request Submitted by Client**:
  - `POST /api/v1/payments/cash`
  - Body: `{ "billId": "df6c18fc-ef06-4022-bf65-97f330bf3f3f", "amount": "7600" }`
- **Backend Validation Code**:
  ```ts
  const totalAmount = new Decimal(bill.totalAmount.toString()); // 10600
  const submitAmount = new Decimal(input.amount.toString());   // 7600
  if (!totalAmount.equals(submitAmount)) throw new Error('UNSUPPORTED_AMOUNT');
  ```
- **HTTP Status**: `400 Bad Request`
- **Server Response**: `{ "error": "UNSUPPORTED_AMOUNT" }` (unstructured string in error field)
- **Root Cause**:
  1. Backend `recordCashPaymentInTx` validated `submitAmount` against `totalAmount` instead of `outstandingAmount`.
  2. Backend overwrote `paidAmount = submitAmount` (7,600) rather than accumulating `paidAmount = paidAmount + submitAmount` (3,000 + 7,600 = 10,600).
  3. `payment.routes.ts` returned `{ error: err.message }` without the project's standard `{ error: { code, message, requestId } }` envelope.
  4. `generateReceiptInTx` stamped `Receipt.total = bill.totalAmount` (10,600) instead of the actual transaction `payment.amount` (7,600).

---

## 3. Database State Analysis Before Correction

### 3.1 Comprehensive Owner Dormitory (`20000001-0000-4000-8000-000000000002`)
- `createdAt`: `2026-07-01T00:00:00.000Z`
- **Authoritative Operational Start**: `2026-07` (July 2026)
- **Persisted Billing Cycles Before Correction**:
  - `2026-06`: Created manually by seed for `INV-202606-101-D` (CONTRADICTION)
  - `2026-07`: July cycle (Actual first operational cycle)
  - `2026-08`: August cycle
  - `2026-09`: September cycle
  - `2026-10`: October cycle

### 3.2 Target Room Deposit & Agreement Matrix Before Correction

| Room | Status | Contract Start | Deposit Req | Existing Deposit Bill | Pre-Correction UI State | Target R3.8 State |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **101** | Occupied | 2026-01-01 | 4,500 | `INV-202606-101-D` (June) | ชำระแล้ว (via June) | **PAID in July (`INV-202607-101-D`)** |
| **102** | Occupied | 2026-01-01 | 4,500 | None | ยังไม่ออกบิล (accidental) | **UNPAID in July (`INV-202607-102-D`)** |
| **103** | Occupied | 2026-01-01 | 4,500 | None | ยังไม่ออกบิล (accidental) | **UNPAID in July (`INV-202607-103-D`)** |
| **104** | Occupied | 2026-01-01 | 4,500 | `INV-202608-104-COMBINED` | UNKNOWN (Legacy Combined) | **UNKNOWN (Legacy Combined preserved)** |
| **201** | Occupied | 2026-01-01 | 4,800 | None | ยังไม่ออกบิล | **UNPAID in July (`INV-202607-201-D`)** |
| **202** | Occupied | 2026-01-01 | 4,800 | `INV-202608-202-D` (August) | จ่ายแล้ว (August) | **PAID in August (`INV-202608-202-D`)** |
| **203** | Occupied | 2026-01-01 | 4,800 | None | ยังไม่ออกบิล | **UNPAID in July (`INV-202607-203-D`)** |
| **303** | Occupied | 2026-01-01 | 5,000 | None | ยังไม่ออกบิล | **INTENTIONAL NOT_ISSUED (Preserved)** |
| **304** | Vacant | - | - | None | ว่าง | **Vacant (Eligible for Quick Add)** |

---

## 4. Line-Item Detail In Payments UI Before Correction

- `payments.tsx` rendered only `b.items.slice(0, 3)` in Cash cards, silently dropping item 4 and beyond.
- `GET /payments` excluded `bill.items`, leaving Checking, Paid, and Rejected tabs without line-item breakdown.
- Partial bills (such as Room 104 with 10,600 total, 3,000 paid, 7,600 outstanding) displayed the 3 items (4,800 + 4,800 + 1,000) directly above `ยอดที่ต้องชำระ 7,600` without reconciliation rows explaining the 3,000 previously paid.

---

## 5. Corrective Action Plan for R3.8

1. **July First Cycle**:
   - Eliminate June cycle from `scripts/local07/seed.mjs` and all Comprehensive Owner fixtures.
   - Seed `INV-202607-101-D` (July deposit bill, paid, approved payment, receipt).
2. **Deposit Matrix Completion**:
   - Seed `INV-202607-102-D` (July deposit bill, 4,500 unpaid).
   - Seed other intended July deposit bills so no modern occupied agreement is accidentally `NOT_ISSUED`.
3. **Cash Settlement Authority**:
   - Update `recordCashPaymentInTx` to validate `submitAmount === currentOutstanding`.
   - Accumulate `paidAmount = paidAmount + submitAmount` and set `outstandingAmount = 0.00`.
   - Update `generateReceiptInTx` to record `Receipt.total = submitAmount` (7,600) and truthful settlement line for partial bills.
4. **Structured Error Transport**:
   - Normalize `payment.routes.ts` error responses to `{ error: { code, message, requestId, timestamp } }`.
   - Update `src/data/httpClient.ts` to prioritize `responseData.error.code` over HTTP status mapping.
5. **Full Line-Item Detail in Payments**:
   - Include `bill.items` in `GET /payments` response DTO.
   - Replace `slice(0, 3)` with full reconciliation, `ดูรายละเอียด +N`, and partial bill breakdown.
