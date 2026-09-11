# HORPLUS-V2 — TENANT PHASE 3 STEP 3B.1
# SECURITY & AUTHORITY CORRECTION REPORT

**Branch:** `review/tenant-ui-baseline-20260904`  
**Baseline SHA:** `5214d45981f33246a385b513b11daf2e0549686b`  
**Mode:** Implementation — Backend / Adapter / Test Correction Only (Zero UI Changes)  
**Status:** COMPLETE & FULLY VERIFIED  

---

## 1. Executive Summary

Tenant Phase 3 Step 3B.1 corrects the verified security, authority, and data integrity defects from Step 3B while maintaining strict non-regression of the Product Owner's authoritative UI, domain contracts, and database schema.

Key deliverables achieved:
1. **Eliminated Recursive Sensitive Data Leakage:** Replaced shallow denylist destructuring with pure, explicit whitelist DTO mappers (`toTenantApiDTO`, `toCoOccupantApiDTO`, `toEmergencyContactApiDTO`, `toVehicleApiDTO`, `toTenantDetailsApiDTO`). `nationalIdEncrypted`, `idCardObjectKey`, and `idCardUploadedByUserId` are never exposed in any API response.
2. **Hardened Multipart Middleware Ordering & Limits:** Route ordering now enforces authentication -> dormitory context resolution -> `tenant:write` permission -> dormitory write-entitlement **before** Multer single-file parsing. File parsing enforces single field `upload.single('file')`, max 5MB, 1 file limit, and canonical error codes (`FILE_TOO_LARGE`, `INVALID_FILE_FIELD`, `NO_FILE_UPLOADED`).
3. **Production-Driven Security Tests:** Security tests directly import and execute the actual backend mappers and exercise real Express HTTP routes with recursive tree assertions (`assertForbiddenKeyAbsent`), ensuring zero false confidence.
4. **Single-Authority Name Parsing:** Frontend adapters (`ApiTenantAdapter`) no longer perform destructive client-side token splitting; they transmit `displayName` intact. The backend `TenantService` is the sole authority for deriving `firstName` and `lastName` with word-boundary protections for Latin prefixes (preventing corruption of names such as `Drew` or `Mission`).
5. **Fail-Closed Database Aggregation:** Removed blanket `try/catch` error swallowing from `TenantService.getTenantDetails`. Authoritative database query failures immediately fail closed and return 500 `TENANT_OPERATION_FAILED` instead of presenting empty arrays.
6. **Required TenantDataSource Methods:** Made all 6 canonical profile methods required in `TenantDataSource` (removed `?`), fulfilled by both `ApiTenantAdapter` and `DemoTenantAdapter`.
7. **Protected File Preservation:** 100% verified ZERO diff across all 10 protected files.

---

## 2. Exact Changed Files

| File | Type | Description |
|------|------|-------------|
| `server/src/mappers/tenant-api.mapper.ts` | **NEW** | Pure safe response DTO mappers with strict field whitelisting for Tenant, CoOccupant, EmergencyContact, Vehicle, and TenantDetails. |
| `server/src/middleware/entitlement.ts` | **MODIFIED** | Updated `requireDormitoryWriteEntitlement` to reuse established `(req as any).dormitoryContext` to prevent redundant resolution. |
| `server/src/routes/tenant.routes.ts` | **MODIFIED** | Applied whitelist DTO mappers across all endpoints; reordered identity document upload middleware chain and hardened Multer limits. |
| `server/src/schemas/property-tenant-contract.schemas.ts` | **MODIFIED** | Refined `CreateTenantSchema` to allow single-field `displayName` or `firstName`. |
| `server/src/services/tenant.service.ts` | **MODIFIED** | Removed error-swallowing blanket `try/catch` in `getTenantDetails`; ensures database failures fail closed. |
| `server/src/utils/thai-identity.util.ts` | **MODIFIED** | Added word-boundary check for Latin honorifics (`Mr.`, `Mrs.`, `Ms.`, `Dr.`) to protect names beginning with prefix substrings. |
| `src/data/contracts/index.ts` | **MODIFIED** | Converted 6 profile methods from optional to required on `TenantDataSource`. |
| `src/data/adapters/api/index.ts` | **MODIFIED** | `addTenant` and `updateTenant` pass full user-entered name as `displayName` without frontend token splitting. |
| `src/tests/tenant-phase3-step3b-persistence-security.test.ts` | **MODIFIED** | Expanded to 31 comprehensive tests: production mapper tests, recursive absence assertions, HTTP route tests, multipart upload ordering/limits, DB fail-closed behavior, and name parsing. |

---

