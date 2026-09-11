# HORPLUS-V2 — OWNER R3.8c FINANCIAL INTEGRITY CLOSURE
## Manual-Unverified Slip Policy + Future SlipOK-Ready Architecture
**Date**: 2026-08-29 / 2026-08-30  
**Branch**: `fix/owner-r38c-financial-integrity-slip-verifier-ready-20260829`  
**Base Commit**: `7d3303c077e92bb385d89deaa0e60c90eb176267`  
**Status**: APPROVED & IMPLEMENTED  

---

## 1. Executive Summary & Product Owner Decision

### Decision C — LOCKED: Manual-Unverified Slip Policy
The Product Owner has locked the canonical policy regarding payment evidence timestamps prior to external trusted banking integration:
1. **Client Timestamps Are Untrusted**: Any transfer date/time supplied by the tenant/client during slip upload is strictly unverified. It is stored as `claimedTransferAt` for audit and display purposes only.
2. **No Fake Evidence Verification**: Manual Owner approval confirms monetary receipt and ledger allocation, but does NOT transform a client-supplied timestamp into trusted bank evidence (`verifiedTransferAt` remains `null`).
3. **Late-Fee Invariant**: Manual unverified slip submissions do NOT freeze, backdate, or reduce late fees. Late fees accrue according to canonical schedule until bills are settled.
4. **Future Verifier-Ready Interface**: Pluggable adapter interface (`PaymentEvidenceVerifier`) is established. When SlipOK or Open Banking is integrated in a future release, it can inject trusted `verifiedTransferAt` timestamps without altering ledger or transaction architecture.
5. **No External Network Calls Now**: No SlipOK credentials, no third-party HTTP calls, and no fake `VERIFIED` records exist in production or UAT baselines.

---

## 2. Core Architectural & Financial Integrity Proofs

### A. Cash Must Remain Strictly Single-Bill
- **Policy**: Owner records cash directly against Bill X at the counter. Cash settles ONLY Bill X.
- **Implementation**: Removed `POST /payments/combined-cash` and `recordCombinedCash`. Cash payments always target single bill balances.

### B. Real Grouped Slip Monetary Event & Mathematical Conservation
- **Conservation Invariant**:
  $$\sum \text{child Payment.amount} \equiv \text{CombinedPaymentGroup.totalAmount} \equiv \text{actual submitted slip amount}$$
- **Behavior**: Child `Payment` records are created *only* for target bills receiving non-zero allocation, with `amount = allocatedAmount`. Child payments are never inflated to the full outstanding balance of every bill.

### C. Durable Group -> Bill Target Authority
- Added database model `CombinedPaymentGroupBillTarget` with unique constraint `@@unique([paymentGroupId, billId])`.
- `Bill.paymentGroupId` is deprecated as membership authority. Receipt queries and group loaders navigate via `CombinedPaymentGroupBillTarget`.

### D. Separation of Review & Financial States
- Pending slip submission marks `Payment.status = 'UNDER_REVIEW'` and `CombinedPaymentGroup.status = 'UNDER_REVIEW'`.
- **Bill Status Untouched**: Target bills remain in their true financial state (`UNPAID` or `PARTIALLY_PAID`). `Bill.status` is NEVER mutated to `UNDER_REVIEW`.

### E. Atomic Combined Group Approval (Authority: Group)
- Route: `POST /payments/combined-groups/:groupId/approve`.
- Atomically locks group and target bills deterministically, re-verifies reconciliation (`GROUP_ALLOCATION_RECONCILIATION_FAILED`), marks child payments `APPROVED`, persists `PaymentAllocation` rows, updates bill balances, and issues exactly ONE `Receipt` with `paymentGroupId`.

### F. Atomic Combined Group Rejection
- Route: `POST /payments/combined-groups/:groupId/reject`.
- Rejects Group and child payments with reason.
- Leaves bill balances and statuses completely untouched since bills were never financially mutated.

### G. Group Reversal Safety & Legacy Baseline Preservation
- **Child Reversal Blocked**: Individual reversal of a grouped payment is blocked with `GROUP_REVERSAL_REQUIRED`.
- **Group Reversal Route**: `POST /payments/combined-groups/:groupId/reverse` atomically voids the group receipt, deletes group allocations, and recalculates bill balances using the **Legacy Baseline Formula**:
  $$\text{legacyBaseline} = \max(\text{Bill.paidAmount} - \sum \text{existingAllocationsBefore}, 0)$$
  $$\text{newPaidAmount} = \text{legacyBaseline} + \sum \text{remainingAllocations}$$

