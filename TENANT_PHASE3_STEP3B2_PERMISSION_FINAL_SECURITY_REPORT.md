# HORPLUS-V2 — TENANT PHASE 3 STEP 3B.2 / 3B.2A / 3B.2B / 3B.2C / 3B.2D
# OWNER TENANT API PERMISSION & FINAL SECURITY CLOSURE REPORT
## FAIL-CLOSED TENANCY & EXPLICIT AGGREGATE CONTRACT FINALIZATION

- **Branch**: `review/tenant-ui-baseline-20260904`
- **Committed Baseline SHA**: `e9e702f9364564595c5fb3bea96c82f456386cec`
- **Mode**: BACKEND / TEST ONLY (Zero UI Changes, Zero Schema Changes, Zero Migrations)
- **Status**: COMPLETE & VERIFIED

---

## 1. Executive Summary

Tenant Phase 3 Step 3B.2D finalizes the remaining pre-commit integrity requirements, removes all error swallowing across the tenancy verification and aggregation layers, establishes one unambiguous contract for `TenantAggregateDataSource`, reconciles the repository-wide constructor audit, and verifies the full regression suite:

1. **Fail-Closed Tenancy Verification (`verifyActiveTenancy`)**:
   - `contractRepo.findAll` authoritative query error: Fails closed immediately (no `try/catch` swallowing). Throws internal server error; HTTP route returns `500 TENANT_OPERATION_FAILED` with zero internal detail leakage.
   - `aggregatePrisma.occupancy.findFirst` authoritative query error: Fails closed immediately. Throws internal server error; HTTP route returns `500 TENANT_OPERATION_FAILED` with zero internal detail leakage.
   - Successful queries + no active tenancy: Only then returns `403 NO_ACTIVE_TENANCY`.
2. **Single Unambiguous Contract (`TenantAggregateDataSource`)**:
   - Established one canonical contract where all five aggregate delegates (`contract`, `occupancy`, `dailyStay`, `bill`, `contractSettlement`) are required (no optional `?`).
   - `getTenantDetails` executes all required aggregate queries without skipping domains when `aggregatePrisma` is injected, and fails closed on query rejections.
3. **Explicit Dependency Boundary**:
   - `TenantService` uses `const prisma = this.aggregatePrisma ?? null;`.
   - Never introspects repository private implementations (`(this.tenantRepo as any).prisma`).
   - Does not use `getPrismaClient()`, `isUuid(...)`, or environment heuristics.
4. **Reconciled Constructor Call Sites**:
   - Raw repository search confirms exactly **17** `new TenantService(` constructor calls across the entire codebase.
   - Exactly **1** is production (`server/src/app.ts:126`), **0** in-memory/demo runtimes outside tests, and **16** in automated test suites.
5. **Canonical Aggregate DTOs Preserved (Step 3B.2B)**:
   - Payment: `method`, `paymentDate`.
   - Receipt: `receiptNumber`, `receiptKind`, `isVoided`, `issuedAt`.
   - DailyStayInvoice: `totalAgreedAmount`, `outstandingAmount`, `depositDeclaredStatus`.
   - Contract: `depositStatus` and `depositType` strictly omitted.
6. **Role Permission Matrix Preserved (Step 3B.2B)**:
   - OWNER: Global authority.
   - MANAGER: Full Tenant domain only.
   - STAFF: Tenant read-only.
   - TENANT: Hard-blocked from Owner Tenant APIs (403 `FORBIDDEN`).
   - Non-OWNER global `*` stripped in `resolveAuthoritativeDormitoryContext`.
7. **Regression Tests (136 / 136 Passed across 8 Suites)**:
   - All tests pass cleanly without errors or skips.
8. **Build Verification**:
   - Backend TypeScript (`npm --prefix server run build`): Exit code 0 (0 errors).
   - Frontend Vite (`npm run build`): Exit code 0 (0 errors, built in 26.77s).
9. **Zero Diff on Protected Files**:
   - Zero changes to all 8 UI files, Prisma schema, and migrations.
