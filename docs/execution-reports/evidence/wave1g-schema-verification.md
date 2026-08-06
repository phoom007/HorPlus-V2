# Wave 1G Schema & Security Evidence

## 1. Zod Outer Envelope Schemas & Error Code Verification
- `UpdateDormitoryDefaultsRequestSchema`:
  - Enforces `property` (`changes`, `expectedVersion`) and `billing` (`changes`, `expectedVersion`).
  - `.strict()` ensures unrecognized top-level or field keys produce Zod `unrecognized_keys` issues.
  - Route handler maps `unrecognized_keys` to HTTP 400 `DEFAULT_FIELD_NOT_ALLOWED`.
  - Route handler maps general validation issues to HTTP 400 `VALIDATION_ERROR`.
- Canonical DB Field Alignment:
  - Canonical input names: `waterRate`, `electricityRate`, `waterBillingType`, `electricityBillingType`.
  - Legacy names (e.g. `waterUnitRate`, `electricityUnitRate`, `waterChargeType`, `electricityChargeType`) rejected with HTTP 400 `DEFAULT_FIELD_NOT_ALLOWED`.
  - Fee mode fields (`commonFeeMode`, `internetFeeMode`, `parkingFeeMode`) set free -> 0 amount in UI and disabled to prevent unpersisted claims.

## 2. Discrimination Union Propagation Schemas
- `DefaultPropagationPreviewSchema`:
  - `DormitoryPropagationPreviewSchema` (`scope: 'DORMITORY'`, `changes: { property?, billing? }`)
  - `BuildingPropagationPreviewSchema` (`scope: 'BUILDING'`, `scopeId`, `changes`)
- `DefaultPropagationApplySchema`:
  - `DormitoryPropagationApplySchema` (`scope: 'DORMITORY'`, `changes: { property?, billing? }`, `expectedVersions: { property?, billing? }`, `idempotencyKey`)
  - Requires `expectedVersions.property` when `changes.property` is provided.
  - Requires `expectedVersions.billing` when `changes.billing` is provided.
  - `BuildingPropagationApplySchema` (`scope: 'BUILDING'`, `scopeId`, `changes`, `expectedVersion`, `idempotencyKey`)
- Legacy flat propagation payloads return HTTP 400 `DEFAULT_FIELD_NOT_ALLOWED` / `VALIDATION_ERROR`.

## 3. Database Atomicity & Versioning Verification
- `updateDormitoryDefaults`:
  - Runs in single `prisma.$transaction`.
  - Property Defaults `version` check and updateMany.
  - Billing Settings `version` check and updateMany.
  - Mandatory `AuditLog` record creation.
  - If AuditLog or either update fails, the entire transaction rolls back cleanly.
- `applyDefaultPropagation`:
  - Acquires `pg_advisory_xact_lock(hashtext(dormitoryId))`.
  - Enforces version check for both property and billing defaults.
  - Computes canonical request hash using SHA-256 hex string fitting `VarChar(255)`.
  - Persists `IdempotencyKey` inside transaction.
