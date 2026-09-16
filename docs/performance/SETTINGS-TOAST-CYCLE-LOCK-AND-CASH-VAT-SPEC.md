# SETTINGS-TOAST-CYCLE-LOCK-AND-CASH-VAT-SPEC

## 1. Document Control
- **Document ID**: SPEC-STCV-01
- **Target Branch**: `main`
- **Scope**:
  1. `/owner/settings`: Universal Toast + Fade notification across all 13 settings sections on blur/change/toggle/click.
  2. `/owner/settings` & Billing Cycles: Canonical schema preprocessing in `UpdateCycleRateSnapshotSchema` (resolving HTTP 400 pink banner) + Invariant cycle locking with visually disabled inputs (zero warning banner per PO decision Q2.1).
  3. `/owner/payments`: Cash payment VAT reconciliation in `recordCashPaymentInTx` and `payments.tsx` ensuring 100% VAT alignment across DB, "ชำระแล้ว" tab, and official Receipt / Tax Invoice.
- **PO Authorities**:
  - PO Requests: "1.ปรับให้ทุกทั้งทีมีการบันทึกข้อมูล ให้แสดง toast+fade ที่ออกแบบให้ครบทุกช่อง ทุกปุ่ม ทีครับ , 2.จากรูป ทำไมขึ้นว่าเปลี่ยนไม่ได้ครับ ซึ่งตามหลักผมเคยออกแบบให้เปลี่ยนไปตามงวดๆได้ ถ้ายังไม่มีห้องไหนชำระแล้ว และเงื่อนไขอื่นๆ , 3.เมนูการชำระเงิน รายการในแท็บ ยังไม่ชำระ แสดงผลถูกต้อง แต่พอกด รับเงินสด แล้วไปอยู่ในแท็บ ชำระแล้ว กลับแสดงราคาไม่มี vat อยู่เลย ทำให้ยอดที่"
  - PO Confirmations (Grilling Round 1 & Round 2):
    - **Q1 = ก**: Toast + fade on all 13 settings sections with lightweight debounce to prevent stacking on rapid focus change.
    - **Q2 = Locking Invariant**: Retain strict lock when any bill in cycle has progressed beyond draft (`status != 'draft'`, e.g., `unpaid` or `paid`). Preprocess legacy values (`fixed`/`room` -> `per_room`, etc.) in backend schema to eliminate HTTP 400 validation error.
    - **Q2.1 = UI Locked State**: Do NOT display a warning text banner. Instead, visually and functionally disable (`disabled`, `opacity-60 bg-slate-100 cursor-not-allowed`) all rate inputs/dropdowns for that locked cycle so the owner immediately sees it cannot be edited.
    - **Q3 / Q3.1 / Q3.2 = ก**: Reconcile VAT on cash payment atomically in backend transaction (`recordCashPaymentInTx`). Send `getEffectiveBillAmount(bill, vatSettings)` from frontend. Update Bill (`subtotal`, `totalAmount`, `outstandingAmount`), record Payment, write Receipt with VAT breakdown (`vatAmount`, `vatRate`, `subtotal`, `total`, `isVatActive: true`). Consolidate "ชำระแล้ว" card to show effective VAT total and enable "ใบเสร็จรับเงิน / ใบกำกับภาษี".

---

## 2. Problem Statement & Root Cause Analysis

### 2.1 Pink Error Banner on Cycle Rate Editing (`media_1789447246754.png`)
- **Observed Behavior**: When changing rate snapshot values (e.g. parking fee mode or rates), the frontend displays a pink error banner: "ข้อมูลอัตราค่าบริการรอบบิลไม่ถูกต้อง".
- **Root Cause**:
  - In `src/pages/owner/settings.tsx`, the snapshot state was populated with unnormalized values from legacy cycle data (e.g., `parkingFeeMode: 'fixed'`).
  - In `server/src/routes/billing-cycle.routes.ts:30-51`, `UpdateCycleRateSnapshotSchema` is defined with `.strict()` and strictly expects `z.enum(['per_room', 'per_person', 'per_vehicle', 'free'])`. Passing `'fixed'` or `'room'` causes Zod to fail parsing with HTTP 400 `VALIDATION_ERROR`.
  - Frontend receives HTTP 400 and renders the pink error banner.

### 2.2 Cycle Rate Locking UX
- **User Intent**: Rate editing for a billing cycle should be locked when bills have been issued (`status != 'draft'`).
- **Required UX**: Per PO instruction Q2.1, do NOT show an explicit text alert/banner for locked cycles. Instead, directly disable (`disabled`, visual styling with opacity and cursor-not-allowed) the input fields and select dropdowns for that cycle so the owner intuitively understands the fields are read-only.

### 2.3 Cash Payment VAT Disconnect
- **Observed Behavior**: In `/owner/payments`, the unpaid bill card shows the effective total including VAT (e.g., 4,815 THB where subtotal is 4,500 THB and VAT 7% is 315 THB). However, clicking "รับเงินสด" sends raw `bill.outstandingAmount ?? bill.totalAmount` (4,500 THB).
- **Consequence**:
  - The payment is recorded as 4,500 THB.
  - The bill is marked paid at 4,500 THB without VAT.
  - The generated Receipt snapshot records 4,500 THB with `vatAmount: 0` or empty VAT fields.
  - The "ชำระแล้ว" tab displays 4,500 THB instead of 4,815 THB, and the printed Receipt does not show VAT.