10. **Pre-Commit Diff & EOL Integrity**:
    - `git diff --check` passes cleanly (exit code 0).
    - Line endings strictly match baseline (`tenant.service.ts` is `i/crlf w/crlf`; all other modified files are `i/lf w/lf`).

---

## 2. Explicit Aggregate Authority & Fail-Closed Architecture

### 2.1 One Exact Contract (`TenantAggregateDataSource`)
In `server/src/services/tenant.service.ts`:
```ts
export interface TenantAggregateDataSource {
  contract: {
    findMany(args: any): Promise<any[]>;
  };
  occupancy: {
    findMany(args: any): Promise<any[]>;
    findFirst(args: any): Promise<any | null>;
  };
  dailyStay: {
    findMany(args: any): Promise<any[]>;
  };
  bill: {
    findMany(args: any): Promise<any[]>;
  };
  contractSettlement: {
    findMany(args: any): Promise<any[]>;
  };
}
```
All delegates are required. Missing delegates or configuration errors fail visibly instead of silently degrading into empty arrays.

### 2.2 Fail-Closed `verifyActiveTenancy`
In `server/src/services/tenant.service.ts`:
```ts
  public async verifyActiveTenancy(dormitoryId: string, tenantId: string) {
    // 1. Check active contracts using contractRepo (supports both in-memory and prisma adapters)
    const contractsRes = await this.contractRepo.findAll(dormitoryId, { tenantId, pageSize: 100 });
    const hasActiveContract = contractsRes.items.some((c) =>
      ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'].includes(c.status)
    );
    if (hasActiveContract) {
      return;
    }

    // 2. Check active occupancy using Prisma if explicit aggregate dependency is provided
    const prisma = this.aggregatePrisma ?? null;
    if (prisma) {
      const activeOccupancy = await prisma.occupancy.findFirst({
        where: {
          dormitoryId,
          tenantId,
          status: 'ACTIVE',
        },
      });
      if (activeOccupancy) {
        return;
      }
    }

    const err = new Error('ผู้เช่าไม่มีสัญญาหรือสถานะการพักอาศัยที่เปิดใช้งานอยู่');
    (err as any).code = 'NO_ACTIVE_TENANCY';
    (err as any).statusCode = 403;
    throw err;
  }
```

- **Contract repository failure**: Propagates immediately as an internal/server error. Over HTTP, returns `500 TENANT_OPERATION_FAILED`.
- **Occupancy query failure**: Propagates immediately as an internal/server error. Over HTTP, returns `500 TENANT_OPERATION_FAILED`.
- **Successful queries + no active tenancy**: Throws `NO_ACTIVE_TENANCY` (403). Over HTTP, returns `403 NO_ACTIVE_TENANCY`.

### 2.3 `getTenantDetails` Aggregate Execution
When `aggregatePrisma` is provided, `getTenantDetails` queries all 5 domains sequentially without skipping:
1. `prisma.contract.findMany(...)`
2. `prisma.occupancy.findMany(...)`
3. `prisma.dailyStay.findMany(...)`
4. `prisma.bill.findMany(...)`
5. `prisma.contractSettlement.findMany(...)`

If any authoritative query rejects, `TenantService` rejects and the route returns `500 TENANT_OPERATION_FAILED`. When `aggregatePrisma` is `undefined` (in-memory mode), zero Prisma calls are made (100% hermetic).

---

## 3. Production Composition (`server/src/app.ts`)

In `server/src/app.ts:126`:
```ts
const tenantService = new TenantService(
  tenantRepo,
  contractRepo,
  sensitiveFieldService,
  auditService,
  useInMemoryRepos ? undefined : (prisma ?? undefined)
);
```

- **Prisma mode (`useInMemoryRepos === false`)**: Injects the active `prisma` client instance as aggregate dependency.
- **In-memory mode (`useInMemoryRepos === true`)**: Passes `undefined`, ensuring hermetic in-memory behavior.

---

