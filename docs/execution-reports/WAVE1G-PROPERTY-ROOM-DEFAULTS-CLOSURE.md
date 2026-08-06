# Wave 1G — Final Security, Propagation, Counter, and Evidence Closure Report

## Executive Summary

Wave 1G Final Security, Propagation, Counter, and Evidence Closure has been fully completed and validated in accordance with all explicit user directives and strict safety requirements.

All schema validation rules, transactional persistence guarantees, explicit Set-based room counters, independent optimistic locking versions, pre-mutation preview captures, in-transaction idempotency recheck with P2002 handling, unified blocking contract policy, backend-only field scopes, exact propagation preview/apply UI postconditions, no-op propagation exclusion, dirty field tracking, and inheriting Room D101 snapshot separation proofs have been implemented, verified, locked, and published.

PR #3 remains open and unmerged. TASK-009 has not been started. All commits are forward-only.

---

## 1. Git & Scope Provenance

- **Repository**: `D:\horplus_wave1d_fasttrack`
- **Branch**: `feature/wave1g-property-room-defaults`
- **Pull Request**: `#3` (Open and unmerged)
- **PR Base Branch**: `recovery/wave1d-fasttrack`
- **PR Base SHA**: `9e6dc9e35a5fe2b2637f2a241a39999609bec03a`
- **Starting Verification SHA**: `231e7fe`
- **Final Implementation & Test SHA**: `1574ddc18f3ad6c6be004300bb268917d797127e`
- **TASK-009 State**: NOT STARTED

---

## 2. No-Op Propagation Exclusion & Dirty Field Tracking

1. **No-Op Propagation Field Exclusion**:
   - `valuesEquivalent(oldEffectiveValue, newEffectiveValue)` canonically compares `Decimal`, `string`, and `number` (e.g. `9400`, `"9400"`, `"9400.00"`, `Decimal(9400)` compare equal).
   - Fields with no effective change return `{ eligible: false, skipReason: 'NO_EFFECTIVE_CHANGE' }`.
   - No-op fields do NOT increment `eligibleFieldChangeCount` or `appliedFieldChangeCount`.
   - Rooms with only no-op or protected/override fields are NOT counted as eligible Rooms.
   - When a parsed propagation payload contains zero effective field changes across all candidate rooms:
     - Apply returns `{ success: true, noOp: true, appliedRoomCount: 0, appliedFieldChangeCount: 0, ... }`.
     - Database defaults version (Property/Billing) is NOT incremented.
     - AuditLog entry is NOT created.
     - Idempotency key replay returns identical no-op response.

2. **Dirty Field Tracking & Auto-Save Guard**:
   - Owner Settings UI tracks explicit dirty changes for modified fields (`property` and `billing`).
   - Preview Propagation button is disabled when no dirty fields exist.
   - `isPropagationPreviewOpeningRef` and `onMouseDown` DOM event order synchronization ensure `onBlur` auto-save does not preemptively mutate backend defaults before propagation preview execution.

---

## 3. Schema Validation & Security Enhancements

1. **Strict Dormitory Defaults Request Validation**:
   - `UpdateDormitoryDefaultsRequestSchema` enforces an outer object containing optional `property` and `billing` change definitions with their corresponding `expectedVersion` integers.
   - Any unknown fields inside `property`, `billing`, or at top level produce Zod `unrecognized_keys` errors, mapped to HTTP 400 `DEFAULT_FIELD_NOT_ALLOWED`.
   - Canonical field names (`waterRate`, `electricityRate`, `waterBillingType`, `electricityBillingType`) are enforced strictly.

2. **Discriminated Union Propagation Contracts**:
   - `DefaultPropagationPreviewSchema` enforces discriminated unions by `scope` (`DORMITORY` or `BUILDING`).
   - `DefaultPropagationApplySchema` enforces discriminated unions by `scope`. For `DORMITORY` scope, `changes.property` requires `expectedVersions.property`, and `changes.billing` requires `expectedVersions.billing`.

3. **Building & Room Override Schemas**:
   - `AllowedBuildingOverrideChangesSchema`, `UpdateBuildingDefaultsSchema`, and `UpdateRoomDefaultsSchema` restrict allowable fields to exact model-backed override fields using `.strict()`.

---

## 4. Room Counters, Idempotency & Unified Policy