## 3. Detailed Architectural Corrections

### 3.1. Safe DTO Architecture & Nested Sensitive Data Protection
- **Pure Whitelist Mappers (`server/src/mappers/tenant-api.mapper.ts`):**
  - `toTenantApiDTO(tenant)`
  - `toCoOccupantApiDTO(co)`
  - `toEmergencyContactApiDTO(ec)`
  - `toVehicleApiDTO(v)`
  - `toTenantDetailsApiDTO(details)`
- **Eliminated Leakage Vectors:**
  - `nationalIdEncrypted`: Completely excluded from top-level tenant, nested `tenant.coOccupants[]`, standalone `coOccupants[]`, and `coOccupantHistory[]`.
  - `idCardObjectKey` & `idCardUploadedByUserId`: Excluded from all tenant profile and document upload responses.
  - Safe metadata exposed for document status: `hasIdentityDocument`, `idCardUploadedAt`, `idCardMimeType`, `idCardByteSize`, and `idCardSha256`.

### 3.2. Identity Document Multipart Security
- **Middleware Ordering:**
  ```
  router.use(authenticateSession)
    -> router.use(resolveAuthoritativeDormitoryContext)
    -> requirePermission('tenant:write')
    -> requireDormitoryWriteEntitlement
    -> handleUploadSingle [upload.single('file'), 5MB max, 1 file]
    -> validateCsrfToken
    -> document upload handler
  ```
- **Guarantees:**
  - Unauthenticated or unauthorized callers (lacking `tenant:write` or write-entitlement) are rejected with 401/403 **before** Multer processes any multipart buffer into memory.
  - Unexpected fields (`upload.single('file')`) or files exceeding 5MB are caught and return canonical 400 errors (`INVALID_FILE_FIELD`, `FILE_TOO_LARGE`).
  - No internal stack traces or internal storage keys leak to the client.

### 3.3. Security Test Strategy (Production Code Verification)
- Tests in `src/tests/tenant-phase3-step3b-persistence-security.test.ts` do **not** duplicate production sanitizers.
- They import production mappers directly (`server/src/mappers/tenant-api.mapper.ts`) and mount the real Express application (`createApp()`) using Supertest.
- Implemented `assertForbiddenKeyAbsent(obj, key)` which recursively traverses objects, arrays, and nested relations to ensure sensitive keys never exist anywhere in the payload.
- Serialized JSON strings are checked to ensure mock ciphertext never appears.

### 3.4. Name Parsing Single Authority
- **Frontend Adapter (`ApiTenantAdapter`):**
  - Removed client-side `rawName.trim().split(/\s+/)`.
  - Transmits payload `{ displayName: rawName.trim() }`.
- **Backend Authority (`TenantService` + `thai-identity.util.ts`):**
  - `displayName` retains full original user input (Unicode NFC, normalized whitespace, casing preserved).
  - `firstName` and `lastName` are derived on the backend.
  - Word boundary regex applied to Latin prefixes (`^(mr|mrs|ms|dr)(\.|\b)`) prevents accidental honorific stripping from names like `Drew` or `Mission`.
  - Deterministic multi-token fallback: `firstName` = first non-honorific token, `lastName` = remaining tokens.

### 3.5. Production Database Error Fail-Closed Behavior
- In `TenantService.getTenantDetails`, removed the blanket `try/catch` block that previously returned empty arrays upon query rejection.
- If any authoritative Prisma query (`occupancy`, `dailyStay`, `bill`, `settlement`) rejects, the request fails closed and propagates to Express error middleware (returning 500 `TENANT_OPERATION_FAILED`).

### 3.6. Canonical TenantDataSource Interface Hardening
- In `src/data/contracts/index.ts`, made the following 6 methods required:
  - `updateEmergencyContact(contactId, contact)`
  - `deleteEmergencyContact(contactId)`
  - `updateVehicle(vehicleId, vehicle)`
  - `deleteVehicle(vehicleId)`
  - `uploadIdentityDocument(tenantId, file)`
  - `getTenantProfile(tenantId)`
- Implemented and verified on both `ApiTenantAdapter` and `DemoTenantAdapter`.

### 3.7. Preserved Invariants
- **National ID Rules:**
  - Omitted input preserves existing `nationalIdEncrypted`.
  - Masked input (`1-2345-XXXXX-XX-X`) is ignored as a display-only echo.
  - Valid 13-digit number encrypts and updates masked ID.
  - Blank string `""` clears National ID (preserved Step 3B behavior).
- **Co-Occupant History Authority:**
  - Uses canonical database audit timestamps (`createdAt`, `deletedAt`).
  - Active co-occupants filter `deletedAt === null && status === 'active'`.
  - History encompasses all tenant records without synthetic IDs or client timestamps.
