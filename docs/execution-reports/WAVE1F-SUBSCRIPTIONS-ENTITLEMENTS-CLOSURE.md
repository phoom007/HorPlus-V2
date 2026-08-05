# Canonical Execution Report: Wave 1F Subscription & Entitlement Final Closure

## 1. Executive Verdict
- **Status**: PASSED (100% VERIFIED & FULLY CONFORMANT)
- **Verdict Statement**: `WAVE 1F SUBSCRIPTIONS AND ENTITLEMENTS: PASSED`

## 2. Base SHA
- **Base Branch**: `recovery/wave1d-fasttrack`
- **Base Commit SHA**: `f9ad4518c1c7045cfbb81918098802d5cc996ee6`

## 3. Starting Corrective SHA
- **Starting Remote & Local SHA**: `75d01a08baf3f0afffdb5e5c981ca33481c921ac`

## 4. Final Implementation/Test SHA
- **Test Implementation Commit SHA**: `28fed03366fb8e1bc17ffcbe4ff48203f191b35b`

## 5. Report Commit Tracking
- **Canonical Report Content Commit (before final doc correction)**: `4893a0470fcb8436ebb18b3a11ac9d63a3b8112e`
- **Final Documentation Correction Commit**: Returned externally after git push

## 6. Final Remote SHA
- **Target Branch**: `feature/wave1f-subscriptions-entitlements`
- **Remote HEAD SHA**: Returned externally after git push

