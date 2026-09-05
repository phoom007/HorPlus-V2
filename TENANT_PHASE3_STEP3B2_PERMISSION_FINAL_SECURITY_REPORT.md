# HORPLUS-V2 — TENANT PHASE 3 STEP 3B.2 / 3B.2A
# OWNER TENANT API PERMISSION & FINAL SECURITY CLOSURE REPORT
## DIFF CLEANUP & SINGLE PERMISSION AUTHORITY CORRECTION

- **Branch**: `review/tenant-ui-baseline-20260904`
- **Committed Baseline SHA**: `42003e2a60141c4a487cb89e4274d56875efd143`
- **Mode**: CORRECTION — BACKEND / TEST ONLY (Zero UI Changes)
- **Status**: COMPLETE & VERIFIED

---

## 1. Executive Summary

Tenant Phase 3 Step 3B.2A cleanly resolves all EOL/CRLF diff churn and establishes a single, unambiguous permission authority architecture for the Owner Tenant domain.

1. **EOL Churn Eliminated**: All repository files now strictly conform to their committed line-ending conventions (`i/lf w/lf` for LF files, `i/crlf w/crlf` for CRLF files). `git diff --check` passes with zero warnings or errors.
2. **Single Permission Authority Architecture**:
   - `context.permissions` resolved by `resolveAuthoritativeDormitoryContext()` is now the sole runtime permission authority.
   - `requireDormitoryPermission()` in `permission.ts` has been stripped of direct role checks and restored to a purely generic permission checker.
   - A centralized Tenant-domain role normalization policy in `resolveAuthoritativeDormitoryContext()` guarantees compatibility for legacy MANAGER records, enforces read-only lockdown for STAFF (stripping contaminated mutations), and strips all Owner Tenant permissions for TENANT.
   - Top-level defense-in-depth guard in `tenant.routes.ts` remains purely as a non-granting deny guard for `roleCode === 'TENANT'`.
3. **Zero Production Middleware Weakening**: Reverted test-only bypass in `require-dormitory.ts`. Tests now supply a valid minimal Prisma stub rather than compromising production code.
4. **Tenant Portal Status**: Reported truthfully as `TENANT PORTAL REGRESSION PROOF PENDING` rather than claiming validation via stub routers.
5. **Report & Test Alignment**: Explicitly corrected previous test count transcription error (actual counts: `step1-adapter` = 15 tests, `step2-api-adapter` = 7 tests). All 124 regression tests across 8 test suites pass cleanly.

---

## 2. Single Permission Authority Architecture

The system now enforces a clean, single-pipeline permission flow:

```
Persisted / Default Role Permissions (Role Repository)
                 ↓
resolveAuthoritativeDormitoryContext()
                 ↓
Centralized Tenant-Domain Role Normalization Policy
                 ↓
context.permissions (Authoritative Runtime Permission Authority)
                 ↓
generic requireDormitoryPermission() (Pure Permission Check)
                 ↓
Route Handler (Owner Tenant API)
```

### 2.1 Role Defaults (`role.repository.ts`)
- **MANAGER**: System role default updated to include full Tenant authority:
  `tenants: ['view', 'create', 'update', 'archive', 'document:read', 'document:write']`
- **STAFF**: System role default remains read-only:
  `tenants: ['view']`
- **OWNER**: Existing global wildcard `*` retained.
- **TENANT**: Does not receive Owner Tenant-management permissions.

### 2.2 Centralized Tenant-Domain Role Normalization (`dormitory-context.ts`)
`resolveAuthoritativeDormitoryContext()` is the **only** location that evaluates `roleCode` to adjust Tenant-domain permissions:
- **MANAGER**: Ensures the resolved permission set contains all 6 canonical Tenant capabilities (`tenants:view`, `tenants:create`, `tenants:update`, `tenants:archive`, `tenants:document:read`, `tenants:document:write` and singular aliases).
- **STAFF**: Strips all Tenant-domain mutation and document permissions (`tenants:create`, `tenants:update`, `tenants:archive`, `tenants:document:read`, `tenants:document:write`, `tenant:write`, etc.) from the resolved set, retaining exclusively `tenants:view` (and `tenant:view`).
- **TENANT**: Strips all Owner Tenant-management permissions (`tenants:*` and `tenant:*`).
- **OWNER**: Unchanged, preserves wildcard `*`.
- **Scope**: Applied strictly to the Tenant domain; non-tenant resources (Rooms, Meters, Contracts, Billing, Maintenance, etc.) are 100% unaffected.

### 2.3 Generic Permission Checker (`permission.ts`)
`requireDormitoryPermission()` is restored to a pure generic permission checker:
- Direct role checks (`roleCode === 'MANAGER'`, `roleCode === 'STAFF'`, `roleCode === 'TENANT'`) are **completely removed**.
- Preserves:
  - OWNER global wildcard shortcut (`roleCode === 'OWNER'`).
  - Wildcard permission check (`*`).
  - Exact permission matching (`normalizedPerms.includes(requiredPermission)`).
  - Domain wildcard matching (`normalizedPerms.includes(`${domain}:*`)`).
  - Generic backwards-compatibility aliases (`tenants:view` <-> `tenant:read`, and legacy write alias for non-staff).
