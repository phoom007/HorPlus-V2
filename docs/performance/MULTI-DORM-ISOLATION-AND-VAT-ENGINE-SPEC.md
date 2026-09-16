# MULTI-DORM-ISOLATION-AND-VAT-ENGINE-SPEC

## Document Control
- **Title**: Multi-Dormitory Data Isolation & Category-Strict Centralized VAT 7% Engine Specification
- **Stage**: Gate A / Architecture & Quality Specification (Before Implementation)
- **Author**: Lead Software Architect & Autonomous AI Agent
- **Skills Applied**: `/improve-codebase-architecture`, `/codebase-design`, `/domain-modeling`, `/to-spec`, `/grill-me`
- **Target Systems**:
  - HorPlus-V2 Server (`server/src/routes/dormitory.routes.ts`, `server/src/utils/monthly-utility-calculator.util.ts`, `server/src/services/billing.service.ts`)
  - HorPlus-V2 Client (`src/pages/owner/settings.tsx`, `src/pages/owner.tsx`, `src/pages/owner/meters.tsx`, `src/pages/owner/payments.tsx`, `src/pages/owner/reports.tsx`, `src/components/common/BillDetailModal.tsx`)

---

## 1. Problem Statement

### 1.1 Multi-Dormitory Data Leakage & State Bleed
When an owner manages multiple dormitories under a single Google user account, modifying or deleting settings in Dormitory A inadvertently modifies or deletes settings in Dormitory B. Specifically:
- Deleting the owner's digital signature (`ownerSignature`) in Dormitory A clears the signature in Dormitory B.
- Bank QR Code (`bankQrCode`), Tax ID (`taxId`), and Logo (`logoUrl`) are vulnerable to cross-property overwrites.
- **Root Cause**: `src/pages/owner/settings.tsx` uses `saveDormitory()` and `getDormitory()` in `src/data/mockData.ts`, which reads from and writes to a single shared browser storage key `localStorage['horplus_dormitory']`. Furthermore, the server lacks a `DELETE /api/v1/dormitories/:dormitoryId/signature` endpoint, and `src/pages/owner.tsx` did not pass the resolved `currentDormitory` prop down to `<OwnerSettings />`.

### 1.2 Missing Category-Strict VAT 7% Financial Engine
Although VAT settings (`enabled`, `rate`, `appliedCategories`) are persisted in the database, VAT is not yet calculated or displayed across the active financial lifecycle:
- Meter recording workspace displays un-taxed totals.
- Bill generation and previews do not calculate or itemize VAT.
- Invoices and receipts lack statutory 3-line tax summaries (Subtotal, VAT 7%, Net Total) and Tax ID attribution.
- Cash recording and slip verification do not reflect the net tax-inclusive payable amount.
- Financial reports, occupancy ledgers, and Excel/CSV exports (30-column grid and yearly comparisons) do not include VAT columns or tax totals.
- **Crucial PO Directive**: VAT must NEVER be calculated arbitrarily or globally. It must be computed strictly and exclusively for categories explicitly selected in `vatSettings.appliedCategories`.

---

## 2. Solution Overview

### 2.1 100% Multi-Tenant Isolation Seam
- Add `DELETE /api/v1/dormitories/:dormitoryId/signature` to deactivate/remove the current signature for that specific dormitory ID.
- In `src/pages/owner/settings.tsx`, completely eliminate `saveDormitory` and `getDormitory`.
- Load, save, and delete `ownerSignature`, `bankQrCode`, `taxId`, and `logoUrl` strictly through REST API endpoints scoped to `activeDormId`.
- In `src/pages/owner.tsx`, pass `dormitory={currentDormitory}` to `<OwnerSettings />` and invalidate relevant query caches upon switching dormitories.

### 2.2 Category-Strict Centralized VAT 7% Engine
- Introduce a centralized calculation authority (`FinancialTaxEngine` / extended `monthly-utility-calculator.util.ts`):
  - Inputs: Itemized charges (`rent`, `water`, `electricity`, `commonFee`, `internetFee`, `parking`, `fine`, `other`) + `vatSettings`.
  - Logic:
    1. If `!vatSettings.enabled`, `vatAmount = 0.00`, `netTotal = subtotal`.
    2. If `vatSettings.enabled`, iterate through items. If `item.category` is in `vatSettings.appliedCategories`, mark item as taxable.
    3. `vatableSubtotal` = sum of taxable items.
    4. `vatAmount` = `round(vatableSubtotal * (rate / 100), 2)`.
    5. `netTotal` = `subtotalBeforeVat + vatAmount`.
- **Meters Workspace (`meters.tsx`)**:
  - Table mode: Room total displays net payable (e.g. 100 &rarr; 107).
  - Itemized mode: Taxed items show `(+VAT)` badge and tax-inclusive unit amount (e.g. `"ค่าส่วนกลาง (+VAT) 214.-"`).
  - Header summary: Displays 3 cards (`รวมก่อน VAT`, `VAT 7%`, `ยอดรวมสุทธิ`).
- **Invoices & Receipts (`BillDetailModal.tsx` & PDF print view)**:
  - 3-line financial summary footer:
    1. รวมเงินก่อนภาษี (Subtotal)
    2. ภาษีมูลค่าเพิ่ม 7% (VAT 7%)
    3. จำนวนเงินรวมทั้งสิ้น (Total Net Amount)
  - Dormitory Tax ID rendered on header.
- **Payments (`payments.tsx`)**:
  - Cash recording & slip verification operates on `totalAmount` (net tax-inclusive).
  - Cash modal shows breakdown of taxable base and VAT.
