# SPEC-MUB-01: Monthly Utility Bill Separation and Meter Status Synchronization

## 1. Background & Problem Statement
In HorPlus-V2, room tenancy initiation (onboarding or move-in contract signing) generates standalone `DEPOSIT` and `RENT` bills. At this stage, monthly utilities (water, electricity, common fee) have not been issued yet and reside as unissued `PREVIEW` charges awaiting meter reading finalization.

However, recent code modifications in `bill.repository.ts` (`findActiveMonthlyUtilityByRoomAndCycle`), `meter.service.ts` (`monthlyUtilityBill`), and `meters.tsx` (`existingMonthlyUtilityBill`) erroneously included `'RENT'` in the definition of a monthly utility bill.

Consequently:
1. When a room has a standalone `RENT` bill from check-in, `/owner/meters` treats this `RENT` bill as `monthlyUtilityBill`.
2. Because the `RENT` bill is unpaid, `/owner/meters` displays the room as **"รอชำระ"** with the issue switch toggled **ON**, misleading the owner into believing a utility bill was issued.
3. If the owner clicks the switch to issue the actual meter bill, `toggleRoomBillSwitch` invokes `findActiveMonthlyUtilityByRoomAndCycle`, finds the `RENT` bill, and aborts creation (`created: false`), completely preventing the `MONTHLY_UTILITY` bill from ever being generated.
4. In `/owner/payments`, only the `RENT` and `DEPOSIT` bills appear, leaving the owner confused as to why `/owner/meters` indicates "รอชำระ" while the monthly utility bill is missing from `/owner/payments`.

## 2. PO Requirements & Authoritative Decisions
- **PO Issue**: "เมนูจดมิเตอร์ สถานะ รอชำระ แต่กลับ ไม่แสดงในบิลรายเดือน ในเมนูการชำระเงิน"
- **Authoritative Invariants**:
  1. `monthlyUtilityBill` must strictly encapsulate bills that carry utility charges: `MONTHLY_UTILITY`, `COMBINED`, or `LEGACY_COMBINED`.
  2. Standalone `RENT` and `DEPOSIT` bills must NEVER be recognized as a `monthlyUtilityBill`.
  3. A room that has only an unissued utility preview (even if `RENT` or `DEPOSIT` is unpaid) must display status **"ยังไม่ออกบิล"** with the switch **OFF** (gray) in `/owner/meters`, strictly adhering to `STAT2: MU unissued + RENT unpaid -> renders ยังไม่ออกบิล (NOT รอชำระ)`.
  4. The owner must be able to click the switch or "ออกบิลทั้งหมด" in `/owner/meters` to atomically generate the `MONTHLY_UTILITY` bill.
  5. Once issued, the `MONTHLY_UTILITY` bill must immediately appear under "ยังไม่ชำระ" in `/owner/payments` alongside `RENT` and `DEPOSIT`.

## 3. Acceptance Criteria
- **MUB-01: Strict Bill Repository Discriminator**:
  - `findActiveMonthlyUtilityByRoomAndCycle` in `server/src/db/repositories/bill.repository.ts` (both `InMemoryBillRepository` and `PrismaBillRepository`) must search ONLY for `billKind: { in: ['MONTHLY_UTILITY', 'COMBINED', 'LEGACY_COMBINED'] }`. `RENT` and `DEPOSIT` are strictly excluded.
- **MUB-02: Server Meter Service Authority**:
  - In `server/src/services/meter.service.ts`:
    - `monthlyUtilityBill` resolution (around line 2694) searches ONLY for `MONTHLY_UTILITY`, `COMBINED`, and `LEGACY_COMBINED`. Standalone `RENT` and fallback `roomBills[0]` are removed.
    - If no utility bill exists, `monthlyUtilityBillStatus` evaluates to `'draft'`.
- **MUB-03: Frontend Meter Workspace Consistency**:
  - In `src/pages/owner/meters.tsx`:
    - `existingMonthlyUtilityBill` (line 300) filters strictly for `['MONTHLY_UTILITY', 'COMBINED', 'LEGACY_COMBINED']`.
    - If a room has only an unissued utility preview, `isMuIssued` evaluates to `false`, rendering label `"ยังไม่ออกบิล"` and switch OFF.
- **MUB-04: Atomic Bill Issuance & Cross-Menu Visibility**:
  - Toggling the switch ON for a room with existing `RENT` bill executes `toggleRoomBillSwitch` successfully and generates a new `MONTHLY_UTILITY` bill in DB.
  - In `/owner/payments`, the generated `MONTHLY_UTILITY` bill is queryable and rendered as a card under "ยังไม่ชำระ".
- **MUB-05: Test Suite Integrity & Zero Regression**:
  - All existing test suites (`local07-po-uat-corrections.test.tsx`, `tax-invoice-single-sheet-and-sync.test.tsx`, `owner-vat-presentation-and-settings.test.tsx`, `owner-payments-r38e-receipt.test.tsx`, `owner-round-24k3-manual-uat-payment-ui.test.tsx`) pass 100%.
  - `npm --prefix server run build` and `npm run build` succeed with exit code 0.

## 4. Non-Goals & Locked Behaviors
- Security controls SEC-01 through SEC-08 remain strictly untouched.
- VAT calculations and single-sheet tax invoice printing remain intact.
- Multi-tenant dormitory isolation is preserved.
