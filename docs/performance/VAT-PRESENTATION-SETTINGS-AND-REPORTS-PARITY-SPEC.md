# VAT Presentation, Settings Lock, Calendar Parity, and Reports Parity Specification

**Document ID**: `VSR-SPEC-2026-09-14`  
**Author**: Antigravity Pair Programming Agent  
**Status**: DRAFT (Gate A Review Ready)  
**Governing Standard**: `c:\HORPLUS-V2\HORPLUS_V2_ANTIGRAVITY_WORKFLOW_PROMPTS.md`  

---

## 1. Executive Summary & Product Owner Decisions

Based on user requests and confirmed `/grill-me` decisions (`Q1=ก, Q2=ก, Q3=ก, Q4=ก, Q5=ก, Q6=ก`):

1. **Q1 = ก (Meters "ยอดที่ต้องชำระ" Total Parity)**: In `/owner/meters` and `OwnerMeterListCard.tsx`, the card summary "ยอดที่ต้องชำระ" must calculate the VAT-inclusive net total (e.g. `6,706.76 ฿`), matching the sum of all itemized taxable components with VAT.
2. **Q2 = ก (Payments Card (+VAT) Itemized Parity)**: In `/owner/payments`, bill items whose categories are taxable under `vatSettings.appliedCategories` must display the `(+VAT)` tag and tax-inclusive amount (e.g. `ค่าน้ำ (@ 18 × 11 หน่วย): (+VAT) ฿ 211.86`), and the card total "ยอดที่ต้องชำระ" must show the VAT-inclusive net total (e.g. `฿ 6,706.76`).
3. **Q3 = ก (Settings VAT Controls Lock Parity)**: In `/owner/settings.tsx`, the VAT toggle switch, the 8 applied category checkboxes, and "เลือกทั้งหมด / ล้างค่า" buttons must be strictly disabled (`disabled={isCycleLocked}`) when that billing cycle has paid payments or is locked.
4. **Q4 = ก (Settings Canonical Calendar Picker Parity)**: In `/owner/settings.tsx`, replace the custom, hardcoded month grid modal with the canonical `<BillingCycleCalendarPicker>` component wired with `availableCycles`, ensuring exact visual, month accessibility, and Buddhist Year (+543) parity with the main system.
5. **Q5 = ก (Reports Temporal Dead Zone Resolution)**: In `src/pages/owner/reports.tsx`, eliminate the runtime `ReferenceError: Cannot access 'currentMonthBills' before initialization` by placing `monthVatTotal` after `reportData` destructuring, restoring the reports page, analytics, and 32-column Excel export.
6. **Q6 = ก (Receipt / Tax Invoice Header Parity)**: In `/owner/payments` and `receipt-html.util.ts`, paid bills in cycles with VAT active display the "ใบเสร็จรับเงิน" action button; when viewed or printed, the document header officially displays **"ใบเสร็จรับเงิน / ใบกำกับภาษี (RECEIPT / TAX INVOICE)"** alongside the 3-line VAT breakdown and Dormitory Tax ID.

---

## 2. Acceptance Criteria

| Criterion ID | Domain | Description | Verification Method |
|:---|:---|:---|:---|
| **VSR-01** | Meters Workspace | `OwnerMeterListCard.tsx` and `getOwnerFinancialBreakdown` compute `amountDue` including VAT for taxable categories using Satang arithmetic (`6,706.76 ฿`), matching all itemized rows. | Unit Test & Card Render Assertion |
| **VSR-02** | Payments Workspace | `/owner/payments` renders `(+VAT)` and tax-inclusive prices on taxable bill line items and reflects VAT-inclusive sum in "ยอดที่ต้องชำระ". | Unit Test & Card Render Assertion |
| **VSR-03** | Settings Workspace | `/owner/settings.tsx` disables VAT toggle switch, all 8 category checkboxes, and "เลือกทั้งหมด / ล้างค่า" buttons when `isCycleLocked` is true. | Unit Test & DOM State Assertion |
| **VSR-04** | Settings Workspace | `/owner/settings.tsx` mounts canonical `<BillingCycleCalendarPicker>` with `availableCycles` and Buddhist Year (+543) navigation. | Unit Test & Component Tree Inspection |
| **VSR-05** | Reports Workspace | `src/pages/owner/reports.tsx` eliminates TDZ ReferenceError by declaring `monthVatTotal` after `currentMonthBills` is destructured. | Vitest Render & Component Crash Guard |
| **VSR-06** | Receipt Authority | Paid bills in VAT cycles display "ใบเสร็จรับเงิน" button and render **"ใบเสร็จรับเงิน / ใบกำกับภาษี (RECEIPT / TAX INVOICE)"** in modal and A4 print HTML. | Backend & Frontend Receipt Title Test |
| **VSR-07** | Integrity & Builds | All test suites pass 100%; `npm --prefix server run build` and `npm run build` exit code 0. | CLI Build Execution |

---

## 3. Locked Behaviors & Security Invariants

1. **Category-Strict Centralized Math**: Never apply VAT to unticked categories under any circumstances.
2. **Zero Float Drift**: BigInt satang integer math throughout all financial calculations (`parseToSatangs`, `formatSatangs`).
3. **Multi-Tenant & Security Guards**: SEC-01 through SEC-08 preserved strictly.
4. **Thai UI Text Consistency**: Approved Thai typography, prompts, and neutral slip verification terminology preserved.