### H. Legacy Unallocated Paid Amount Handling (Room 104 Case)
- When a legacy bill has historical paid amount exceeding explicit line-item allocations (`legacyUnallocatedPaidAmount > 0`), the allocation engine assigns it at the bill level (`billItemId = null`, description `ชำระยอดคงเหลือบิล {billNumber}`) without guessing or fabricating item lines.

### I. Receipt Snapshot is Immutable Authority
- Receipt rendering in HTML and UI binds strictly to immutable `snapshotData`.
- If a legacy receipt lacks detailed item lines, UI displays neutral truthful text `"ยอดชำระตามใบเสร็จเดิม"` instead of reconstructing or joining mutable live bill items.

### J. Pluggable Verifier Seam
- Model: `PaymentEvidenceVerification` (`dormitoryId`, `paymentId`, `paymentGroupId`, `provider`, `status`, `claimedTransferAt`, `verifiedTransferAt`, `verifiedAmount`, `providerReference`, `payloadHash`).
- Interface: `PaymentEvidenceVerifier` in `server/src/integrations/payment-verification/`.
- Default Provider: `UnconfiguredPaymentEvidenceVerifier` returning `provider: 'NONE'`, `status: 'UNVERIFIED'`.
- Helper: `resolveTrustedPaymentEffectiveAt()` returns trusted timestamp for cash (server now) or verified bank slip, and `null` for unverified bank transfers.

---

## 3. Database Migration

- Migration: `20260830000000_owner_r38c_financial_integrity_slip_verifier_ready`
- Added tables:
  - `combined_payment_group_bill_targets`
  - `payment_evidence_verifications`
- Added partial unique index:
  - `receipts_payment_group_id_unique` on `receipts(payment_group_id) WHERE payment_group_id IS NOT NULL`

---

## 4. Deterministic UAT Scenario (Room 302)

- **Room**: Room 302 (`ธนากร สุขใจ`)
- **July 2026 Bill**: `INV-202607-009` (฿4,000 unpaid)
- **August 2026 Bill**: `INV-202608-302-R` (฿5,000 unpaid)
- **Submitted Combined Slip**: ฿6,500
- **Allocation Intent**: July ฿4,000 (settles July), August ฿2,500 (partial August)
- **Verification**: `provider: 'NONE'`, `status: 'UNVERIFIED'`, `claimedTransferAt: 2026-08-28 14:30`, `verifiedTransferAt: null`
- **Owner Checking UI**: Shows 1 review card with ฿6,500 total, badge `"ยังไม่ได้ตรวจสอบเวลาการโอนจากระบบธนาคาร"`, July + August origins, and 1 Approve / 1 Reject action.

---

## 5. Automated Verification Results

### Unit Test Suite (16 Proof Matrix)
- File: `tests/unit/owner-r38c-financial-integrity.test.ts`
- **Status**: 16/16 Passed (100%)

### Real PostgreSQL Integration Suite
- File: `server/src/__tests__/integration/owner-r38c-real-financial-routes.test.ts`
- **Status**: 3/3 Passed (100%)
- Exercises real transactions, row locks (`SELECT FOR UPDATE`), GroupBillTargets, upload intents, atomic approvals, rejections, child reversal blocks, and group reversals.

---

## 6. Changed Files

1. `server/prisma/schema.prisma`
2. `server/prisma/migrations/20260830000000_owner_r38c_financial_integrity_slip_verifier_ready/migration.sql`
3. `server/src/integrations/payment-verification/types.ts`
4. `server/src/integrations/payment-verification/payment-evidence-verifier.ts`
5. `server/src/services/payment-verification.service.ts`
6. `server/src/utils/allocation.util.ts`
7. `server/src/utils/payment-transaction.util.ts`
8. `server/src/services/payment.service.ts`
9. `server/src/routes/payment.routes.ts`
10. `server/src/routes/receipt.routes.ts`
11. `src/pages/owner/payments.tsx`
12. `scripts/local07/seed.mjs`
13. `tests/unit/owner-r38c-financial-integrity.test.ts`
14. `server/src/__tests__/integration/owner-r38c-real-financial-routes.test.ts`
15. `docs/audit/OWNER_R38C_FINANCIAL_INTEGRITY_SLIP_VERIFIER_READY_2026-08-29.md`
