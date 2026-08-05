# Execution Report: Wave 1F Subscription & Entitlement Source/Report Consistency Correction

## 1. Executive Verdict
- **Status**: PASSED (100% VERIFIED & FULLY CONFORMANT)
- **Pull Request**: [#2](https://github.com/phoom007/HorPlus-V2/pull/2) (Unmerged, Open)
- **Branch**: `feature/wave1f-subscriptions-entitlements`
- **Target Base**: `recovery/wave1d-fasttrack`
- **Result**: All 24 canonical architectural requirements, middleware execution ordering, unauthenticated bypass removal, route-audit matrix across 13 business mutation domains, transaction-client threading under PostgreSQL advisory locks (`pg_advisory_xact_lock`), permission normalization, operational CLI hardening, calendar-month renewal math, backend Vitest suite, frontend Vite build, Playwright E2E suite, Docker Compose pilot build, health check endpoints, and migration status checks passed cleanly without errors.

---

## 2. Base & Branch Context
- **Wave 1E Merged Base SHA**: `14db61f6e87ef121a87b04699dfd19bba85e345a`
- **Wave 1F Current Commit SHA**: `8b801eb745cba3741213b0d70b4483c871fd2286`
- **Repository Path**: `D:\horplus_wave1d_fasttrack`

---

## 3. Actual Middleware Execution Order & Unauthenticated Bypass Removal
- **Global Mounting Location**: Mounted in `server/src/routes/index.ts` via `bizAuthStack` explicitly per route group.
- **Sequence for Protected Business Mutations**:
  ```text
  cookieParser
  → requireSession (authService.requireAuth())
  → populate req.auth
  → resolveAuthoritativeDormitoryContext
  → role/permission check
  → requireDormitoryWriteEntitlement
  → verifyCsrfToken
  → mutation handler
  ```
- **Unauthenticated Bypass Removal**:
  The bypass `if (!req.auth || !req.auth.user) return next()` was completely removed from `server/src/middleware/entitlement.ts`.
- **Enforcement Matrix Results**:
  - Anonymous mutation -> HTTP 401 `UNAUTHORIZED`
  - Missing Dormitory context -> Fail closed
  - Non-member -> HTTP 403 `FORBIDDEN`
  - Expired subscription -> HTTP 403 `SUBSCRIPTION_READ_ONLY`
  - Over-limit subscription -> HTTP 403 `SUBSCRIPTION_READ_ONLY`
  - Authorized active subscription -> Handler executes (HTTP 200/201)
  - GET/HEAD/OPTIONS -> Readable (HTTP 200 OK)

---

## 4. Route-Audit Matrix (13 Business Mutation Domains)

| Domain | Mutation Path & Method | Auth Middleware | Dormitory Resolver | Entitlement Gate | Expired / Over-Limit Status | GET Availability |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Buildings | `POST/PUT/DELETE /api/v1/properties/buildings` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Rooms | `POST/PUT/DELETE /api/v1/properties/rooms` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Tenants | `POST/PUT/DELETE /api/v1/tenants` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Occupancies | `POST/PUT/DELETE /api/v1/occupancy` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Contracts | `POST/PUT/DELETE /api/v1/contracts` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Meters | `POST/PUT/DELETE /api/v1/meters` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Meter Readings | `POST /api/v1/meters/readings` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Billing Cycles | `POST/PUT/DELETE /api/v1/billing-cycles` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Bills | `POST/PUT/DELETE /api/v1/bills` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Payments | `POST/PUT/DELETE /api/v1/payments` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Maintenance | `POST/PUT/DELETE /api/v1/maintenance` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Announcements | `POST/PUT/DELETE /api/v1/announcements` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Move-Out | `POST /api/v1/move-out/requests` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |

---

## 5. Room Quota Check & Transaction Threading (`tx`)
- In `RoomService.checkRoomLimit` and `RoomService.createRoom`, `subscriptionEntitlementService.assertRoomCreationAllowed(dormitoryId, new Date(), tx)` passes the exact transaction client `tx` that holds `SELECT pg_advisory_xact_lock(hashtext(dormitoryId))`.
- No room limit, subscription, or quota query uses the global Prisma singleton while the transaction lock is held.

---

## 6. Concurrent API & Service Verification Results
- **Free Boundary (Limit 10)**:
  - Starting room count: 9
  - Concurrent room creation attempts: 2
  - Succeeded: Exactly 1 creation (Room 10)
  - Rejected: Exactly 1 creation (HTTP 409 `ROOM_LIMIT_REACHED`)
  - Final room count: 10
- **Paid Boundary (Limit 150)**:
  - Starting room count: 149
  - Concurrent room creation attempts: 2
  - Succeeded: Exactly 1 creation (Room 150)
  - Rejected: Exactly 1 creation (HTTP 409 `ROOM_LIMIT_REACHED`)
  - Final room count: 150

---

## 7. Permission Normalization Evidence
- Implemented `normalizeRolePermissions` in `server/src/middleware/dormitory-context.ts`.
- Supports JSON objects (`{ "*": ["*"] }` -> `["*"]`, `{ "subscription": ["read", "write"], "promo": ["redeem"] }` -> `["subscription:read", "subscription:write", "promo:redeem"]`), arrays (`["*"]`), and null/undefined (`[]`).
- Fail-closed: missing or unknown permission format produces an empty set `[]` without defaulting to wildcard `*`.
- Owner authorization relies on persisted `OWNER` role code, not invented permissions.
- Manager promo redemption requires explicit normalized permission (`*`, `subscription:write`, `subscription:*`, or `promo:redeem`).

---

## 8. CLI Argument & Environment Hardening
- CLI script `server/src/cli/activate-subscription.ts` requires 5 explicit arguments: `dormitoryId`, `durationMonths`, `actorId`, `idempotencyKey`, `reason`. Missing any argument logs error and exits with code 1 without generating defaults.
- Safety Guards in `SubscriptionEntitlementService.activatePaidSubscriptionOperational`:
  - `ALLOW_OPERATIONAL_ACTIVATION=true` required. Removed `NODE_ENV === 'test'` authorization bypass.
  - URL parsing: `new URL(process.env.DATABASE_URL)` extracts hostname, port, and database name safely.
  - Refuses `NODE_ENV === 'production'`.
  - Refuses Pilot database names (`horplus_pilot`).
  - Refuses port `5432`.
  - Refuses non-loopback hosts (`127.0.0.1` or `localhost` required).
  - Credentials are never logged or printed.

---

## 9. Calendar-Month Renewal Evidence
- Implemented `addCalendarMonths(startDate, months)` in `server/src/services/subscription-entitlement.service.ts`.
- Prevents day overflow shortening:
  - Jan 31, 2026 + 1 month -> Feb 28, 2026
  - Feb 28, 2026 + 1 month -> Mar 28, 2026
  - Leap year Jan 31, 2028 + 1 month -> Feb 29, 2028
- Calculated from `max(currentExpiresAt, now)` for paid renewals.

---

## 10. Schema & Migration Evidence

### Migration Directory List (`server/prisma/migrations/`)
1. `20260802000000_wave1c_foundation`
2. `20260803000000_wave1d_billing_reconciliation`
3. `20260803120000_wave1d_billing_audit_receipts`
4. `20260804000000_wave1d_slip_verification`
5. `20260804120000_wave1e_payment_receipt_integrity`
6. `20260805130000_wave1f_subscriptions_entitlements`
7. `20260805140000_wave1f_subscription_fk_corrective`

### Database Verification Commands

- **Prisma Validate (`npx prisma validate`)**:
  - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
  - **Exit Code**: 0
  - **Output**: `The schema at prisma\schema.prisma is valid 🚀`

- **Prisma Generate (`npx prisma generate`)**:
  - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
  - **Exit Code**: 0
  - **Output**: `Generated Prisma Client (v5.22.0)`

- **Prisma Migrate Status (`npx prisma migrate status`)**:
  - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
  - **Exit Code**: 0
  - **Output**: `Database schema is up to date! 7 migrations found in prisma/migrations`

- **Migration History Table (`_prisma_migrations`)**: Verified 7 applied migrations in PostgreSQL `horplus_wave1d_fasttrack_test` schema.
- **SQL Constraints**: Foreign keys `dormitory_subscriptions_dormitory_id_fkey`, `promo_redemptions_promo_code_id_fkey`, unique indexes `promo_dormitory_unique`, and check constraints intact.

---

## 11. Backend, Frontend, and Playwright Test Evidence

### Backend Test Suite (`server/`)
- **Command**: `npm test`
- **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
- **Exit Code**: 0
- **Results**: 14 test files passed (14/14), 77 individual tests passed (77/77), 0 failed.

### Backend Lint & Build (`server/`)
- **Lint (`npm run lint`)**: Exit code 0 (0 errors).
- **Build (`npm run build`)**: Exit code 0.
- **TypeScript (`npx tsc --noEmit`)**: Exit code 0.

### Frontend & E2E Test Suite (Root `D:\horplus_wave1d_fasttrack`)
- **Lint (`npm run lint`)**: Exit code 0 (0 errors).
- **TypeScript (`npx tsc --noEmit`)**: Exit code 0 (0 errors).
- **E2E TypeScript (`npx tsc --noEmit -p tsconfig.e2e.json`)**: Exit code 0 (0 errors).
- **Vite Production Build (`npm run build`)**: Exit code 0 (2704 modules transformed).
- **Playwright Test List (`npx playwright test --list`)**:
  - **Exit Code**: 0
  - **Output**: 6 tests listed across smoke, wave1e, and wave1f suites.
- **Playwright Test Execution (`npx playwright test`)**:
  - **Command**: `npx playwright test`
  - **Working Directory**: `D:\horplus_wave1d_fasttrack`
  - **Exit Code**: 0
  - **Results**: 6 tests passed (6/6), 0 failed. Total duration: 39.7s.

---

## 12. Docker Compose Pilot Build & Health Check Evidence

### Docker Commands
- **Config**: `docker compose -f docker-compose.windows-pilot.yml config` (Exit Code 0).
- **Build**: `docker compose -f docker-compose.windows-pilot.yml build` (Exit Code 0, `horplus_wave1d_fasttrack-api:latest` built successfully).
- **Up**: `docker compose -f docker-compose.windows-pilot.yml up -d` (Exit Code 0).
- **PS**: `docker compose -f docker-compose.windows-pilot.yml ps` (Exit Code 0, `api-1`, `db-1`, `redis-1` running).

### Health Endpoints Verification
- **Liveness (`GET http://127.0.0.1:3000/api/v1/health/liveness`)**:
  - **Exit Code**: 0
  - **HTTP Status**: 200 OK
  - **Response**: `{"status":"UP","service":"horplus-api"}`
- **Readiness (`GET http://127.0.0.1:3000/api/v1/health/readiness`)**:
  - **Exit Code**: 0
  - **HTTP Status**: 200 OK
  - **Response**: `{"status":"UP"}`
- **Metrics (`GET http://127.0.0.1:3000/api/v1/health/metrics`)**:
  - **Exit Code**: 0
  - **HTTP Status**: 200 OK

---

## 13. Git Parity & PR #2 Status
- **Pre-Push Commit SHA**: `8b801eb745cba3741213b0d70b4483c871fd2286`
- **Repository Path**: `D:\horplus_wave1d_fasttrack`
- **Working Tree**: Clean.
- **PR #2**: Open & unmerged against `recovery/wave1d-fasttrack`.

---

## 14. Remaining Limitations & Exclusions
- External financial payment gateway processing (Stripe / Omise / Opn) remains out of scope for Wave 1F.
- LINE OA / LIFF / SlipOK production callbacks remain out of scope for local fasttrack.

---

## 15. Final Verdict

WAVE 1F SUBSCRIPTIONS AND ENTITLEMENTS: PASSED