- Result:
  - MANAGER is allowed because `context.permissions` contains the required permissions.
  - STAFF is denied mutations (403) because `context.permissions` does not contain them.
  - TENANT is denied (403) because `context.permissions` contains no Owner Tenant permissions.

### 2.4 Defense-in-Depth Router Guard (`tenant.routes.ts`)
The top-level router guard for `roleCode === 'TENANT'` in `tenant.routes.ts` acts strictly as defense-in-depth:
- It **only denies** (403 Forbidden).
- It never grants, injects, or modifies permissions.

---

## 3. Production Middleware Integrity & Reversion

The production middleware `createRequireActiveDormitoryMiddleware` in `server/src/middleware/require-dormitory.ts`:
- Reverted the test-only bypass `if (!prisma || !prisma.dormitory) return next();`.
- Production middleware remains 100% untouched against baseline `42003e2a60141c4a487cb89e4274d56875efd143` (`ZERO DIFF`).
- Integration tests in `src/tests/tenant-phase3-step3b2-permission-security.test.ts` supply a minimal valid Prisma stub to satisfy the production middleware contract:
  ```ts
  const mockPrisma: any = {
    dormitory: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === dormAId) return { id: dormAId, name: 'Dormitory A', status: 'active', deletedAt: null };
        if (where.id === dormBId) return { id: dormBId, name: 'Dormitory B', status: 'active', deletedAt: null };
        return null;
      },
    },
  };
  const requireActiveDormitory = createRequireActiveDormitoryMiddleware(mockPrisma);
  ```

---

## 4. DTO Hardening & Terminology Audit

All properties in `server/src/mappers/tenant-api.mapper.ts` were audited against canonical database models:
- **`SafeEmergencyContactApiDTO`**: Includes `isPrimary: boolean`.
- **`SafeBillApiDTO`**: Uses canonical `billNumber` (NOT fictional `invoiceNumber`), `billingDate`, `dueDate`, `subtotal`, `discountAmount`, `fineAmount`, `totalAmount`, `paidAmount`, `outstandingAmount`.
- **`SafeSettlementApiDTO`**: Uses canonical `depositAmount`, `unpaidBillAmount`, `damageChargeTotal`, `netSettlement`, `settlementDirection`, `settlementStatus`. Strictly eliminates PromptPay IDs, bank accounts, refund transactions, and payment provider secrets.
- **`SafeRoomSummaryApiDTO`**, **`SafeContractApiDTO`**, **`SafeOccupancyApiDTO`**, **`SafeDailyStayApiDTO`**: Whitelist-mapped, strictly stripping signatures, raw lock codes, and operator actor IDs.

---

## 5. Tenant Portal Status

- **Tenant Portal Integration**: **`TENANT PORTAL REGRESSION PROOF PENDING`**
- The fake portal router stub previously present in the test file has been removed. No claim is made regarding full Tenant Portal verification until an authenticated production portal suite is exercised.
- Hard deny for TENANT on all `/api/v1/tenants/**` routes is independently verified and passes.

---

## 6. Test Suite & Report Alignment

### 6.1 Transcription Discrepancy Correction
- The previous Step 3B.2 report summary table contained a typographical transcription error (14 and 8).
- The actual unchanged test counts are:
  - `src/tests/tenant-phase2-step1-adapter.test.ts`: **15 tests**
  - `src/tests/tenant-phase3-step2-api-adapter.test.ts`: **7 tests**
- Neither existing test file was modified during Step 3B.2 or Step 3B.2A.

### 6.2 Full Regression Execution (124 / 124 Passed across 8 Suites)
```
 ✓ src/tests/tenant-phase2-step1-adapter.test.ts (15 tests)
 ✓ src/tests/tenant-phase2-step2-quickadd.test.tsx (10 tests)
 ✓ src/tests/tenant-phase2-step3-registration.test.tsx (9 tests)
 ✓ src/tests/tenant-phase2-step4-domain-correction.test.tsx (7 tests)
 ✓ src/tests/tenant-phase3-step2-api-adapter.test.ts (7 tests)
 ✓ src/tests/tenant-phase3-step3b-persistence-security.test.ts (31 tests)
 ✓ src/tests/tenant-phase3-step3b2-permission-security.test.ts (43 tests)
 ✓ src/tests/tenantFailClosed.test.ts (2 tests)

Test Files  8 passed (8)
     Tests  124 passed (124)
```

