# Execution Report: Wave 1F Subscription & Entitlement Corrective Pass

## 1. Executive Verdict
- **Status**: PASSED (100% COMPLETE & VERIFIED)
- **Pull Request**: [#2](https://github.com/phoom007/HorPlus-V2/pull/2) (Unmerged, Open)
- **Branch**: `feature/wave1f-subscriptions-entitlements`
- **Target Base**: `recovery/wave1d-fasttrack`
- **Result**: All corrective requirements, authorization boundaries, persistent idempotency rules, PostgreSQL advisory locks, schema migrations, backend tests, frontend builds, Playwright E2E scenarios, Docker builds, and health endpoints passed cleanly without errors.

---

## 2. Base & Branch Context
- **Wave 1E Merged Base SHA**: `14db61f6e87ef121a87b04699dfd19bba85e345a`
- **Wave 1F Starting Feature SHA**: `18f0241e4cd74da7df677fce96537d834e85c929`
- **Repository Path**: `D:\horplus_wave1d_fasttrack`

---

## 3. Scope & Exclusions
- **Included**:
  - Authoritative single domain: `DormitorySubscription` and `SubscriptionEntitlementService`.
  - Authoritative `resolveAuthoritativeDormitoryContext` middleware blocking header/query/body tampering and cross-tenant access.
  - Automatic 30-day trial provisioning for new dormitories in atomic creation transactions.
  - Existing-dormitory trial backfill with history tracking.
  - Promo code `HORPLUS` (+60 days extension, max 1 per dorm, active trial only) with persistent `X-Idempotency-Key` handling.
  - Room quota enforcement (Plan A / Free / Trial: 10 rooms; Plan B / Paid: 150 rooms; Owner quota: 10 dormitories).
  - Atomic room creation concurrency protection using PostgreSQL advisory locks (`pg_advisory_xact_lock`).
  - Strict over-limit & expired read-only mode (`isReadOnly = true`, HTTP 403 `SUBSCRIPTION_READ_ONLY`) preserving historical data visibility.
  - Package catalog (1 month = 189 THB enabled; 3, 6, 12, 24 months unpriced & disabled).
  - Insecure public paid activation endpoint removed; internal operational paid activation implemented with persistent idempotency and extension from `max(expiresAt, now)`.
  - Schema forward migration `20260805140000_wave1f_subscription_fk_corrective` adding `ON DELETE RESTRICT` foreign keys and audit indexes.
- **Excluded**:
  - Payment gateway processing (Stripe / Omise / Opn).
  - LINE OA / LIFF / SlipOK integration.
  - Production / Pilot external payment webhooks.
  - Wave 1G features.

---

## 4. Authoritative Subscription Domain Decision
- `DormitorySubscription` and `SubscriptionEntitlementService` are established as the **sole authoritative source of truth** for all subscription status, room limits, and read-only decisions.
- Legacy tables (`PlatformSubscription`, `PlatformPlan`, `PlatformPromoCode`, `PlatformPromoRedemption`) are preserved only as dormant historical data.
- Modifying legacy tables cannot alter effective entitlement.
- **Future Cleanup Path**: Deprecate legacy tables in Wave 2 with zero-downtime table drop migrations after all legacy readers are fully decommissioned.

---

## 5. Schema & Migrations Evidence
- **Applied Migrations**:
  1. `20260805130000_wave1f_subscriptions_entitlements`: Tables `subscription_plans`, `subscription_packages`, `dormitory_subscriptions`, `subscription_status_histories`, `promo_codes`, `promo_redemptions`.
  2. `20260805140000_wave1f_subscription_fk_corrective`: Added `ON DELETE RESTRICT` foreign key constraints:
     - `subscription_status_histories.dormitory_id` -> `dormitories(id)`
     - `subscription_status_histories.previous_plan_id` -> `subscription_plans(id)`
     - `subscription_status_histories.new_plan_id` -> `subscription_plans(id)`
     - `subscription_status_histories.actor_id` -> `users(id)`
     - `promo_redemptions.redeemed_by` -> `users(id)`
     - Indexes: `idx_sub_hist_actor_id`, `idx_promo_redemption_redeemed_by`.

### Command: `npx prisma migrate status`
- **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
- **Exit Code**: 0
- **Output**:
  ```text
  Database schema is up to date!
  7 migrations found in prisma/migrations
  ```

---

## 6. Authoritative Dormitory Context & Security Matrix

### Resolution Rules
`resolveAuthoritativeDormitoryContext(req)` resolves dormitory context server-side by validating the authenticated session, filtering active `DormitoryMember` records, and verifying the requested context against active user memberships.
- Header `x-dormitory-id` or query/body parameters are treated strictly as unverified requested selectors.
- Cross-dormitory header tampering throws HTTP 403 `FORBIDDEN`.
- Unauthenticated requests throw HTTP 401 `UNAUTHORIZED`.
- Fallbacks to static IDs like `dorm-001` are strictly prohibited and eliminated.

### Authorization Matrix Verification
| Actor Role | Subscription Read | Promo Redeem | Mutation Business API | Expected Result |
| :--- | :--- | :--- | :--- | :--- |
| Anonymous | Blocked (401) | Blocked (401) | Blocked (401) | 401 UNAUTHORIZED |
| Owner | Allowed (200) | Allowed (200) | Allowed (200/201) | Permitted |
| Manager | Allowed (200) | Allowed (200) | Allowed by role | Permitted |
| Technician / Housekeeping | Allowed (200) | Blocked (403) | Blocked (403) | 403 FORBIDDEN |
| Non-Member / Cross-Dorm Owner | Blocked (403) | Blocked (403) | Blocked (403) | 403 FORBIDDEN |
| Header Tamperer | Blocked (403) | Blocked (403) | Blocked (403) | 403 FORBIDDEN |

---

## 7. New Dormitory Provisioning & Backfill
- **New Dormitory Provisioning**: Provisions 1 30-day Trial in `DormitorySubscription` and 1 `SubscriptionStatusHistory` record (`reason = INITIAL_PROVISIONING_30_DAY_TRIAL`) inside the same atomic database transaction as dormitory creation.
- **Existing-Dormitory Backfill**: `subscriptionEntitlementService.backfillExistingDormitories()` backfills all unprovisioned dormitories idempotently with trial subscriptions and status history records (`reason = EXISTING_DORMITORY_BACKFILL_30_DAY_TRIAL`).
- **Read Operation Safety**: `getCurrentSubscription(dormitoryId)` throws HTTP 404 `SUBSCRIPTION_NOT_FOUND` if a subscription does not exist. It never provisions subscriptions as a GET side-effect.

---

## 8. Promo Code & Idempotency Rules
- **Promo Code `HORPLUS`**: Extends trial by +60 days (total 90 days).
- **Persistent Idempotency**: `POST /api/v1/subscription/promo/redeem` enforces header `X-Idempotency-Key`.
  - Same key + payload -> Replays cached completed response without duplicating trial extension.
  - Same key + payload mismatch -> Returns HTTP 409 `IDEMPOTENCY_MISMATCH`.
  - Second redemption with new key -> Returns HTTP 409 `PROMO_ALREADY_REDEEMED`.
  - Expired trial -> Returns HTTP 403 `SUBSCRIPTION_READ_ONLY`.

---

## 9. Room Limits & PostgreSQL Concurrency Locks
- **Quota Limits**: Free/Trial Plan = 10 rooms; Paid Plan = 150 rooms; Owner quota = 10 dormitories max.
- **Concurrent Creation Protection**: `RoomService.createRoom` acquires PostgreSQL transaction lock (`SELECT pg_advisory_xact_lock(hashtext(dormitoryId))`) inside an atomic transaction.
- **Verified Boundary Results**:
  - **Free Boundary (9 existing rooms + 2 concurrent creations)**: Exactly 1 creation succeeded (room 10), exactly 1 returned HTTP 409 `ROOM_LIMIT_REACHED`. Final count = 10.
  - **Paid Boundary (149 existing rooms + 2 concurrent creations)**: Exactly 1 creation succeeded (room 150), exactly 1 returned HTTP 409 `ROOM_LIMIT_REACHED`. Final count = 150.

---

## 10. Operational Paid Activation Safety
- Removed public `POST /api/v1/subscription/activate` endpoint and UI "Activate 1 Month" button from Owner Portal.
- Owner Portal displays "Awaiting platform activation" for purchasable packages.
- Operational activation implemented via internal service `subscriptionEntitlementService.activatePaidSubscriptionOperational`:
  - Restricted to environments where `process.env.ALLOW_OPERATIONAL_ACTIVATION === 'true'` or dev/test mode. Blocked with HTTP 403 `OPERATIONAL_ACTIVATION_DISABLED` in production.
  - Calculates renewal expiry from `max(currentExpiresAt, now)` to ensure subscriptions are never shortened.
  - Uses persistent idempotency keys.

---

## 11. Over-Limit & Expired Read-Only Behavior
- When `roomCount > roomLimit` or `expiresAt <= now`:
  - `isReadOnly` is set to `true`.
  - All GET/read endpoints remain 100% accessible.
  - Historical rooms, buildings, contracts, and tenant data are preserved without deletion or archiving.
  - Business mutations (POST/PUT/PATCH/DELETE) are blocked with HTTP 403 `SUBSCRIPTION_READ_ONLY`.
  - Entitlement reason explicitly identifies `ROOM_LIMIT_EXCEEDED` or `SUBSCRIPTION_EXPIRED`.

---

## 12. Verification & Verification Commands

### Backend Verification (`server/`)
- **Lint (`npm run lint`)**: Exit code 0 (0 errors).
- **TypeScript (`npx tsc --noEmit`)**: Exit code 0 (0 errors).
- **Build (`npm run build`)**: Exit code 0.
- **Vitest Unit/Integration Suite (`npm test`)**:
  - **Command**: `npm test`
  - **Working Directory**: `D:\horplus_wave1d_fasttrack\server`
  - **Exit Code**: 0
  - **Results**: 14 test files passed (14/14), 76 individual tests passed (76/76), 0 failed.
- **Prisma Validate & Status**:
  - `npx prisma validate`: Schema is valid 🚀
  - `npx prisma migrate status`: Database schema is up to date!

### Frontend & E2E Verification (Root)
- **Lint (`npm run lint`)**: Exit code 0 (0 errors).
- **TypeScript (`npx tsc --noEmit`)**: Exit code 0 (0 errors).
- **Build (`npm run build`)**: Exit code 0 (Vite built 2704 modules transformed).
- **Playwright Suite (`npx playwright test`)**:
  - **Command**: `npx playwright test`
  - **Working Directory**: `D:\horplus_wave1d_fasttrack`
  - **Exit Code**: 0
  - **Results**: 6 tests passed (6/6), 0 failed. Includes complete Wave 1F Subscription lifecycle E2E spec.

### Docker & Health Checks
- **Docker Compose Pilot Config**: `docker compose -f docker-compose.windows-pilot.yml config` (Exit code 0).
- **Docker Compose Pilot Build**: `docker compose -f docker-compose.windows-pilot.yml build` (Exit code 0).
- **Health Check Endpoints**:
  - `GET /health/liveness`: 200 OK (`{"status":"UP","timestamp":"..."}`)
  - `GET /health/readiness`: 200 OK (`{"status":"UP","checks":{...}}`)
  - `GET /health/metrics`: 200 OK

---

## 13. Commits and PR #2 Status
- Forward-only corrective commits pushed to `feature/wave1f-subscriptions-entitlements`:
  - `fix(wave1f): enforce subscription authorization boundaries`
  - `fix(wave1f): unify entitlement source and activation safety`
  - `test(wave1f): prove concurrent room and promo limits`
  - `docs(wave1f): finalize subscription closure evidence`
- **Local SHA**: Matches Remote `origin/feature/wave1f-subscriptions-entitlements`
- **PR #2**: Open & unmerged against `recovery/wave1d-fasttrack`.

---

## 14. Final Verdict

WAVE 1F SUBSCRIPTIONS AND ENTITLEMENTS: PASSED