- **Reports & Excel/CSV Exports (`reports.tsx`)**:
  - Monthly & Yearly summary cards show Net Revenue, Revenue Before VAT, and Output VAT 7% (for filing ภ.พ.30).
  - Excel/CSV 30-column grid and yearly export include:
    - Column: `ยอดรวมก่อน VAT (บาท)`
    - Column: `ภาษีมูลค่าเพิ่ม 7% (บาท)`
    - Column: `ยอดรวมสุทธิ (บาท)`

---

## 3. User Stories

1. **As an Owner managing multiple dormitories**, I want each dormitory's digital signature, bank QR code, and Tax ID to be stored completely independently, so that editing or deleting settings in Dormitory A never affects Dormitory B.
2. **As an Owner**, I want to toggle VAT 7% on or off and select specifically which categories apply (e.g. only Rent and Common Fee, but not Water and Electricity), so that my bills comply with tax regulations without overcharging tenants.
3. **As an Owner or Manager on the Meters Workspace**, I want the table view to show the final VAT-inclusive total per room, so that I can see the exact bill amount at a glance.
4. **As an Owner or Manager on the Meters Workspace**, I want itemized rows to display `(+VAT)` and the tax-inclusive price for enabled categories, so that I can verify which fees include tax.
5. **As an Owner or Manager**, I want the Meters Workspace header to show 3 summary totals (Subtotal before VAT, VAT 7%, and Net Total), so that I know the aggregate monthly billing revenue and tax liability.
6. **As a Tenant receiving a bill or receipt**, I want to see a clear 3-line tax breakdown (Subtotal, VAT 7%, Net Total) and the dormitory's Tax ID, so that I have a legally valid receipt for accounting and reimbursement.
7. **As an Owner recording a cash payment**, I want the payment modal to show the tax breakdown while collecting the full net amount, so that the cash ledger matches the issued invoice.
8. **As an Owner viewing financial reports**, I want to see Net Revenue, Revenue Before VAT, and Output VAT 7% separated, so that my accountant can file form ภ.พ.30 directly without manual calculations.
9. **As an Owner exporting billing data to Excel (.xlsx) or CSV**, I want dedicated columns for `ยอดก่อน VAT`, `VAT 7%`, and `ยอดรวมสุทธิ`, so that external accounting software can import complete tax records.
10. **As a Manager**, I want to perform all meter, payment, and report operations under the configured VAT rules without permission errors.

---

## 4. Implementation Decisions

### 4.1 Multi-Tenant Isolation Architecture
- **Decision 1**: Add `DELETE /api/v1/dormitories/:dormitoryId/signature` to `dormitory.routes.ts` protected by `requireSession, requireDormitory, requireDormitoryUpdate`. Sets `isCurrent: false` on active signatures for that `dormitoryId`.
- **Decision 2**: In `settings.tsx`, replace `saveDormitory` with direct API calls:
  - Signature: `GET /api/v1/dormitories/:dormitoryId/signature` and `POST /api/v1/dormitories/:dormitoryId/signature`.
  - Tax ID: `updateDormitoryProfile(activeDormId, { taxId })`.
  - Bank QR Code: `updatePaymentSettings(activeDormId, { bankQrCode })`.
- **Decision 3**: In `owner.tsx`, pass `dormitory={currentDormitory}` to `<OwnerSettings />`.

### 4.2 Category-Strict VAT Engine Contract
- **Decision 4**: Zero floating point arithmetic. All financial calculations must use exact string/satang math (`Decimal` on server, `BigInt` satangs on client).
- **Decision 5**: Category matching is strict equality:
  - `rent`: matched when `item.type === 'rent'`
  - `water`: matched when `item.type === 'water'`
  - `electricity`: matched when `item.type === 'electricity'`
  - `commonFee`: matched when `item.type === 'common_fee'`
  - `internetFee`: matched when `item.type === 'internet_fee'`
  - `parking`: matched when `item.type === 'parking_fee'`
  - `fine`: matched when `item.type === 'late_fee'`
  - `other`: matched when `item.type === 'other'` or custom item
- **Decision 6**: If an item's category is NOT present in `vatSettings.appliedCategories`, its tax contribution is strictly `0.00`.
- **Decision 7**: Excel/CSV Grid layout:
  - Insert `ยอดก่อน VAT`, `VAT 7%`, `ยอดรวมสุทธิ` into `generateRawGridLines` in `reports.tsx`.
  - Total summary row accumulates all three columns with satang precision.

---

## 5. Testing Decisions

- **Isolation Tests**: Verify that invoking `DELETE /api/v1/dormitories/:dormA/signature` removes signature for Dorm A while Dorm B's signature query continues returning HTTP 200 with unchanged buffer.
- **Category Selection Tests**:
  - Test Case A: Only `commonFee` enabled &rarr; Rent, Water, Electricity have 0 VAT; Common fee of 200 has 14 VAT &rarr; Net total = base + 14.
  - Test Case B: All categories enabled &rarr; All items taxed at 7%.
  - Test Case C: VAT disabled (`enabled: false`) &rarr; VAT is 0 on all items.
- **Export Integrity Tests**: Verify CSV generator includes `ยอดก่อน VAT`, `VAT 7%`, `ยอดรวมสุทธิ` headers and non-empty values.
- **UI Tests**: Verify `(+VAT)` badges in Meters itemized view and 3-row footer in `BillDetailModal`.

---

## 6. Out of Scope

- Integrating external accounting cloud APIs (FlowAccount, Peak, Quickbooks).
- Dynamic tax rates other than the configured numeric rate (default 7%).
- Withholding tax (หัก ณ ที่จ่าย ภ.ง.ด.3/53) deductions (handled in future release).
