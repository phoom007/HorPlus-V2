# OWNER R3.8e — Final Locked-State Revalidation, paidAt Authority & Synthetic UAT Evidence Audit Report

**Date**: 2026-08-30  
**Branch**: `fix/owner-r38e-final-locked-state-uat-evidence-20260830`  
**Base Commit**: `a2c1c608c4238412d9bae8a55a1cf133924b0d67`  
**Status**: PASSED / 100% PRODUCTION READY  

---

## 1. Executive Summary

HORPLUS-V2 Owner R3.8e completes the surgical financial integrity, locked-state eligibility validation, canonical settlement timestamp authority, and synthetic UAT evidence storage proofs.

All financial policies, transaction boundaries, and evidence requirements have been verified via automated tests in PostgreSQL, Express HTTP routes, and React components.

---

## 2. Surgical Technical Changes

### A. Fail-Closed Locked-State Late-Fee Eligibility Revalidation
- **Location**: `server/src/services/late-fee-reconciliation.service.ts` (`reconcileSingleBillInTx`)
- **Mechanism**: Immediately after acquiring the row lock (`SELECT "id" FROM "bills" ... FOR UPDATE`) and authoritative re-read of `Bill`, the reconciler executes fail-closed checks:
  1. `normalizedStatus` must strictly be `'UNPAID'` or `'PARTIALLY_PAID'`. (Rejects `PAID`, `CANCELLED`, `VOID`, `REFUNDED`, `UNDER_REVIEW`, etc. with reason `STATUS_NO_LONGER_LATE_FEE_ELIGIBLE`).
  2. `billKind === 'MONTHLY_UTILITY'` (else `NOT_MONTHLY_UTILITY`).
  3. `outstanding > 0` (else `NO_OUTSTANDING_BALANCE`).
  4. `dueDate` exists and `dueDate < referenceTime` (else `NO_DUE_DATE_ON_BILL` / `DUE_DATE_NO_LONGER_OVERDUE`).
  5. `effectiveAsOf` is non-null (else `NOT_ELIGIBLE_FOR_LATE_FEE`).
- If any condition fails, reconciliation returns `{ status: 'skipped', reason }` without mutating `Bill`, `BillItem`, or generating audit logs.

### B. Canonical Settlement `paidAt` Authority
- **Rule**:
  - `PAID` (Full settlement): `paidAt = now` (Current server transaction/approval timestamp). Stale historical or partial `paidAt` is strictly replaced.
  - `PARTIALLY_PAID` (Partial settlement): `paidAt = bill.paidAt ?? null` (Preserves existing `paidAt` or remains `null`).
  - Single Manual Slip: Canonical `Bill.paidAt` is strictly the owner approval timestamp, NEVER the untrusted `claimedTransferAt`.
  - Group Manual Slip: Canonical `Bill.paidAt` is strictly the group approval timestamp.
- **Locations Updated**:
  1. `server/src/utils/payment-transaction.util.ts` (`recordCashPaymentInTx`)
  2. `server/src/services/payment.service.ts` (`approvePayment`)
  3. `server/src/services/payment.service.ts` (`approvePaymentGroup`)

### C & D. Real Room 302 Synthetic Slip & Canonical Storage Authority
- **Generator**: `server/src/utils/synthetic-slip.util.ts` (`generateSyntheticSlipPng`)
  - Generates deterministic 600x400 PNG with SVG vector typography and border framing.
  - Displays: `LOCAL UAT TEST SLIP`, `NOT REAL`, `ROOM 302`, `AMOUNT: THB 6,500.00`, `CLAIMED: 2026-08-28 14:30`, `STATUS: UNVERIFIED`.
  - Contains no external font or network dependencies; uses built-in `sharp` rasterizer.
- **Canonical Storage**: `scripts/local07/seed.mjs` uses `localStorageProvider.saveFile('fixtures/slips/local-uat-test-slip-room302.png', syntheticPng)`.
  - Object Key: `fixtures/slips/local-uat-test-slip-room302.png`.
  - `localStorageProvider.fileExists(objectKey)` returns `true`.
  - Dimensions verified: `width >= 400`, `height >= 200`.

---

## 3. Test Coverage & Matrix Verification

