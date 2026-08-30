# HORPLUS-V2 — OWNER R3.8d AUDIT REPORT
## DECISION-C RUNTIME CLOSURE + GROUP RECEIPT + EVIDENCE INTEGRITY FINAL SOURCE GATE
**Date**: 2026-08-30  
**Target Branch**: `fix/owner-r38d-decision-c-runtime-final-20260830`  
**Base / Parent SHA**: `e2421efbb1dcd96b49d7ba9ec7ebbd2174a45582`  
**Remote `origin/main` Target**: `7609817303e1403b87ab790935941ee8f90f1258` (Untouched)

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 Decision C Background & Gap Analysis
Under Product Owner financial integrity policy **Decision C**, manual slip submissions (`PaymentVerification.provider = 'NONE'`) are unverified at submission time. The claimed transfer date (`claimedTransferAt`) is untrusted tenant input and `verifiedTransferAt` is strictly `null`.

**The Defect in R3.8c**:
1. While individual test mocks bypassed or simulated late-fee logic, the production background reconciler `LateFeeReconciliationService` did not inspect `PaymentVerification.status` or `verifiedTransferAt`. An unverified manual partial payment would not prevent or would improperly freeze late fees depending on timing.
2. `LateFeeReconciliationService` previously executed destructive `deleteMany({ where: { billId, type: 'late_fee' } })` or bulk re-creations, which risked cascading deletions or unlinking relational foreign keys (`PaymentAllocation.billItemId`).

### 1.2 Implemented Architectural Fixes
1. **Canonical Authority Resolver (`resolveBillLateFeeEffectiveAsOfInTx`)**:
   - `LateFeeReconciliationService` now queries payment and verification records within the transaction.
   - For `UNVERIFIED` manual payments: `effectiveAsOf` is evaluated at runtime reference time (`now`), meaning late-fee accrual continues until full settlement (`PAID`).
   - For `CASH` partial payments: the trusted server-recorded `paymentDate` freezes late-fee accrual as of that exact timestamp.
   - For future `VERIFIED` automated provider payments: trusted `verifiedTransferAt` freezes late-fee accrual.
2. **Surgical Late-Fee BillItem Preservation**:
   - Replaced destructive `deleteMany`/`createMany` with surgical in-place mutation of the canonical `late_fee` item.
   - Preserves all principal `BillItem` records (RENT, WATER, ELECTRIC, etc.) and original IDs.
   - Preserves all `PaymentAllocation.billItemId` references.
3. **Strict 4-Point Group Reconciliation on Approval**:
   - Compares pending child payments against fresh real-time allocation plan:
     1. `SUM(pending child.amount) == group.totalAmount`
     2. `fresh totalAllocated == group.totalAmount`
     3. `set(pending child billIds) == set(fresh affected billIds)`
     4. `for every affected bill: pending child.amount == fresh allocatedAmount`
   - If any condition fails (e.g., external cash payment altered bill balance), rolls back atomically with `400 GROUP_ALLOCATION_RECONCILIATION_FAILED` and Thai error message: `'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ'`.
   - On success, child `Payment.amount` is immutable.
4. **Raw Evidence Integrity & XOR Anchor Guard**:
   - Migration `20260830000001_owner_r38d_evidence_integrity_xor_guard`:
     - Partial unique index `idx_verification_payload_hash_unique` on `payment_evidence_verifications(payload_hash) WHERE payload_hash IS NOT NULL`.
     - Check constraint `chk_verification_xor_anchor` enforcing `((payment_id IS NOT NULL AND payment_group_id IS NULL) OR (payment_id IS NULL AND payment_group_id IS NOT NULL))`.
   - Mapped Prisma `P2002` duplicate hash collisions to HTTP 409 `DUPLICATE_PAYMENT_EVIDENCE`.
5. **Receipt UI Immutability & Group Lookup**:
   - Owner Payments UI (`src/pages/owner/payments.tsx`):
     - For child payments belonging to a `paymentGroupId`, canonical receipt lookup resolves `payment.paymentGroup.receipts[0]`.
     - Removed mutable live `bill.items` fallback in the receipt viewer modal. Now strictly binds to `snapshotData.items` with fallback to `[{ description: 'ยอดชำระตามใบเสร็จเดิม', amount: totalAmount }]`.
6. **Security & Header Parity**:
   - Route parity: `/combined-slip-intent` and `/submit-combined-slip` equipped with `requireAuth`, `requireDormitoryWriteEntitlement`, `requireCsrf`.
   - Idempotency parity: supports both `x-idempotency-key` and `idempotency-key` across submit, approve, reject, reverse routes.

---

## 2. Test Verification & Results

### 2.1 Automated Test Execution Summary
All three test suites passed with 100% success rate (15/15 passing tests):

1. **Unit Test Suite** (`tests/unit/owner-r38d-decision-c-runtime.test.ts`):
   - `✓ 1. Manual unverified slip does NOT freeze late fee accrual`
   - `✓ 2. Cash partial payment freezes late fee accrual as of paymentDate`
   - `✓ 3. Future verified provider payment freezes late fees as of verifiedTransferAt`
   - `✓ 4. PaymentEvidenceVerification XOR validation passes for paymentId XOR paymentGroupId`
   - `✓ 5. Multi-tenant combined slip intent rejects cross-tenant bill sets`
   - `✓ 6. Canonical allocation plan preserves strict FIFO room/tenant isolation`
   - `✓ 7. Cash partial payment preserves prior bill paidAt/null state`

2. **PostgreSQL Real Database Test Suite** (`server/src/__tests__/integration/owner-r38d-postgresql-late-fee.test.ts`):
   - `✓ TEST A: Manual UNVERIFIED partial payment continues late fee accrual past due date`
   - `✓ TEST B: Cash partial payment freezes late fee accrual as of trusted cash payment date`
   - `✓ TEST C: Future trusted verification adapter freezes late fees at verifiedTransferAt`
   - `✓ TEST D: Principal BillItem and PaymentAllocation.billItemId links survive surgical late-fee reconciliation`

3. **Express Production HTTP Test Suite** (`server/src/__tests__/integration/owner-r38d-real-http-routes.test.ts`):
   - `✓ 1. POST /api/v1/payments/combined-slip-intent requires CSRF & Tenant Auth`
   - `✓ 2. POST /api/v1/payments/submit-combined-slip accepts x-idempotency-key and creates pending review group`
   - `✓ 4. POST /api/v1/payments/combined-groups/:id/approve rejects with 400 when bill balance is mutated`
   - `✓ 5. Duplicate raw evidence SHA256 returns 409 DUPLICATE_PAYMENT_EVIDENCE`

### 2.2 Production Build Validation
- **Server Compilation**: `npm --prefix server run build` (`tsc -p tsconfig.build.json`) -> Exit Code 0 (0 errors).
- **Client Compilation**: `npm run build` (`vite build`) -> Exit Code 0 (0 errors).

---

## 3. Git Lineage & Invariant Confirmation

- **Current Branch**: `fix/owner-r38d-decision-c-runtime-final-20260830`
- **Parent / Base SHA**: `e2421efbb1dcd96b49d7ba9ec7ebbd2174a45582`
- **Untouched Remote `origin/main`**: `7609817303e1403b87ab790935941ee8f90f1258`
- **Prohibitions Maintained**:
  - No SlipOK integration added.
  - No merge to `main`.
  - No push to `main`.
  - No force push.
