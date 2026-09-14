# Specification: Subscription Multi-Role Access (Manager, Direct Owner, Google Owner)
Document ID: SPEC-SUB-MR-01
Status: Proposed (Gate A Review)
Date: 2026-09-14

## 1. Executive Summary & Problem Statement
Under previous constraints, only the primary Owner had access to the Subscription module (`/owner/subscription` and related APIs). However, dormitories operated with daily management staff require that:
1. 🔑 **ผู้จัดการ (`MANAGER`)**
2. 👑 **เจ้าของลิงก์ตรง (`OWNER` via Direct Access Grant)**
3. 🌐 **เจ้าของ Google (`GOOGLE OWNER` via Google OAuth)**

can manage the subscription (ต่อแพ็กเกจ, ดูสถานะแพ็กเกจ, ขอใบเสนอราคา Quote, ใช้โค้ดส่วนลด/เพิ่มวัน Promo Code, แนบสลิปชำระเงิน Slip Upload, และเปิดใช้งานสิทธิ์แพ็กเกจ).
At the same time, 🛠️ **ช่าง / แม่บ้าน (`STAFF`)** must remain strictly barred from subscription management.

## 2. Acceptance Criteria

### SMA-01: Manager & Direct Owner Frontend Navigation & URL Protection
- In `src/pages/owner.tsx`, `menuItems` for `subscription` (`id: 'subscription'`, label: `'ต่อแพ็กเกจ'`) must include `roles: ['owner', 'manager']`.
- In `changeTab()`, remove `'subscription'` from the blocked tabs check for `userRole === 'manager'`.
- In `useEffect` URL route guard, include `'subscription'` in `allowedTabs` for `manager`. Direct navigation to `/owner/subscription` must render `OwnerSubscription` for manager rather than redirecting to `/owner/dashboard`.
- For `staff`, `subscription` remains excluded from navigation and URL guard redirects immediately to `/owner/dashboard`.

### SMA-02: System Role & Context Permission Alignment
- In `server/src/db/repositories/role.repository.ts`, add `subscription: ['view', 'read', 'write', 'manage']` to the default permissions of the `MANAGER` system role.
- In `server/src/middleware/dormitory-context.ts`, append `subscription:view`, `subscription:read`, `subscription:write`, and `subscription:manage` to `managerOperationalPermissions`.
- Update `server/src/__tests__/unit/manager-permissions.test.ts` to assert that Manager possesses `subscription:view/read/write/manage`, while keeping negative assertions against `subscription:*` (wildcard) and `payment_settings:*` (FIND-SMA-03).
- Preserve existing owner-only exclusions (`payment_settings`, `staff:manage`, `dormitory:delete`, `dormitory:transfer`).

### SMA-03: Access Grant Identity Resolution for Subscription Quote & Intent
- In `server/src/services/subscription-intent.service.ts`:
  - Update `resolveOnboardingDormitoryId` to recognize `role: { code: { in: ['OWNER', 'ADMIN', 'MANAGER'] } }`.
  - For Direct Access Grant sessions (`userId` starting with `ag_user_` or `ag_`), query `dormitoryAccessGrant`. If role is `OWNER` or `MANAGER` and status is `ACTIVE`, resolve the dormitory ID and map the authoritative `userId` for the intent to the dormitory creator (`dormitory.createdByUserId`) to satisfy the PostgreSQL native `@db.Uuid` and foreign key relation to `users(id)`. If `dormitory.createdByUserId` is null, fall back to querying an active `OWNER` in `dormitoryMember` (FIND-SMA-04).
  - In `commitZeroPayIntent`, allow execution if `intent.userId === userId` OR the requesting user has `OWNER` or `MANAGER` role for `intent.dormitoryId`.
  - In `commitZeroPayIntent`, pass `intent.userId` (instead of raw caller `userId`) to `coinWalletService.debitWallet` to prevent PostgreSQL UUID format crash when caller is an access grant (FIND-SMA-02).

### SMA-04: Non-UUID & Foreign Key Safe Actor Recording in Slip Verification & Promo Redemption
- In `server/src/routes/subscription.routes.ts`:
  - When saving `subscriptionStatusHistory.create`, sanitize `actorId`. If `userId` does not correspond to an existing row in `users`, set `actorId: null` to avoid foreign key violations.
  - When creating `subscriptionPaymentEvidence.create`, sanitize `userId` by stripping `ag_user_` or falling back to `dormitory.createdByUserId` so it is a valid UUID without throwing Prisma `P2023`.
  - In `POST /api/v1/subscription/promo/redeem`, ensure `isOwner || (isManager && hasPromoPermission)` succeeds for Manager and sanitizes user identifiers.
  - In slip transaction, debit coin wallet using `intent.userId` (the authoritative Google owner account holding the coin wallet).
- In `server/src/services/promo.service.ts`:
  - Sanitize `actorId` in `subscriptionStatusHistory` (null if not in `users`).
  - Set `redeemedBy` in `promoRedemption` to `dormitory.createdByUserId` (or active owner member) when redemption is performed via an access grant not in `users`.

### SMA-05: Staff Strict Barrier Preservation
- In `server/src/routes/subscription-quote.routes.ts`, add explicit role checks in `POST /api/v1/subscription/quote` and `POST /api/v1/subscription/commit` so that any invocation with role `STAFF` fails closed with HTTP 403 Forbidden (FIND-SMA-01).
- In `server/src/routes/subscription.routes.ts`, `POST /api/v1/subscription/payment/slip` strictly enforces `isOwner || isManager`, failing closed with HTTP 403 Forbidden if called by `STAFF`.
- In `POST /api/v1/subscription/promo/redeem`, non-manager/non-owner sessions (such as `STAFF`) fail closed with HTTP 403 Forbidden.

## 3. Locked Behaviors
- SEC-01 through SEC-08 security controls remain strictly untouched.
- Multi-tenant dormitory isolation is preserved.
- Slip verification engine integrity (anti-race condition pre-lock, magic bytes check, server-side zero-trust price calculation) remains strictly preserved.
- Approved Thai copywriting ("ระบบตรวจสลิป", "ต่อแพ็กเกจ", "ช่าง / แม่บ้าน", "ผู้จัดการ", "เจ้าของหอพัก") preserved.