1. **Explicit Set-based Room Counters**:
   - Preview and Apply calculate room-level counts using explicit Sets (`eligibleRoomIds`, `skippedRoomIds`).
   - Invariants strictly enforced:
     - `0 <= eligibleRoomCount <= candidateRoomCount`
     - `0 <= skippedRoomCount <= candidateRoomCount`
     - `eligibleRoomCount + skippedRoomCount = candidateRoomCount`
     - `eligibleFieldChangeCount + skippedFieldChangeCount = fieldEffects.length`

2. **Pre-Mutation Preview Capture**:
   - `applyDefaultPropagation` executes `previewDefaultPropagation` inside transaction BEFORE applying database updates.

3. **In-Transaction Advisory Locking & Idempotency Replay**:
   - `applyDefaultPropagation` acquires `pg_advisory_xact_lock(hashtext(dormitoryId))` and performs in-transaction idempotency key lookup.
   - Catches defensive Prisma `P2002` duplicate key failure and reloads completed response safely.

4. **Unified Blocking Contract Policy**:
   - Active contract statuses (`active`, `approved`, `expiring_soon`, `waiting_extension`, `checking_out`) protect rooms from default propagation (`skipReason: 'PROTECTED_CONTRACT'`).

---

## 5. UI Postconditions & Snapshot Separation Proof

1. **Exact Propagation UI Assertions**:
   - Verified real-change propagation and no-op propagation in Playwright E2E suite (`tests/e2e/wave1g-property.spec.ts`).
   - Direct locators by room + field identity: `preview-effect-C101-defaultMonthlyRent`, `preview-effect-B101-defaultMonthlyRent`, `preview-effect-A101-defaultMonthlyRent`.

2. **Current-vs-Locked Snapshot Separation Proof (Inheriting Room D101)**:
   - Dedicated inheriting Room `D101` activated with contract snapshot (`rentAmount = 4,300`, `depositAmount = 8,600`).
   - Dormitory default updated to `9,500`.
   - Verified `locked-snapshot-section` renders locked contract values (`4,300`), while `current-defaults-section` renders current live default (`9,500`).

---

## 6. Comprehensive Command Verification Matrix

| Command Category | Exact Command | Cwd | Exit Code | Passed | Failed | Skipped | Sanitized Result Summary |
|---|---|---|---|---|---|---|---|
| Backend Lint | `npm run lint` | `server` | 0 | All | 0 | 0 | TypeScript type check passed cleanly with 0 errors |
| Backend Build | `npm run build` | `server` | 0 | All | 0 | 0 | Compiled server dist binaries cleanly |
| Backend Vitest | `npm test` | `server` | 0 | 191 | 0 | 0 | 20 / 20 test files passed (191 / 191 tests) |
| Backend TSC | `npx tsc --noEmit` | `server` | 0 | All | 0 | 0 | TypeScript compilation clean |
| Prisma Validate | `npx prisma validate` | `server` | 0 | 1 | 0 | 0 | Schema `prisma/schema.prisma` is valid |
| Prisma Generate | `npx prisma generate` | `server` | 0 | 1 | 0 | 0 | Generated Prisma Client v5.22.0 |
| Frontend Lint | `npm run lint` | `.` | 0 | All | 0 | 0 | React TypeScript type check passed cleanly |
| Frontend Build | `npm run build` | `.` | 0 | All | 0 | 0 | Vite production bundle built dist in 12.14s |
| Frontend Vitest | `npm test` | `.` | 0 | 32 | 0 | 1 | 5 / 5 test files passed (32 passed, 1 skipped) |
| Frontend TSC | `npx tsc --noEmit` | `.` | 0 | All | 0 | 0 | TypeScript compilation clean |
| E2E TSC | `npx tsc --noEmit -p tsconfig.e2e.json` | `.` | 0 | All | 0 | 0 | Playwright E2E type check clean with 0 errors |
| Playwright E2E Suite | `$env:CI="1"; npx playwright test tests/e2e/wave1g-property.spec.ts` | `.` | 0 | 2 | 0 | 0 | 2 / 2 tests passed (API + UI full lifecycle) |

---

## 7. Forward-Only Commit Log

```text
1574ddc test(wave1g): prove real-change and no-op propagation
b5a8d6e fix(wave1g): exclude no-op propagation effects
b10a0da docs(wave1g): publish canonical execution truth
6109818 test(wave1g): assert exact propagation and snapshot separation
```

---

## 8. Final Status

**WAVE 1G PROPERTY, ROOM DEFAULTS AND SNAPSHOTS: PASSED**