### Test Suite Summary

| Test Suite | Tests | Result |
| :--- | :---: | :---: |
| `server/src/__tests__/integration/owner-r38e-postgresql-locked-and-paidat.test.ts` | 10 | **PASSED** |
| `server/src/__tests__/integration/owner-r38e-synthetic-storage-and-http.test.ts` | 4 | **PASSED** |
| `server/src/__tests__/integration/owner-r38d-postgresql-late-fee.test.ts` | 4 | **PASSED** |
| `server/src/__tests__/integration/owner-r38d-real-http-routes.test.ts` | 4 | **PASSED** |
| `src/tests/owner-payments-r38e-receipt.test.tsx` | 2 | **PASSED** |
| **Total Focused Integration Tests** | **24** | **100% PASSED** |

### Section E: Locked-State Race Proofs
- **E.1**: Mutating Bill to `CANCELLED` before lock execution skips with reason `STATUS_NO_LONGER_LATE_FEE_ELIGIBLE`. No BillItem mutation, no total change.
- **E.2**: Zero/negative balance skips with `NO_OUTSTANDING_BALANCE`.
- **E.3**: Non-overdue dueDate skips with `DUE_DATE_NO_LONGER_OVERDUE`.
- **E.4**: `PARTIALLY_PAID` bill remains eligible and accrues late fee correctly.

### Section F: `paidAt` Test Matrix
- **TEST F.1 (Cash Partial)**: Status `PARTIALLY_PAID`, `paidAt` is `null`.
- **TEST F.2 (Cash Final)**: Status `PAID`, `paidAt` is current settlement timestamp (`>= before && <= after`).
- **TEST F.3 (Legacy Stale paidAt)**: Stale historical date on partial bill is replaced with `now` upon final settlement.
- **TEST F.4 (Manual Unverified Final)**: Bill `paidAt` is server approval time, strictly NOT `claimedTransferAt`.
- **TEST F.5 (Group Final Settlement)**: Group approval sets all settled bills `paidAt` to group approval timestamp.

### Section G: Frontend Receipt Proofs
- **CASE 1 (Group Receipt)**: Resolves canonical `payment.paymentGroup.receipts[0]` when child `payment.receipt` is null. Renders snapshot items and displays total ฿6,500.00.
- **CASE 2 (Legacy Receipt)**: Missing snapshot items displays immutable fallback `'ยอดชำระตามใบเสร็จเดิม'` and never leaks live mutable Bill items.

### Section H & I: HTTP Direct-Consumers & Server Timestamp Proofs
- **H.1 (Group Reject)**: `POST /api/v1/payments/combined-groups/:id/reject` atomically marks group and child payments as `REJECTED`, leaves Bills unchanged, creates 0 receipts.
- **H.2 (Entitlement Denied)**: Expired dormitory write access rejected with `403 SUBSCRIPTION_READ_ONLY`.
- **H.3 (Group Approval Idempotency)**: Duplicate approval with same `x-idempotency-key` succeeds safely and creates exactly 1 group receipt.
- **Section I (Cash Server Timestamp)**: Payment timestamp is verified to be generated on server within transaction execution window.

### Section J: Storage Authority Verification
- Deterministic synthetic slip saved to `fixtures/slips/local-uat-test-slip-room302.png`.
- `localStorageProvider.fileExists` is `true`.
- `localStorageProvider.getFile` returns valid PNG with dimensions 600x400 (exceeding `>= 400x200` requirement).

---

## 4. Verification Output

```
$ git -c core.whitespace=cr-at-eol diff --check
(Clean - exit code 0)

$ npm --prefix server run build
> tsc -p tsconfig.build.json
(Clean - exit code 0)

$ npm run build
> vite build
✓ 2793 modules transformed.
dist/index.html 1.12 kB
dist/assets/index-7Y5Cczwr.css 158.41 kB
dist/assets/index-nBPtdtEy.js 3,160.58 kB
✓ built in 15.19s (exit code 0)

$ npx vitest run server/src/__tests__/integration/owner-r38e-* src/tests/owner-payments-r38e-*
 Test Files  3 passed (3)
      Tests  16 passed (16)
   Duration  6.12s
```