### 6.3 Dedicated Step 3B.2A Verification Tests (Section 9 in test suite)
1. **PART 15**: Resolves MANAGER context with all 6 canonical Tenant capabilities in `context.permissions`.
2. **PART 15**: Resolves STAFF context with `tenants:view` and NO mutation/document capabilities in `context.permissions`.
3. **PART 15**: Resolves TENANT context with ZERO Owner Tenant permissions in `context.permissions`.
4. **PART 16**: Grants full authority to legacy MANAGER role in DB intentionally lacking `archive` & `document:write`; verifies HTTP archive succeeds (200).
5. **PART 17**: Strips mutation & doc permissions from contaminated STAFF role in DB, leaving only `tenants:view`; verifies HTTP mutation is rejected (403).
6. **PART 18**: Strips all Owner Tenant permissions from contaminated TENANT role in DB, leaving zero surviving permissions; verifies HTTP access is rejected (403).

---

## 7. Protected Files Audit (Zero Changes)

The 10 protected targets have **ZERO DIFF** against baseline:

| Protected Target | Diff Status |
|---|:---:|
| `server/prisma/schema.prisma` | **ZERO DIFF** |
| `server/prisma/migrations/**` | **ZERO DIFF** |
| `src/pages/owner/tenants.tsx` | **ZERO DIFF** |
| `src/pages/owner.tsx` | **ZERO DIFF** |
| `src/pages/owner/contracts.tsx` | **ZERO DIFF** |
| `src/pages/owner/rooms.tsx` | **ZERO DIFF** |
| `src/pages/owner/meters.tsx` | **ZERO DIFF** |
| `src/components/tenant/TenantRegisterView.tsx` | **ZERO DIFF** |
| `src/pages/tenant/TenantRegisterPage.tsx` | **ZERO DIFF** |
| `src/pages/tenant.tsx` | **ZERO DIFF** |

---

## 8. Final Git State & Line Ending Audit

### 8.1 `git ls-files --eol` Output
```
i/lf    w/lf    attr/                 	server/src/db/repositories/role.repository.ts
i/lf    w/lf    attr/                 	server/src/mappers/tenant-api.mapper.ts
i/lf    w/lf    attr/                 	server/src/middleware/dormitory-context.ts
i/lf    w/lf    attr/                 	server/src/middleware/permission.ts
i/lf    w/lf    attr/                 	server/src/middleware/require-dormitory.ts
i/crlf  w/crlf  attr/                 	server/src/routes/tenant.routes.ts
```

### 8.2 `git status --short`
```
 M server/src/db/repositories/role.repository.ts
 M server/src/mappers/tenant-api.mapper.ts
 M server/src/middleware/dormitory-context.ts
 M server/src/middleware/permission.ts
 M server/src/routes/tenant.routes.ts
?? TENANT_PHASE3_STEP3B2_PERMISSION_FINAL_SECURITY_REPORT.md
?? src/tests/tenant-phase3-step3b2-permission-security.test.ts
```
*(Note: `server/src/middleware/require-dormitory.ts` has ZERO diff and is not modified).*

### 8.3 `git diff --stat`
```
 server/src/db/repositories/role.repository.ts |   2 +-
 server/src/mappers/tenant-api.mapper.ts       | 449 +++++++++++++++++++++++++-
 server/src/middleware/dormitory-context.ts    |  43 ++-
 server/src/middleware/permission.ts           |  16 +
 server/src/routes/tenant.routes.ts            | 124 +++++--
 5 files changed, 593 insertions(+), 41 deletions(-)
```

### 8.4 `git diff --ignore-space-at-eol --stat`
```
 server/src/db/repositories/role.repository.ts |   2 +-
 server/src/mappers/tenant-api.mapper.ts       | 449 +++++++++++++++++++++++++-
 server/src/middleware/dormitory-context.ts    |  43 ++-
 server/src/middleware/permission.ts           |  16 +
 server/src/routes/tenant.routes.ts            | 124 +++++--
 5 files changed, 593 insertions(+), 41 deletions(-)
```

### 8.5 `git diff --numstat`
```
1	1	server/src/db/repositories/role.repository.ts
437	12	server/src/mappers/tenant-api.mapper.ts
42	1	server/src/middleware/dormitory-context.ts
16	0	server/src/middleware/permission.ts
97	27	server/src/routes/tenant.routes.ts
```

### 8.6 `git diff --check`
```
(Exit code 0 — Clean: 0 errors, 0 trailing whitespace warnings)
```

---

## 9. Build Verification

- **Backend**: `npm --prefix server run build` → **SUCCESS** (Exit code 0, `tsc` passed with zero errors).
- **Frontend**: `npm run build` → **SUCCESS** (Exit code 0, `vite build` passed cleanly).

---

TENANT PHASE 3 STEP 3B.2A CLEANUP COMPLETE — DIFF CLEAN, SINGLE TENANT PERMISSION AUTHORITY ESTABLISHED — WAITING FOR PRODUCT OWNER / CHATGPT REVIEW.