## 4. Reconciled Repository-Wide `new TenantService(` Audit

Raw repository search (`git grep -n -E "new TenantService\s*\("`) identified exactly **17** constructor invocations across all code files:

| # | File & Line | Classification | Description |
|---|---|---|---|
| 1 | `server/src/app.ts:126` | **A. Production** | Primary application wiring: injects `prisma` (or `undefined` in memory). |
| 2 | `server/tests/local01-tenant-onboarding-cooccupants.test.ts:45` | **C. Test Suite** | Backend integration test with in-memory repositories. |
| 3 | `src/tests/tenant-phase3-step2-api-adapter.test.ts:33` | **C. Test Suite** | Adapter integration test with in-memory repositories. |
| 4 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:201` | **C. Test Suite** | Direct service unit test (in-memory). |
| 5 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:303` | **C. Test Suite** | Direct service unit test (in-memory). |
| 6 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:361` | **C. Test Suite** | Direct service unit test (in-memory). |
| 7 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:412` | **C. Test Suite** | Direct service unit test (in-memory). |
| 8 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:893` | **C. Test Suite** | Direct service unit test (in-memory). |
| 9 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:938` | **C. Test Suite** | Direct service unit test (in-memory). |
| 10 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:1050` | **C. Test Suite** | Direct service unit test (in-memory). |
| 11 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:1148` | **C. Test Suite** | Hermetic aggregation test (in-memory, no Prisma). |
| 12 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:1183` | **C. Test Suite** | `getTenantDetails` fail-closed test (explicit mock Prisma). |
| 13 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:1208` | **C. Test Suite** | `verifyActiveTenancy` hermetic test (in-memory). |
| 14 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:1234` | **C. Test Suite** | `verifyActiveTenancy` contractRepo failure test (in-memory with spy). |
| 15 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:1282` | **C. Test Suite** | `verifyActiveTenancy` occupancy DB failure test (explicit mock Prisma). |
| 16 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts:1328` | **C. Test Suite** | `verifyActiveTenancy` normal negative test (explicit mock Prisma). |
| 17 | `src/tests/tenant-phase3-step3b2-permission-security.test.ts:133` | **C. Test Suite** | Permission matrix test suite with in-memory repositories. |

- **Total call sites**: 17
- **Production compositions**: 1 (`server/src/app.ts:126`)
- **In-memory/demo runtimes outside tests**: 0
- **Test suite constructions**: 16

---

## 5. Protected Files Audit (Zero Changes Confirmed)

All 10 protected targets verified untouched against baseline `e9e702f`:
- `src/pages/owner/tenants.tsx` — UNTOUCHED (Zero diff)
- `src/pages/owner.tsx` — UNTOUCHED (Zero diff)
- `src/pages/owner/contracts.tsx` — UNTOUCHED (Zero diff)
- `src/pages/owner/rooms.tsx` — UNTOUCHED (Zero diff)
- `src/pages/owner/meters.tsx` — UNTOUCHED (Zero diff)
- `src/components/tenant/TenantRegisterView.tsx` — UNTOUCHED (Zero diff)
- `src/pages/tenant/TenantRegisterPage.tsx` — UNTOUCHED (Zero diff)
- `src/pages/tenant.tsx` — UNTOUCHED (Zero diff)
- `server/prisma/schema.prisma` — UNTOUCHED (Zero diff)
- `server/prisma/migrations/**` — UNTOUCHED (Zero diff)

---

## 6. Automated Test Suite Results (136 / 136 Passed)

```
Test Files  8 passed (8)
     Tests  136 passed (136)
  Duration  9.18s
```

| # | Test Suite File | Tests | Status |
|---|---|---|---|
| 1 | `src/tests/tenant-phase2-step1-adapter.test.ts` | 15 / 15 | **PASSED** |
| 2 | `src/tests/tenant-phase2-step2-quickadd.test.tsx` | 10 / 10 | **PASSED** |
| 3 | `src/tests/tenant-phase2-step3-registration.test.tsx` | 9 / 9 | **PASSED** |
| 4 | `src/tests/tenant-phase2-step4-domain-correction.test.tsx` | 7 / 7 | **PASSED** |
| 5 | `src/tests/tenant-phase3-step2-api-adapter.test.ts` | 7 / 7 | **PASSED** |
| 6 | `src/tests/tenant-phase3-step3b-persistence-security.test.ts` | 36 / 36 | **PASSED** |
| 7 | `src/tests/tenant-phase3-step3b2-permission-security.test.ts` | 50 / 50 | **PASSED** |
| 8 | `src/tests/tenantFailClosed.test.ts` | 2 / 2 | **PASSED** |

---

## 7. Build Verification Results

1. **Backend TypeScript Build (`npm --prefix server run build`)**:
   - `tsc -p tsconfig.build.json`
   - Exit code: 0 (0 compilation errors)
2. **Frontend Vite Build (`npm run build`)**:
   - `vite build`
   - Exit code: 0 (2797 modules transformed, built in 26.77s)

---

## 8. Pre-Commit Diff Integrity Audit

### 8.1 `git status --short`
```
 M TENANT_PHASE3_STEP3B2_PERMISSION_FINAL_SECURITY_REPORT.md
 M server/src/app.ts
 M server/src/mappers/tenant-api.mapper.ts
 M server/src/middleware/dormitory-context.ts
 M server/src/services/tenant.service.ts
 M src/tests/tenant-phase3-step3b-persistence-security.test.ts
 M src/tests/tenant-phase3-step3b2-permission-security.test.ts
```

### 8.2 `git diff --stat`
```
 ...SE3_STEP3B2_PERMISSION_FINAL_SECURITY_REPORT.md | 347 +++++++++++----------
 server/src/app.ts                                  |   2 +-
 server/src/mappers/tenant-api.mapper.ts            |  38 +--
 server/src/middleware/dormitory-context.ts         |   5 +
 server/src/services/tenant.service.ts              | 166 +++++-----
 ...nant-phase3-step3b-persistence-security.test.ts | 213 ++++++++++++-
 ...nant-phase3-step3b2-permission-security.test.ts | 329 +++++++++++++++++++
 7 files changed, 826 insertions(+), 274 deletions(-)
```

### 8.3 `git diff --numstat`
```
184	163	TENANT_PHASE3_STEP3B2_PERMISSION_FINAL_SECURITY_REPORT.md
1	1	server/src/app.ts
19	19	server/src/mappers/tenant-api.mapper.ts
5	0	server/src/middleware/dormitory-context.ts
83	83	server/src/services/tenant.service.ts
205	8	src/tests/tenant-phase3-step3b-persistence-security.test.ts
329	0	src/tests/tenant-phase3-step3b2-permission-security.test.ts
```

### 8.4 `git diff --check`
```
# Clean exit (code 0) - zero whitespace or line-ending errors
```

### 8.5 Line Endings (`git ls-files --eol`)
```
i/lf    w/lf    attr/    TENANT_PHASE3_STEP3B2_PERMISSION_FINAL_SECURITY_REPORT.md
i/lf    w/lf    attr/    server/src/app.ts
i/lf    w/lf    attr/    server/src/mappers/tenant-api.mapper.ts
i/lf    w/lf    attr/    server/src/middleware/dormitory-context.ts
i/crlf  w/crlf  attr/    server/src/services/tenant.service.ts
i/lf    w/lf    attr/    src/tests/tenant-phase3-step3b-persistence-security.test.ts
i/lf    w/lf    attr/    src/tests/tenant-phase3-step3b2-permission-security.test.ts
```
*Zero EOL churn. `tenant.service.ts` strictly preserves `i/crlf w/crlf`; all other modified files strictly preserve `i/lf w/lf`.*

---

## 9. Tenant Portal Verification Status

**TENANT PORTAL REGRESSION PROOF PENDING**

*(Declared truthfully pending full end-to-end browser regression execution across the Tenant Portal surface).*
