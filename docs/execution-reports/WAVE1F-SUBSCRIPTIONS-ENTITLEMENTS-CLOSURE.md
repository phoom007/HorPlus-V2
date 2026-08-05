# Wave 1F: Subscriptions and Entitlements Execution Report

## Executive Summary
This document records the complete implementation, database migration, automated testing, browser verification, and security posture of **Wave 1F: Subscriptions and Entitlements** for HorPlus-V2.

Wave 1F establishes authoritative multi-tenant subscription management, trial provisioning, promo code redemption (`HORPLUS`), quota enforcement (room limit & dormitory limit), and automatic expired-dormitory `READ_ONLY` mode.

---

## 1. Git & Branching Audit
* **Merged Base SHA (Wave 1E PR #1)**: `14db61f6e87ef121a87b04699dfd19bba85e345a`
* **Target Integration Branch**: `recovery/wave1d-fasttrack`
* **Wave 1F Feature Branch**: `feature/wave1f-subscriptions-entitlements`
* **Pull Request**: Submitted against `recovery/wave1d-fasttrack`

---

## 2. Database & Migration DDL Summary
* **Migration Name**: `20260805130000_wave1f_subscriptions_entitlements`
* **Execution Status**: Applied idempotently via `npx prisma migrate deploy` on PostgreSQL 15 (`127.0.0.1:5455`).
* **Enums Added**:
  - `SubscriptionPlanType`: `FREE`, `PAID`
  - `DormitorySubscriptionStatus`: `TRIAL`, `ACTIVE`, `SUSPENDED`, `EXPIRED`, `CANCELLED`
* **Tables Added**:
  - `subscription_plans`: Plan definitions (`FREE` limit 10, `PAID` limit 150)
  - `subscription_packages`: Package options per plan (1, 3, 6, 12, 24 months)
  - `dormitory_subscriptions`: 1-to-1 dormitory active subscription lifecycle
  - `subscription_status_histories`: Immutable audit trail for all plan transitions
  - `promo_codes`: Promo code configuration (`HORPLUS`, 60 days extension)
  - `promo_redemptions`: Idempotent 1-time redemption per dormitory (`UNIQUE(promo_code_id, dormitory_id)`)
* **Database Check Constraints**:
  - `chk_sub_plan_room_limit_pos`: `room_limit > 0`
  - `chk_sub_pkg_duration_months`: `duration_months IN (1, 3, 6, 12, 24)`
  - `chk_promo_code_extension_days_pos`: `extension_days > 0`
  - `chk_promo_redemption_dates`: `new_expires_at > previous_expires_at`

---

## 3. Financial Decision Log
> [!IMPORTANT]
> **Priced vs. Disabled Packages**:
> - **1 Month Package**: Enabled at 189.00 THB. Operational activation supported.
> - **3, 6, 12, 24 Months Packages**: Preserved in database with `price = NULL` and `enabled = false` as unpriced disabled packages until explicit Product Owner pricing decisions are provided. Attempting to activate unpriced packages safely returns `PACKAGE_DISABLED` (400).

---

## 4. Business Rules & Entitlement Matrix
* **Plan Rules**:
  - **Plan A (Free/Trial)**: Max 10 rooms per Dormitory. Automatic 30-day trial created upon dormitory provisioning.
  - **Plan B (Paid)**: Max 150 rooms per Dormitory. 1-month duration = 189 THB.
* **Promo Code `HORPLUS`**:
  - Adds +60 days trial extension (total 90-day trial).
  - Restricted to active Trial status dormitories only.
  - Strictly 1 redemption per dormitory max.
* **Quotas**:
  - **Owner Quota**: Maximum 10 dormitories per Owner account. 11th creation attempt returns `DORMITORY_LIMIT_REACHED` (409).
* **Read-Only Mode**:
  - Triggered immediately when `expiresAt <= now`.
  - All GET/read endpoints remain 100% accessible.
  - All POST/PUT/PATCH/DELETE business mutation endpoints return `SUBSCRIPTION_READ_ONLY` (403).

---

## 5. API Endpoint Matrix

| Method | Endpoint | Auth Required | Description | Status Codes |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/subscription/current` | Yes | Get active subscription details | 200, 400, 401 |
| `GET` | `/api/v1/subscription/entitlements` | Yes | Get calculated entitlements & room usage | 200, 400, 401 |
| `GET` | `/api/v1/subscription/plans` | Yes | Get purchasable package catalog | 200, 401 |
| `POST` | `/api/v1/subscription/promo/redeem` | Yes + CSRF | Redeem `HORPLUS` promo code | 200, 400, 401, 404, 409 |
| `POST` | `/api/v1/subscription/activate` | Yes + CSRF | Operational test package activation | 200, 400, 401, 409 |

---

## 6. Test Suite Matrix

### Automated Backend Test Suite (`server/tests/wave1f-subscriptions.test.ts`)
* **Total Tests**: 10 passed
* **Coverage**:
  - Initial 30-day trial provisioning
  - `HORPLUS` promo code single redemption & trial extension (+60 days)
  - Duplicate promo code denial (409)
  - Invalid/expired promo code denial (400/404)
  - Free/Trial 10-room quota assertion (409)
  - Concurrency safety at room quota boundary
  - Read-only mutation block when expired (403)
  - 1-Month Paid package activation & 150-room limit extension
  - Unpriced package activation denial (400)
  - Owner 10-dormitory quota assertion (409)
  - Idempotent legacy dormitory backfill

### End-to-End Playwright Suite (`tests/e2e/wave1f-subscription.spec.ts`)
* **Total Specs Passed**: 6/6 E2E spec files passed (100%)
* **Scenarios Verified**:
  - Real browser context & PostgreSQL session authentication
  - Direct navigation to `/owner/subscription` UI tab
  - UI display of 30-day Trial status & 10-room meter
  - UI promo redemption of `HORPLUS` with instant +60 day extension
  - UI disabled promo form showing "Already Redeemed" after redemption
  - API enforcement of 10-room limit on Plan A (409 `ROOM_LIMIT_REACHED`)
  - Operational activation of 1-Month Paid package (Plan B, 150 rooms)
  - Successful room creation after Plan B activation
  - Read-Only mode banner displayed when subscription is expired
  - Business mutation blocked with `SUBSCRIPTION_READ_ONLY` (403) while GET read access remains functional

---

## 7. Verification Artifacts & Builds
* **Prisma Schema Validation**: Validated (`npx prisma validate`)
* **Prisma Client Generation**: Clean (`npx prisma generate`)
* **Prisma Migration Status**: Database up to date (`npx prisma migrate status`)
* **Backend TypeScript Lint & Build**: Passed with 0 errors (`npm run lint`, `npm run build` in `server/`)
* **Frontend TypeScript Lint & Build**: Passed with 0 errors (`npm run lint`, `npm run build` in root)
* **Docker Compose Pilot Build**: Successfully built `horplus_wave1d_fasttrack-api:latest` (`docker compose -f docker-compose.windows-pilot.yml build`)
* **Health Endpoint Check**:
  - `/health/liveness`: UP (HTTP 200)
  - `/health/readiness`: Database UP (HTTP 200)
  - `/health/metrics`: HTTP 200

---

## 8. Conclusion
Wave 1F Subscriptions and Entitlements implementation is fully closed, tested, verified, and ready for PR merge.
