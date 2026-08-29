# OWNER R3.8b — FINAL CANONICAL PARTIAL-PAYMENT ARCHITECTURE AUDIT
**Date**: 2026-08-29  
**Branch**: `fix/owner-r38b-canonical-partial-payment-20260829`  
**Base**: `bbcff19e09a2076ff6a6b5571557bde140ff15b9`  
**Target Repository**: HorPlus-V2

---

## 1. Existing Financial Schema Truth & Limitations

Prior to R3.8b, the database schema had two historical paradigms:
1. **Single-Bill Payment Model (`payments`)**:
   - `Payment.billId` strictly references a single `Bill`.
   - `Receipt.paymentId` is a 1-to-1 unique foreign key.
   - `Receipt.billId` references the same single `Bill`.
   - In R3.8/R3.8a, cash and single slip payments updated the bill's `paidAmount` and `outstandingAmount` directly.
2. **Multi-Bill Group Model (`combined_payment_groups`)**:
   - `CombinedPaymentGroup` was introduced for bulk operations, but lacked a fine-grained, relational per-item allocation ledger.
   - `PaymentUploadIntent` linked multiple bills to a group, but when approved, either generated multiple separate receipts or failed to track which line items were settled.

---

## 2. Forensic Analysis: Why R3.8a APPROVED Guard was Defective

In R3.8a, `payment-transaction.util.ts` included the following guard:
```ts
const hasApprovedPayment = bill.Payment?.some((p: any) => p.status === 'APPROVED');
if (hasApprovedPayment) {
  throw new Error('ALREADY_PAID');
}
```
**Why this was defective**:
- If a bill of ฿10,600 received an approved partial payment of ฿3,000, its `outstandingAmount` became ฿7,600 and its status was partially paid.
- When the owner or tenant later attempted to settle the remaining ฿7,600 (via cash or slip), the guard detected the existing approved payment of ฿3,000 and rejected the new settlement with `ALREADY_PAID`.
- **R3.8b Correction**:
  - A bill is only `ALREADY_PAID` if its status is `PAID` or its `outstandingAmount === 0`.
  - Active review collision is only triggered if there is an active `PENDING` or `UNDER_REVIEW` payment on that bill (`PAYMENT_IN_PROGRESS`).
  - Historical `APPROVED` payments with remaining outstanding (`outstandingAmount > 0`) are legitimate partial history and must be allowed.

---

## 3. Canonical Real Monetary-Event Authority (Architecture A)

Under Product Owner-approved **Architecture A**:
- **1 Real Monetary Event = 1 Financial Transaction Group**:
  - Represented by `CombinedPaymentGroup` (or root `Payment` entity unified under a group).
  - Captures: 1 evidence source (slip image / cash transaction), 1 total received amount, 1 effective payment date, 1 review lifecycle, and 1 actor/receiver.
- **Ledger of Allocations (`PaymentAllocation`)**:
  - Relational breakdown tracking exact amounts applied to each `Bill` and optionally each `BillItem`.
- **1 Immutable Receipt (`Receipt`)**:
  - 1 Real monetary transaction generates exactly 1 `Receipt`.
  - The receipt snapshot captures the entire transaction breakdown across all allocated bills.

```
       [ 1 Incoming Transfer / Slip / Cash (฿7,000) ]
                            │
               CombinedPaymentGroup (฿7,000)
             ┌──────────────┼──────────────┐
             │              │              │
    Allocation #1    Allocation #2   Allocation #3
     (July: ฿4,000)   (Aug: ฿2,000)  (Deposit: ฿1,000)
             │              │              │
        July Bill       August Bill   Deposit Bill
        (PAID: 0)   (PARTIAL: 5,000) (PARTIAL: 3,500)
                            │
              1 Canonical Receipt (฿7,000)
```

---

## 4. Canonical Allocation Ledger Schema (`PaymentAllocation`)

```prisma
model PaymentAllocation {
  id              String                @id @default(uuid()) @db.Uuid
  dormitoryId     String                @map("dormitory_id") @db.Uuid
  paymentGroupId  String?               @map("payment_group_id") @db.Uuid
  paymentId       String?               @map("payment_id") @db.Uuid
  billId          String                @map("bill_id") @db.Uuid
  billItemId      String?               @map("bill_item_id") @db.Uuid
  allocatedAmount Decimal               @map("allocated_amount") @db.Decimal(12, 2)
  allocationOrder Int                   @default(0) @map("allocation_order")
  createdAt       DateTime              @default(now()) @map("created_at") @db.Timestamptz()

  dormitory       Dormitory             @relation(fields: [dormitoryId], references: [id], onDelete: Cascade)
  paymentGroup    CombinedPaymentGroup? @relation(fields: [paymentGroupId], references: [id], onDelete: SetNull)
  payment         Payment?              @relation(fields: [paymentId], references: [id], onDelete: SetNull)
  bill            Bill                  @relation(fields: [billId], references: [id], onDelete: Cascade)
  billItem        BillItem?             @relation(fields: [billItemId], references: [id], onDelete: SetNull)

  @@index([dormitoryId, billId], name: "idx_allocation_dorm_bill")
  @@index([dormitoryId, paymentGroupId], name: "idx_allocation_dorm_group")
  @@index([dormitoryId, paymentId], name: "idx_allocation_dorm_payment")
  @@map("payment_allocations")
}
```

### Authoritative Mathematical Invariants:
1. **Group Received Amount**:
   totalAmount = sum(allocatedAmount)
2. **Bill Paid Amount**:
   bill.paidAmount = sum(approved allocatedAmount)
3. **Bill Outstanding Amount**:
   bill.outstandingAmount = max(bill.totalAmount - bill.paidAmount, 0)