---

## 3. Architecture & Target Design

### 3.1 Settings Toast & Fade Across All 13 Sections
- All 13 settings sections in `src/pages/owner/settings.tsx` will trigger `showToast` on every user-initiated blur, change, toggle, and button action.
- Toast feedback includes:
  - "กำลังบันทึก..." -> "บันทึกข้อมูลเรียบร้อยแล้ว" (or domain-specific: "บันทึกอัตราค่าบริการเรียบร้อยแล้ว", "บันทึกบัญชีรับเงินเรียบร้อยแล้ว", etc.).
  - Debounce timer (300ms) on rapid field transitions to prevent toast thrashing.
  - Fade CSS transition via `animate-fade-in` / `transition-opacity duration-300`.

### 3.2 Backend Zod Preprocessing for Rate Snapshots
- In `server/src/routes/billing-cycle.routes.ts`:
  ```typescript
  const normalizeParkingMode = (val: unknown) => {
    if (val === 'fixed' || val === 'room') return 'per_room';
    if (val === 'person') return 'per_person';
    if (val === 'vehicle') return 'per_vehicle';
    if (val === 'none') return 'free';
    return val;
  };
  const normalizeFeeMode = (val: unknown) => {
    if (val === 'room') return 'per_room';
    if (val === 'person') return 'per_person';
    if (val === 'flat') return 'fixed';
    return val;
  };
  ```
  Apply `z.preprocess()` to `parkingFeeMode`, `commonFeeMode`, `internetFeeMode`, `lateFeeType`.
- In `src/pages/owner/settings.tsx`:
  Canonicalize snapshot values upon load using `toCanonicalMode` before setting state.

### 3.3 Locked Cycle UX
- In `src/pages/owner/settings.tsx`:
  - When `isCycleLocked` is true:
    - Remove the warning banner (`<div className="bg-amber-50 ...">`).
    - Pass `disabled={isCycleLocked}` and apply `opacity-60 bg-slate-100 cursor-not-allowed` to all cycle rate inputs and selects.

### 3.4 Cash Payment VAT Reconciliation
- In `src/pages/owner/payments.tsx`:
  - In `handleConfirmCashPayment` and `handleModalCashSubmit`:
    ```typescript
    const effectiveAmount = getEffectiveBillAmount(bill, vatSettings);
    // Send effectiveAmount as submitAmount
    ```
- In `server/src/utils/payment-transaction.util.ts`:
  - In `recordCashPaymentInTx`:
    - Check if the bill's dormitory has active VAT settings (`vatSettings.isActive`).
    - If active and `submitAmount > bill.outstandingAmount` (or bill does not reflect VAT):
      - Atomically update `bill` in the transaction:
        `subtotal = bill.totalAmount` (pre-VAT base)
        `totalAmount = submitAmount` (effective VAT total)
        `outstandingAmount = submitAmount`
      - Record `Payment` with `amount: submitAmount`.
      - Record `Receipt` snapshot with:
        `subtotal: bill.totalAmount`
        `vatRate: 7`
        `vatAmount: submitAmount - bill.totalAmount`
        `total: submitAmount`
        `isVatActive: true`
    - If VAT is not active, proceed with standard cash payment flow.

---

## 4. Acceptance Criteria

- **STCV-01: Universal Settings Toast & Fade**
  - Every field blur, select change, toggle switch, and button click across all 13 settings sections in `settings.tsx` provides immediate visual toast feedback with smooth fade animation and debounce.
- **STCV-02: Rate Snapshot Preprocessing & Zero Pink Banner**
  - `UpdateCycleRateSnapshotSchema` pre-normalizes `'fixed'`, `'room'`, `'flat'`, `'free'` to canonical schema enums.
  - Frontend `settings.tsx` normalizes loaded snapshot values.
  - Modifying snapshot values no longer throws HTTP 400 `VALIDATION_ERROR` or displays the pink banner.
- **STCV-03: Cycle Rate Locking Invariant & Input Disabling (No Banner)**
  - Rate editing is locked when any bill in the cycle has `status != 'draft'`.
  - The locked cycle displays NO text warning banner.
  - All rate inputs and dropdowns for the locked cycle are visibly disabled (`disabled`, `opacity-60 bg-slate-100 cursor-not-allowed`).
- **STCV-04: Cash Payment Full VAT Reconciliation**
  - Unpaid bills with active VAT calculate effective total (e.g. 4,815 THB).
  - Cash payment records the full 4,815 THB in DB.
  - Bill `subtotal`, `totalAmount`, and `outstandingAmount` are reconciled in PostgreSQL.
  - Payment record has `amount: 4815`.
  - Receipt record includes `subtotal: 4500`, `vatRate: 7`, `vatAmount: 315`, `total: 4815`, and `isVatActive: true`.
  - "ชำระแล้ว" tab displays consolidated bill card with 4,815 THB.
  - "ใบเสร็จรับเงิน" button opens "ใบเสร็จรับเงิน / ใบกำกับภาษี (RECEIPT / TAX INVOICE)".
- **STCV-05: Automated Tests & Build Health**
  - Vitest test suites for settings persistence and cash payment VAT pass 100%.
  - Production builds (`npm --prefix server run build` and `npm run build`) pass without errors.
