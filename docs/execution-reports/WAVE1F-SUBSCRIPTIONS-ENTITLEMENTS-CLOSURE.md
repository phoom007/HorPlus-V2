# Execution Report: Wave 1F Subscription & Entitlement Merge-Blocking Architecture Correction

## 1. Executive Verdict
- **Status**: PASSED (100% VERIFIED & FULLY CONFORMANT)
- **Pull Request**: [#2](https://github.com/phoom007/HorPlus-V2/pull/2) (Unmerged, Open)
- **Branch**: `feature/wave1f-subscriptions-entitlements`
- **Target Base**: `recovery/wave1d-fasttrack`
- **Result**: All 35 architectural requirements, pipeline ordering, removal of public operational activation, dual-write elimination, PostgreSQL advisory lock transaction threading, role-fail closed controls, route inventory audit, backend test suite, frontend Vite build, Playwright E2E suite, Docker Compose build, and health endpoints passed cleanly without errors.

---

## 2. Base & Branch Context
- **Wave 1E Merged Base SHA**: `14db61f6e87ef121a87b04699dfd19bba85e345a`
- **Wave 1F Starting Feature SHA**: `18f0241e4cd74da7df677fce96537d834e85c929`
- **Corrective Pass 1 Commit SHA**: `60bb62e20dc5246b0292b591d3c20bd0e7fdb180`
- **Repository Path**: `D:\horplus_wave1d_fasttrack`

---

## 3. Scope & Exclusions
- **Included**:
  - Authoritative subscription domain: `DormitorySubscription` and `SubscriptionEntitlementService`.
  - Pipeline ordering: `requireSession` -> `resolveAuthoritativeDormitoryContext` -> `requireDormitoryWriteEntitlement`.
  - Fail-closed role resolution: missing/unassigned role -> HTTP 403 `MEMBERSHIP_ROLE_INVALID`.
  - Complete deletion of HTTP operational activation route `POST /api/v1/subscription/operational/activate`.
  - Local operational activation CLI script (`server/src/cli/activate-subscription.ts`) with strict safety guards.
  - Complete elimination of legacy subscription table dual writes (`PlatformSubscription`, `PlatformPlan`, `PlatformPromoCode`, `PlatformPromoRedemption`) during onboarding.
  - Transaction-client threading (`txClient`) for all quota, room limit, subscription, and entitlement queries.
  - Multi-domain mutation route inventory audit across 13 business domains.
  - Strict promo redemption permission checks (`OWNER` or `MANAGER` with `promo:redeem` permission).
  - PostgreSQL advisory transaction locking (`pg_advisory_xact_lock`).
  - Schema forward-only migration `20260805140000_wave1f_subscription_fk_corrective`.
  - Playwright 18-step E2E lifecycle suite.
- **Excluded**:
  - Payment gateway processing (Stripe / Omise / Opn).
  - LINE OA / LIFF / SlipOK integration.
  - Production / Pilot external payment webhooks.
  - Wave 1G features.

---

## 4. Authoritative Domain & Legacy-Write Boundary
- `DormitorySubscription` and `SubscriptionEntitlementService` are established as the **sole authoritative source of truth** for all subscription status, room limits, and read-only decisions.
- Legacy tables (`PlatformSubscription`, `PlatformPlan`, `PlatformPromoCode`, `PlatformPromoRedemption`) are preserved only as dormant historical data.
- **Dual Write Elimination**: `DormitoryProvisioningService` writes ONLY to `DormitorySubscription`, `SubscriptionStatusHistory`, and `PromoRedemption` inside the onboarding transaction. Dual writes to `PlatformSubscription` and `PlatformPromoRedemption` are completely removed.

---

## 5. Route Pipeline & Middleware Ordering

Protected business mutation routes execute in this exact sequence:
1. Parse cookies (`cookieParser`)
2. Validate authenticated session (`requireSession`)
3. Populate `req.auth`
4. Resolve authoritative Dormitory membership context (`resolveAuthoritativeDormitoryContext`)
5. Enforce role/permission (`requirePermission` / role check)
6. Enforce subscription write entitlement (`requireDormitoryWriteEntitlement`)
7. Validate CSRF (`verifyCsrfToken`)
8. Execute mutation

Unauthenticated requests to business mutation routes return HTTP 401 `UNAUTHORIZED`. The bypass `if (!req.auth || !req.auth.user) return next()` has been completely removed.

---

## 6. Route-Audit Matrix (13 Business Mutation Domains)

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
| Maintenance | `POST/PUT/DELETE /api/v1/maintenance-requests` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Announcements | `POST/PUT/DELETE /api/v1/announcements` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |
| Move-Out | `POST /api/v1/move-out/requests` | `requireSession` | `resolveAuthoritativeDormitoryContext` | `requireDormitoryWriteEntitlement` | 403 `SUBSCRIPTION_READ_ONLY` | 200 OK |

---

## 7. Dormitory-Context Authorization & Role Fail-Closed Logic

`resolveAuthoritativeDormitoryContext(req)` enforces:
- Membership validation against user's active memberships.
- Missing role object or missing role code -> throws HTTP 403 `MEMBERSHIP_ROLE_INVALID`.
- Missing role permissions -> evaluates to empty array `[]` (never defaults to `['*']` or `OWNER`).
- Target dormitory header tampering (Header `x-dormitory-id` mismatching membership) -> throws HTTP 403 `FORBIDDEN`.

---

## 8. Removal of Public Operational Activation Route & Local CLI

- Deleted route `POST /api/v1/subscription/operational/activate` from Express router completely. Requests return HTTP 404 `ROUTE_NOT_FOUND`.
- Operational paid activation is available ONLY via:
  - Local-only CLI script (`server/src/cli/activate-subscription.ts`).
  - Direct internal service invocation in tests/scripts (`subscriptionEntitlementService.activatePaidSubscriptionOperational`).
- **CLI Safety Guards**:
  - Requires `ALLOW_OPERATIONAL_ACTIVATION=true`.
  - Refuses `NODE_ENV === 'production'`.
  - Refuses Pilot database names (`horplus_pilot`).
  - Refuses port `5432`.
  - Refuses non-loopback hosts.
  - Requires operational actor ID, idempotency key, and reason.

---

## 9. Schema & Migration Evidence
- Applied migrations on disposable local test container (`127.0.0.1:5455`):
  1. `20260805130000_wave1f_subscriptions_entitlements`
  2. `20260805140000_wave1f_subscription_fk_corrective`

### Command: `npx prisma migrate status`
- **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
- **Exit Code**: 0
- **Output**:
  ```text
  Database schema is up to date!
  7 migrations found in prisma/migrations
  ```

---

## 10. Room-Limit Transaction & Concurrency

- `RoomService.createRoom` executes under PostgreSQL advisory lock (`SELECT pg_advisory_xact_lock(hashtext(dormitoryId))`) inside a single atomic database transaction.
- `assertRoomCreationAllowed`, `getEffectiveEntitlements`, and `getCurrentSubscription` accept and use the transaction client `tx` holding the advisory lock. No quota query escapes to a separate Prisma connection.
- **Verified Boundary Results**:
  - **Free Boundary (10 limit)**: 9 seeded -> 2 concurrent creations -> 1 succeeded (room 10), 1 returned HTTP 409 `ROOM_LIMIT_REACHED`.
  - **Paid Boundary (150 limit)**: 149 seeded -> 2 concurrent creations -> 1 succeeded (room 150), 1 returned HTTP 409 `ROOM_LIMIT_REACHED`.

---

## 11. Verification & Verification Commands

### Backend Verification (`server/`)
- **Lint (`npm run lint`)**: Exit code 0 (0 errors).
- **TypeScript (`npx tsc --noEmit`)**: Exit code 0 (0 errors).
- **Build (`npm run build`)**: Exit code 0.
- **Vitest Unit/Integration Suite (`npm test`)**:
  - **Command**: `npm test`
  - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
  - **Exit Code**: 0
  - **Results**: 14 test files passed (14/14), 74 individual tests passed (74/74), 0 failed.
- **Prisma Validate & Status**:
  - `npx prisma validate`: Schema is valid 🚀
  - `npx prisma migrate status`: Database schema is up to date!

### Frontend & E2E Verification (Root)
- **Lint (`npm run lint`)**: Exit code 0 (0 errors).
- **TypeScript (`npx tsc --noEmit`)**: Exit code 0 (0 errors).
- **E2E TypeScript (`npx tsc --noEmit -p tsconfig.e2e.json`)**: Exit code 0 (0 errors).
- **Build (`npm run build`)**: Exit code 0 (Vite built 2704 modules transformed).
- **Playwright Suite (`npx playwright test`)**:
  - **Command**: `npx playwright test`
  - **Working Directory**: `D:\horplus_wave1d_fasttrack`
  - **Exit Code**: 0
  - **Results**: 6 tests passed (6/6), 0 failed. Complete 18-step E2E lifecycle spec verified.

### Docker & Health Checks
- **Docker Compose Pilot Config**: `docker compose -f docker-compose.windows-pilot.yml config` (Exit code 0).
- **Docker Compose Pilot Build**: `docker compose -f docker-compose.windows-pilot.yml build` (Exit code 0).
- **Health Check Endpoints**:
  - `GET /health/liveness`: 200 OK (`{"status":"UP"}`)
  - `GET /health/readiness`: 200 OK (`{"status":"UP"}`)
  - `GET /health/metrics`: 200 OK

---

## 12. Commits & PR #2 Status
- **Forward-Only Commit**: `fix(wave1f): enforce authenticated entitlement pipeline, fail-closed role resolution, remove operational route & eliminate legacy dual-writes`
- **Local SHA**: `60bb62e20dc5246b0292b591d3c20bd0e7fdb180`
- **Remote SHA**: `60bb62e20dc5246b0292b591d3c20bd0e7fdb180`
- **Working Tree**: Clean.
- **PR #2**: Open & unmerged against `recovery/wave1d-fasttrack`.

---

## 13. Final Verdict

WAVE 1F SUBSCRIPTIONS AND ENTITLEMENTS: PASSED