- **Emergency Contact & Vehicle:**
  - Full dormitory tenant ownership isolation enforced.
  - Soft-delete semantics preserved for vehicles.

---

## 4. Verification & Test Results

### 4.1. Vitest Suite Execution
```bash
npx vitest run \
  src/tests/tenant-phase2-step1-adapter.test.ts \
  src/tests/tenant-phase2-step2-quickadd.test.tsx \
  src/tests/tenant-phase2-step3-registration.test.tsx \
  src/tests/tenant-phase2-step4-domain-correction.test.tsx \
  src/tests/tenant-phase3-step2-api-adapter.test.ts \
  src/tests/tenant-phase3-step3b-persistence-security.test.ts \
  src/tests/tenantFailClosed.test.ts \
  --environment happy-dom
```

**Results:**
- `src/tests/tenantFailClosed.test.ts`: **2 passed**
- `src/tests/tenant-phase2-step1-adapter.test.ts`: **15 passed**
- `src/tests/tenant-phase3-step2-api-adapter.test.ts`: **7 passed**
- `src/tests/tenant-phase3-step3b-persistence-security.test.ts`: **31 passed**
- `src/tests/tenant-phase2-step2-quickadd.test.tsx`: **10 passed**
- `src/tests/tenant-phase2-step4-domain-correction.test.tsx`: **7 passed**
- `src/tests/tenant-phase2-step3-registration.test.tsx`: **9 passed**

**Total:** **7 test files passed, 81 tests passed, 0 failed.**

### 4.2. Build Verification
1. **Backend Build:**
   ```bash
   npm --prefix server run build
   # Exit code: 0 (tsc -p tsconfig.build.json clean)
   ```
2. **Frontend Build:**
   ```bash
   npm run build
   # Exit code: 0 (vite build clean, 2797 modules transformed)
   ```

---

## 5. Protected File Verification

A `git diff` against all protected files confirmed **ZERO** modifications:
- `server/prisma/schema.prisma` — **ZERO DIFF**
- `server/prisma/migrations/**` — **ZERO DIFF**
- `src/pages/owner/tenants.tsx` — **ZERO DIFF**
- `src/pages/owner.tsx` — **ZERO DIFF**
- `src/pages/owner/contracts.tsx` — **ZERO DIFF**
- `src/pages/owner/rooms.tsx` — **ZERO DIFF**
- `src/pages/owner/meters.tsx` — **ZERO DIFF**
- `src/components/tenant/TenantRegisterView.tsx` — **ZERO DIFF**
- `src/pages/tenant/TenantRegisterPage.tsx` — **ZERO DIFF**
- `src/pages/tenant.tsx` — **ZERO DIFF**

---

## 6. Git Status & Diffs

### `git status --short`
```
 M server/src/middleware/entitlement.ts
 M server/src/routes/tenant.routes.ts
 M server/src/schemas/property-tenant-contract.schemas.ts
 M server/src/services/tenant.service.ts
 M server/src/utils/thai-identity.util.ts
 M src/data/adapters/api/index.ts
 M src/data/contracts/index.ts
 M src/tests/tenant-phase3-step3b-persistence-security.test.ts
?? server/src/mappers/tenant-api.mapper.ts
?? TENANT_PHASE3_STEP3B1_SECURITY_AUTHORITY_CORRECTION_REPORT.md
```

### `git diff --stat`
```
 server/src/middleware/entitlement.ts               |  36 +-
 server/src/routes/tenant.routes.ts                 | 119 +++--
 .../schemas/property-tenant-contract.schemas.ts    |  14 +-
 server/src/services/tenant.service.ts              | 112 ++--
 server/src/utils/thai-identity.util.ts             |   7 +
 src/data/adapters/api/index.ts                     |  27 +-
 src/data/contracts/index.ts                        |  12 +-
 ...nant-phase3-step3b-persistence-security.test.ts | 566 +++++++++++++++++++--
 8 files changed, 729 insertions(+), 164 deletions(-)
```

---

## 7. Remaining Work for Tenant Phase 3 Step 3C

With all backend APIs, data adapters, multipart uploads, and security mappers certified secure and resilient:
- Step 3C can proceed to wire the Owner Tenant Profile tabs to the authoritative data sources:
  - Personal Information / Identity Document status
  - Co-occupant active list & historical ledger
  - Emergency contacts
  - Vehicles
  - Contract & Room history
  - Financial records (Bills, Payments, Settlements)
- Preserving existing UI layouts, modal designs, and user experience flows without introducing regressions.