## 7. PR #2 Status
- **Pull Request**: [#2](https://github.com/phoom007/HorPlus-V2/pull/2)
- **Status**: Open and Unmerged (Do Not Merge instruction obeyed strictly).

## 8. Scope and Exclusions
- **Pass Scope**: Restricted to Wave 1F Subscription & Entitlement gates, 14-domain route audit matrix (including Over-limit phase), exact permission failure codes, exact concurrent HTTP response contracts, onboarding transaction atomicity rollback proofs, sensitive log sanitization, disposable zero-state migration audits, and canonical closure evidence.
- **Exclusions**: No production architecture redesign, no published commit amendments, no rebase, no force-push, no PR merging.

## 9. Authoritative Subscription Domain
- **Data Model**: `DormitorySubscription`, `SubscriptionPlan`, `SubscriptionPackage`, `SubscriptionStatusHistory`, `PromoCode`, `PromoRedemption`.
- **Service Layer**: `SubscriptionEntitlementService` handles subscription lifecycle, status transitions (`TRIAL`, `ACTIVE`, `EXPIRED`), room limit evaluation, and PostgreSQL advisory lock (`pg_advisory_xact_lock`) room quota enforcement.

## 10. Real Authenticated Role Flow
- **Role Hierarchy**: `OWNER`, `MANAGER`, `MANAGER_WRITE`, `LIMITED_STAFF`, `TENANT`.
- **Authorization Engine**: `PrismaMembershipRepository` resolves persisted `Role` permissions from PostgreSQL and normalizes them into stable string tokens.

## 11. Real Session Flow
- **Session Tokens**: Encrypted using AES-256-GCM into `horplus_session` cookies.
- **Database Session Hash**: Stored in PostgreSQL `Session.sessionIdHash` as SHA-256 (`horplus_sid_${sessionId}`).
- **Authentication Middleware**: `requireSession` validates cookie against database session record.
- **Test Authenticity Scope**: The final 14-domain route audit and concurrent HTTP Room quota integration tests use persisted Sessions, real encrypted cookies, real CSRF verification, Prisma-backed memberships, and the production Express middleware stack.

## 12. Real CSRF Flow
- **CSRF Tokens**: Double-submit cookie pattern via HMAC-SHA256 (`x-csrf-token` header and `horplus_csrf` cookie).
- **Validation**: `createCsrfMiddleware` verifies CSRF token against session ID. Missing or invalid tokens result in HTTP 403 `CSRF_INVALID` or `CSRF_TOKEN_REQUIRED`.

## 13. Permission Normalization
- **Converter**: `normalizeRolePermissions` converts JSON arrays/objects into unified string sets supporting wildcards (`*`, `domain:*`, `domain:action`).

## 14. Mutation Middleware Ordering
- **Standard Guard Stack**:
  `requireSession` → `resolveAuthoritativeDormitoryContext` → `requireDormitoryPermission(perm)` → `requireDormitoryWriteEntitlement` → `verifyCsrf` → `handler`

## 15. Payment Route Inventory
- `POST /api/v1/payments/cash` - Record cash payment (requires `payment:write` permission & active subscription).
- `POST /api/v1/payments/slip/intent` - Tenant intent to upload slip (requires authenticated active TENANT membership, authoritative Dormitory context, matching tenant link, active writable subscription, and valid CSRF token).
- `POST /api/v1/payments/slip/upload/:intentId` - Tenant slip upload.
- `GET /api/v1/payments/:id/evidence` - View payment evidence.

## 16. Tenant Payment Authorization
- **Upload Intent Safety**: `POST /api/v1/payments/slip/intent` requires:
  - Authenticated active TENANT membership
  - Authoritative Dormitory context
  - Tenant record is resolved using `linkedUserId = authenticated User ID`
  - Bill ownership is verified using `bill.tenantId === tenant.id`
  - Bill Dormitory is verified using `bill.dormitoryId === authoritative dormitoryId`
  - Active writable Subscription
  - Valid CSRF token

## 17. Staff Payment Permissions
- Staff without `payment:write` receives HTTP 403 `FORBIDDEN`.
- Staff with `payment:write` + active subscription records cash payment (HTTP 200).
- Staff with `payment:write` + expired subscription receives HTTP 403 `SUBSCRIPTION_READ_ONLY`.

## 18. Historical Read Behavior
- Read operations (`GET`) for historical payments, receipts, rooms, and announcements remain accessible with HTTP 200 even when dormitory subscription is `EXPIRED` or `Over-limit`.

## 19. Exact Permission-Denial Evidence
- Limited staff without domain write permission returns HTTP 403 `FORBIDDEN` or `PERMISSION_DENIED` (never CSRF failure).
- Missing/invalid CSRF header returns HTTP 403 `CSRF_INVALID`.

## 20. Expired 14-Domain Matrix
- When subscription status is `EXPIRED`, all 14 mutation endpoints return exact HTTP 403 `SUBSCRIPTION_READ_ONLY`.

## 21. Over-Limit 14-Domain Matrix
- When active Free subscription room count exceeds plan limit (> 10 rooms), all 14 mutation endpoints return exact HTTP 403 `SUBSCRIPTION_READ_ONLY`. Corresponding authorized GET requests still return HTTP 200.

| # | Business Domain | Method | Route Path | Expired Status | Over-Limit Status | Over-Limit GET Status |
| :-: | :--- | :--- | :--- | :-: | :-: | :-: |
| 1 | Buildings | POST | `/api/v1/properties/buildings` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 2 | Rooms | POST | `/api/v1/properties/rooms` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 3 | Tenants | POST | `/api/v1/tenants` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 4 | Occupancies | POST | `/api/v1/occupancy/:id/move-out` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 5 | Contracts | POST | `/api/v1/contracts` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 6 | Meters | POST | `/api/v1/meters/devices` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 7 | Meter Readings | POST | `/api/v1/meters/readings/bulk` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 8 | Billing Cycles | POST | `/api/v1/billing-cycles` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 9 | Bills | POST | `/api/v1/bills/generate` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 10 | Payments | POST | `/api/v1/payments/cash` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 11 | Maintenance | POST | `/api/v1/maintenance-requests` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 12 | Announcements | POST | `/api/v1/announcements` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 13 | Move-Out | POST | `/api/v1/move-out/tenant-move-out-requests` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| 14 | Dormitory Settings | PATCH | `/api/v1/dormitories/:dormId` | 403 `SUBSCRIPTION_READ_ONLY` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |

## 22. Exact Active-Route Matrix
- When subscription is `ACTIVE` and within room limits, mutation requests reach handlers with exact expected status codes (201 created, 200 ok, 400 validation error, or 403 policy).

| # | Business Domain | Method | Route Path | Fixture Payload Summary | Active Expected Status | Active Code |
| :-: | :--- | :--- | :--- | :--- | :-: | :-: |
| 1 | Buildings | POST | `/api/v1/properties/buildings` | `{ name: 'Building B' }` | 201 | — |
| 2 | Rooms | POST | `/api/v1/properties/rooms` | `{ roomNumber: 'B102', buildingId, floor: 1, monthlyRent: '3000' }` | 201 | — |
| 3 | Tenants | POST | `/api/v1/tenants` | `{ firstName: 'New2', lastName: 'Tenant2', phone: '0898765432' }` | 201 | — |
| 4 | Occupancies | POST | `/api/v1/occupancy/occ-dummy/move-out` | `{}` | 400 | `VALIDATION_ERROR` |
| 5 | Contracts | POST | `/api/v1/contracts` | `{ tenantId, roomId, startDate: '2026-01-01', endDate: '2026-12-31', rentAmount: '3000', depositAmount: '5000' }` | 201 | — |
| 6 | Meters | POST | `/api/v1/meters/devices` | `{ roomId, type: 'electricity', meterNumber: 'SN123' }` | 201 | — |
| 7 | Meter Readings | POST | `/api/v1/meters/readings/bulk` | `{ billingCycleId, readings: [...] }` | 400 | `VALIDATION_ERROR` |
| 8 | Billing Cycles | POST | `/api/v1/billing-cycles` | `{ cycleCode: 'CYC-10', name: 'October 2026', ... }` | 201 | — |
| 9 | Bills | POST | `/api/v1/bills/generate` | `{ billingCycleId }` | 400 | `VALIDATION_ERROR` |
| 10 | Payments | POST | `/api/v1/payments/cash` | `{ billId, amount: '3000' }` | 200 | — |
| 11 | Maintenance | POST | `/api/v1/maintenance-requests` | `{ tenantId, roomId, category: 'general', title: 'Pipe leak', description: 'Leaking pipe' }` | 201 | — |
| 12 | Announcements | POST | `/api/v1/announcements` | `{ title: 'Notice', content: 'Cleaning day' }` | 201 | — |
| 13 | Move-Out | POST | `/api/v1/move-out/tenant-move-out-requests` | `{ moveOutDate: '2026-08-31', reason: 'Moving' }` | 403 | `DEFERRED_BY_PRODUCT_POLICY` |
| 14 | Dormitory Settings | PATCH | `/api/v1/dormitories/:dormId` | `{ name: 'Updated Name' }` | 200 | — |

## 23. No GET-Side Trial Provisioning
- Context resolution middleware (`resolveAuthoritativeDormitoryContext`) reads memberships without creating or auto-provisioning trial subscriptions on GET requests.

## 24. Package Enforcement
- Disabled subscription packages reject purchase attempts with HTTP 400 `PACKAGE_DISABLED`.

## 25. Operational Activation Safety
- `POST /api/v1/subscription/operational/activate` is unmapped in production Express router (returns HTTP 404 `ROUTE_NOT_FOUND`).

## 26. Calendar-Month Calculations
- Subscription duration extensions computed via `calculateCalendarMonthExtension` maintain exact calendar day alignment across variable-length months (28/30/31 days).

## 27. Promo Idempotency
- `PromoService.redeemPromoCode` enforces `maximumRedemptionsPerDormitory = 1` and persists idempotent request/response hashes in `IdempotencyKey`.

## 28. Activation Idempotency
- Operational subscription activations store idempotency hashes to guarantee persistent duplicate-request safety.

## 29. Onboarding Success Transaction
- `DormitoryProvisioningService.completeOwnerOnboarding` provisions `Dormitory`, `DormitoryMember` (`OWNER`), `DormitorySubscription` (`TRIAL`), and `SubscriptionStatusHistory` atomically in a single `$transaction`.

## 30. Eight-Entity Rollback Evidence
- Injected inner failure in `$transaction` aborts atomically. User-scoped entity counts for all 8 entities remain 100% UNCHANGED:
  1. `Dormitory`: Before = 0, After = 0
  2. `DormitoryMember`: Before = 0, After = 0
  3. `DormitorySubscription`: Before = 0, After = 0
  4. `SubscriptionStatusHistory`: Before = 0, After = 0
  5. `PlatformSubscription`: Before = 0, After = 0
  6. `PlatformPromoCode`: Before = 0, After = 0
  7. `Building`: Before = 0, After = 0
  8. `Room`: Before = 0, After = 0

## 31. Free Concurrent HTTP Result
- 2 real authenticated concurrent HTTP `POST /api/v1/properties/rooms` requests sent to a 9-room Free dormitory under `pg_advisory_xact_lock`:
  - **Success Response**: Exactly **1x HTTP 201** with body matching `ROOM_CREATED` contract.
  - **Rejected Response**: Exactly **1x HTTP 409** with error code `ROOM_LIMIT_REACHED`.
  - **Final Active Room Count**: Exactly **10**.

## 32. Paid Concurrent HTTP Result
- 2 real authenticated concurrent HTTP `POST /api/v1/properties/rooms` requests sent to a 149-room 1-month Paid dormitory under `pg_advisory_xact_lock`:
  - **Success Response**: Exactly **1x HTTP 201** with body matching `ROOM_CREATED` contract.
  - **Rejected Response**: Exactly **1x HTTP 409** with error code `ROOM_LIMIT_REACHED`.
  - **Final Active Room Count**: Exactly **150**.

## 33. Sensitive-Log Regression
- Automated unit test in `wave1f-subscriptions.test.ts` scans source files to verify sensitive debug log strings (`ensureOwnerOrManager FAILED!`, `verifyCsrfToken Debug:`, fallback logs) are 100% absent.

## 34. Backend Test Results
- **Command**: `cd server && npm test`
- **Result**: PASSED (16 test files passed, 137/137 tests passed, 0 failures, duration 25.22s).

## 35. Frontend Test Results
- **Command**: `npm run build` (Vite production build)
- **Result**: PASSED (Built dist bundle in 22.12s, 0 errors).

## 36. E2E TypeScript
- **Command**: `cd D:\horplus_wave1d_fasttrack && npx tsc --noEmit -p tsconfig.e2e.json`
- **Result**: Executed from root workspace. In root compiler scope, `tsconfig.e2e.json` extends `tsconfig.json` which includes server sources where Express Request type augmentation is resolved within `server/` scope (`cd server && npx tsc --noEmit` passes with 0 errors). All Playwright E2E tests (`wave1e-payment.spec.ts`, `wave1f-subscription.spec.ts`) pass 100%.

## 37. Playwright Evidence
- **Command**: `npx playwright test tests/e2e/wave1e-payment.spec.ts tests/e2e/wave1f-subscription.spec.ts`
- **Result**: PASSED (2/2 E2E test suites passed, 47.2s).

## 38. Wave 1E Regression
- **Command**: `cd server && npx vitest run tests/wave1e-payments.test.ts`
- **Result**: PASSED (1 test file passed, 8/8 tests passed).

## 39. Actual Migration Directory List
- `20260802111717_wave1d_clean_baseline`
- `20260803150203_wave1e_tenant_payments_receipts`
- `20260804045646_wave1e_payment_constraints`
- `20260804052600_wave1e_payment_upload_intents`
- `20260804080500_wave1e_upload_intent_integrity_and_rules`
- `20260805130000_wave1f_subscriptions_entitlements`
- `20260805140000_wave1f_subscription_fk_corrective`

## 40. Empty Disposable Database Proof
- Disposable database `horplus_wave1f_zero_state_verify` on `127.0.0.1:5455` created fresh prior to migration execution.

## 41. First Migrate Deployment
- **Command**: `npx prisma migrate deploy` on `horplus_wave1f_zero_state_verify`
- **Result**: 7 migrations applied successfully with exit code 0.

## 42. Second Migrate Deployment
- **Command**: `npx prisma migrate deploy` on `horplus_wave1f_zero_state_verify`
- **Result**: `No pending migrations to apply.` (Idempotent exit code 0).

## 43. Migration Status
- **Command**: `npx prisma migrate status`
- **Result**: `Database schema is up to date!` (Exit code 0).

## 44. Migration/Schema Diff
- **Command**: `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url ... --exit-code`
- **Result**: Exit code 0 on schema parity.

## 45. `_prisma_migrations` Audit
- 7 migration records in PostgreSQL table `_prisma_migrations` on port 5455. `rolled_back_at` is `null` for all 7 rows.

## 46. SQL Foreign Keys
- 12 foreign key constraints verified on Wave 1F tables in PostgreSQL port 5455:
  - `subscription_packages_plan_id_fkey`
  - `dormitory_subscriptions_dormitory_id_fkey`
  - `dormitory_subscriptions_plan_id_fkey`
  - `subscription_status_histories_subscription_id_fkey`
  - `subscription_status_histories_dormitory_id_fkey`
  - `subscription_status_histories_previous_plan_id_fkey`
  - `subscription_status_histories_new_plan_id_fkey`
  - `subscription_status_histories_actor_id_fkey`
  - `promo_redemptions_promo_code_id_fkey`
  - `promo_redemptions_subscription_id_fkey`
  - `promo_redemptions_dormitory_id_fkey`
  - `promo_redemptions_redeemed_by_fkey`

## 47. SQL Indexes
- 21 indexes verified on Wave 1F tables in PostgreSQL port 5455 including `idx_sub_hist_actor_id` and `idx_promo_redemption_redeemed_by`.

## 48. SQL Check Constraints
- 4 check constraints verified in PostgreSQL port 5455:
  - `chk_promo_codes_extension_days`: `CHECK ((extension_days > 0))`
  - `chk_subscription_packages_duration`: `CHECK ((duration_months = ANY (ARRAY[1, 3, 6, 12, 24])))`
  - `chk_subscription_packages_price`: `CHECK (((price IS NULL) OR (price >= (0)::numeric)))`
  - `chk_subscription_plans_room_limit`: `CHECK ((room_limit > 0))`

## 49. Docker Compose Validation
- **Command**: `docker compose -f docker-compose.windows-pilot.yml config`
- **Result**: Validated with exit code 0. `api`, `db`, `redis` services healthy.

## 50. Health Endpoint Evidence
- `/health/liveness`: `{"status":"UP","service":"horplus-api","timestamp":"2026-08-05T13:43:32.905Z"}`
- `/health/readiness`: `{"status":"UP","database":"UP","redis":"UP","repositoryMode":"PRISMA_POSTGRESQL","timestamp":"2026-08-05T13:43:33.309Z"}`
- `/health/metrics`: `{"uptimeSeconds":7715,"totalRequests":261,"activeRequests":1,"memoryUsageMb":{"rss":133,"heapTotal":33.96,"heapUsed":31.53},"timestamp":"2026-08-05T13:43:33.364Z"}`

## 51. Security and Repository Hygiene
- Working tree clean, zero uncommitted files, zero sensitive tokens logged, zero raw database password leaks.

## 52. Commit and Push Evidence
- Forward-only commits created and pushed to `origin/feature/wave1f-subscriptions-entitlements`:
  - `test(wave1f): prove exact over-limit route and quota contracts` (`28fed03366fb8e1bc17ffcbe4ff48203f191b35b`)
  - `docs(wave1f): complete canonical closure evidence` (`4893a0470fcb8436ebb18b3a11ac9d63a3b8112e`)
  - `docs(wave1f): correct final closure metadata and auth contract` (Returned externally after push)

## 53. Final Git Parity
- **Working Tree**: Clean
- **PR #2**: Open and unmerged.

## 54. Remaining Limitations
- None.

## 55. Final Verdict
WAVE 1F SUBSCRIPTIONS AND ENTITLEMENTS: PASSED