4. **Bill Status**:
   - `PAID` if outstandingAmount == 0
   - `PARTIALLY_PAID` if 0 < paidAmount < totalAmount
   - `UNPAID` if paidAmount == 0

---

## 5. Locked Allocation Rules

### A. Scope Isolation (Cross-Room Prohibition)
- Allocations are strictly restricted to:
  - SAME `dormitoryId`
  - SAME `roomId`
  - SAME `tenantId` / rental context
- **Cross-room allocation is FORBIDDEN**. Even if the same tenant rented multiple rooms or moved rooms, an incoming payment for Room A cannot automatically satisfy Room B.

### B. Bill Allocation Priority Order
1. **MONTHLY / Operational Bills**:
   - Ordered strictly by **OLDEST billing cycle first** (e.g. July 2026 before August 2026).
2. **DEPOSIT Bill**:
   - Satisfied **ONLY AFTER** all eligible monthly/operational bills in the same room scope have been fully paid.

### C. Item Allocation Priority Order (Inside a Monthly Bill)
Within a single monthly bill, funds are allocated across line items in this exact hierarchy:
1. `RENT`
2. `WATER`
3. `ELECTRIC` / `ELECTRICITY`
4. `COMMON_FEE` / `COMMON`
5. `INTERNET`
6. `PARKING`
7. `OTHER` / `OTHER_FEES`
8. `LATE_FEE` / `FINE` (**ALWAYS LAST**)

*Principle*: Principal and essential utilities are satisfied before late penalty fees.

### D. Overpayment Rejection
If the incoming transfer amount exceeds the total eligible outstanding amount within the allowed room/tenant scope:
- **Reject with domain code**: `PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING`
- **Thai message**: `ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก`
- **Database mutation**: None (no group, no allocations, no receipt).

---

## 6. Late-Fee Fairness Policy

1. **Timely Partial Payment (On or before Due Date)**:
   - Example: Due date = 5 Aug. Tenant pays ฿1,000 partial on 4 Aug. Owner approves on 7 Aug.
   - Effective payment date is 4 Aug (timely).
   - Bill transitions to `PARTIALLY_PAID`.
   - **Future late fee accrual is FROZEN** for this bill.
2. **Post-Due Partial Payment (After Due Date)**:
   - Example: Due date = 5 Aug. Late fee of ฿300 accrues on 6 Aug. Tenant pays partial on 10 Aug.
   - The ฿300 already accrued remains intact.
   - After this first successful partial payment, **future additional late fee accrual stops**.
3. **Rejected Evidence**:
   - Rejected slips do **NOT** freeze late fees and do not alter balances.

---

## 7. Cash Authority Policy

1. **Payment Date**: Server timestamp authority only (`new Date()`). Client-supplied dates are ignored.
2. **Receiver Identity**: Authenticated logged-in `userId`. Client cannot spoof receiver identity.
3. **Bill Scope**: Cash applies strictly to the single selected bill (no auto-crossing).
4. **Partial Cash**: Supported for any amount 0 < amount <= currentOutstanding.

---

## 8. Receipt Snapshot & Legacy Compatibility

1. **1 Real Monetary Event = 1 Receipt**:
   - Receipt is linked to `CombinedPaymentGroup`.
   - `snapshotData` contains all items and total amount.
2. **Immutability & Legacy Compatibility**:
   - Never reconstruct historical receipts from current `BillItems`.
   - If a legacy receipt lacks granular items, display the summary with note: `ไม่พบรายละเอียดรายการของใบเสร็จเดิม`.
   - Legacy bills with unallocated historical paid amounts show: `ไม่สามารถระบุการจัดสรรยอดที่ชำระแล้วรายรายการจากข้อมูลเดิมได้`.

---

## 9. Concurrency & Locking Model

1. **Deterministic Lock Ordering**:
   - Sort affected `billId` array in lexicographical order: `[...new Set(billIds)].sort()`.
   - Acquire `SELECT id FROM bills WHERE id = ... FOR UPDATE` sequentially to prevent deadlocks.
2. **Re-Read Under Lock**:
   - Re-evaluate balances and existing payments inside the lock.
   - Reconcile allocation sums against database state.
3. **Idempotency Guard**:
   - Retried requests return the previously committed response without duplicating groups, allocations, payments, or receipts.

---

## 10. Test Impact & Verification Map

| Component | Tested Scenario | Test File |
| :--- | :--- | :--- |
| Allocation Engine | Oldest-first, monthly-before-deposit, item priority hierarchy | `tests/unit/owner-r38b-allocation-ledger.test.ts` |
| Overpayment Guard | `PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING` fail-closed | `tests/unit/owner-r38b-allocation-ledger.test.ts` |
| Cash Partial Authority | Server-time, authenticated receiver, partial status transition | `tests/integration/owner-r38b-api-partial-payment.test.ts` |
| Multi-Bill Slip Approval | 1 group, multiple allocations, 1 receipt with breakdown | `tests/integration/owner-r38b-api-partial-payment.test.ts` |
| Concurrency & Locking | 2 concurrent approvals on same multi-bill set serialize safely | `tests/integration/owner-r38b-api-partial-payment.test.ts` |
| Late-Fee Fairness | Timely partial freezes accrual; post-due partial stops future accrual | `tests/unit/owner-r38b-allocation-ledger.test.ts` |
| Meter Sequential Save | Immediate `snapshotVersion` update avoids false `STALE_VERSION` | `tests/unit/owner-r38b-allocation-ledger.test.ts` |
| Daily Stay Exclusion | `DAILY_STAY` omitted from monthly Issue All `dirtyRows` | `tests/unit/owner-r38b-allocation-ledger.test.ts` |
| Frontend Payments UI | Partial status badges, cash modal, canonical receipt binding | `src/tests/owner-payments-r37-production.test.tsx` |
