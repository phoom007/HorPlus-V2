# Specification: Manager Role Operational Permissions & Workspace Enablement (MGR-01 - MGR-05)

## Status: Draft for Review (Gate A)

---

## 1. Objective & Background
Following PO testing in the Manager role ("ผู้จัดการ"), multiple operations across visible menus were blocked with permission errors (e.g. In `/owner/meters`, clicking the bill toggle switch or meter saving threw `"ไม่มีสิทธิ์ดำเนินการกับบิลนี้"` via HTTP 403 Forbidden).

The Product Owner requested:
> *"สิทธิ์ของ 'ผู้จัดการ' ดูเหมือนยังทำอะไม่ได้จริงเลยครับ ขึ้นแต่ยังไม่มีสิทธิ์ ปรับให้แต่ละเมนูที่แสดงแก้ไขและทำงานได้จริงทีครับ"*

This specification establishes the authoritative operational permissions for the Manager role across all 8 visible modules, ensuring full interactive and mutation capabilities while strictly enforcing owner-only security boundaries.

---

## 2. Canonical Authorities & Locked Behaviors
- **Tenant Isolation**: Strict dormitory tenancy boundaries via `dormitory_id` and RLS.
- **RBAC Separation of Duties**:
  - **Manager (ผู้จัดการ)**: Full day-to-day operational execution (Rooms, Meters, Bills, Payments, Tenants, Contracts, Maintenance, Announcements, Reports).
  - **Owner-Only Locked Boundaries (เจ้าของหอพัก)**:
    1. **Staff & Access Token Management (`staff:manage`)**: Only Owner can view, create, copy, or revoke access grant links (`/owner/users`).
    2. **Payment Bank Account & PromptPay Configuration (`payment_settings:*`)**: Only Owner can view or update dormitory payment credentials. Manager access must fail-closed with HTTP 403.
    3. **Subscription & Plan Upgrades (`subscription:*`)**: Only Owner can upgrade plans or manage billing subscriptions (`/owner/subscription`).
    4. **Dormitory Deletion & Transfer**: Only Owner can delete or transfer dormitory properties (`/owner/settings`).
    5. **Global Wildcard (`*`)**: Non-owner roles never retain global wildcard authority.
- **Thai Copywriting & Display**:
  - Manager display title: `"ผู้จัดการ"`
  - Approved status badges, Thai button labels, and toast messages preserved.

---

## 3. Acceptance Criteria

### [MGR-01] Centralized Authoritative Operational Permissions in Dormitory Context
In `server/src/middleware/dormitory-context.ts`, when `roleCode === 'MANAGER'`, assign the authoritative operational permission set across all 8 visible manager modules:
- **Meters Domain**:
  `meters:view`, `meters:read`, `meter:read`, `meters:record`, `meters:write`, `meter:write`
- **Billing & Bills Domain**:
  `bills:view`, `bills:read`, `bill:read`, `bills:generate`, `bills:create`, `bills:write`, `bills:cancel`, `bill:create`, `bill:write`, `billing:view`, `billing:read`, `billing:write`, `billing:manage`, `billing_cycles:view`, `billing_cycles:create`, `billing_cycles:update`, `billing_cycle:read`, `billing_cycle:write`, `billing_cycle:create`
- **Payments & Receipts Domain**:
  `payments:view`, `payments:read`, `payment:read`, `payments:create`, `payments:write`, `payments:manage`, `payment:write`, `payment:create`, `receipts:view`, `receipts:read`, `receipt:read`, `receipts:manage`, `receipt:write`
- **Property (Rooms & Buildings) Domain**:
  `rooms:view`, `rooms:read`, `room:read`, `rooms:create`, `rooms:update`, `rooms:delete`, `rooms:manage`, `room:write`, `room:create`, `room:update`, `room:delete`, `buildings:view`, `buildings:read`, `building:read`, `buildings:create`, `buildings:update`, `buildings:delete`, `buildings:manage`, `building:write`, `building:create`, `building:update`, `building:delete`, `property:read`, `property:write`, `property:manage`
- **Tenants, Contracts, Occupancy, Move-Out, Settlements**:
  `tenants:view`, `tenants:create`, `tenants:update`, `tenants:archive`, `tenants:document:read`, `tenants:document:write`, `tenant:view`, `tenant:create`, `tenant:update`, `tenant:archive`, `tenant:document:read`, `tenant:document:write`, `tenant:read`, `tenant:write`, `tenants:read`, `tenants:write`, `contracts:view`, `contracts:create`, `contracts:update`, `contracts:delete`, `contracts:manage`, `contract:read`, `contract:write`, `contract:create`, `contract:update`, `contract:delete`, `occupancy:view`, `occupancy:read`, `occupancy:write`, `moveout:write`, `moveout:read`, `moveout:view`, `move_out:create`, `settlement:read`, `settlement:write`, `daily_stays:view`, `daily_stays:create`, `daily_stays:update`, `daily_stay:read`, `daily_stay:write`
- **Maintenance Domain**:
  `maintenance:view`, `maintenance:read`, `maintenance:create`, `maintenance:update`, `maintenance:close`, `maintenance:write`, `maintenance:delete`
- **Announcements Domain**:
  `announcements:view`, `announcements:read`, `announcement:read`, `announcements:create`, `announcements:update`, `announcements:delete`, `announcements:manage`, `announcement:write`, `announcement:create`, `announcement:update`, `announcement:delete`
- **Reports & Analytics Domain**:
  `reports:view`, `reports:read`, `report:view`, `report:read`, `billboard:view`, `billboard:read`, `analytics:view`
- **Dormitory Core View**:
  `dormitory:view`, `dormitory:read`

### [MGR-02] Owner-Only Security Boundaries & Tenant Isolation Preserved
- Manager role MUST NOT receive `staff:manage` / `users:manage` / `access_grants:manage`.
- Manager role MUST NOT receive `payment_settings:view` / `payment_settings:read` / `payment_settings:update` / `payment_settings:write` (strictly preserves HTTP 403 assertions in `payment-security.test.ts`).
- Manager role MUST NOT receive `subscription:*` or plan billing privileges.
- Manager role MUST NOT receive `dormitory:delete` or `dormitory:transfer`.
- Global `*` wildcard remains stripped for all non-OWNER roles.

### [MGR-03] Role Repository & Auth Service Scoping Parity
- In `server/src/services/auth.service.ts`: Pass `grant.dormitoryId` when resolving roles via `roleRepo.findByCode(grant.roleCode, grant.dormitoryId)` so tenant-specific role definitions take priority over random test roles.
- In `server/src/db/repositories/role.repository.ts`:
  - Update `seedSystemRoles()` for `role-manager` to align with the complete operational permission set.
  - In `PrismaRoleRepository.findByCode`, prioritize matching `dormitoryId` over generic `null` or unassigned rows.

### [MGR-04] Frontend Manager Experience & Action Enabling
- In `src/pages/owner/meters.tsx`:
  - The "ออกบิลทุกห้อง" bulk action button and per-room toggle switch remain fully enabled for Manager (`userRole !== 'staff'`).
  - Meter reading inputs and other fees ("+ เพิ่มค่าใช้จ่าย") remain fully interactive.
- In `src/pages/owner/dashboard.tsx`:
  - Quick action buttons (Add Tenant, Record Meters, View Payments, Maintenance) are fully active and navigate correctly for Manager.
  - Dashboard operational cards and room occupancy list are fully interactive.
- In `src/pages/owner.tsx`:
  - All 8 manager menus (`dashboard`, `meters`, `payments`, `rooms`, `tenants`, `maintenance`, `announcements`, `reports`) remain visible and interactive.
  - Menus outside Manager scope (`users`, `subscription`, `settings`) remain hidden from Manager navigation.

### [MGR-05] Automated Test Suite & Build Verification
- Unit and integration tests verify Manager execution across all 8 modules (Meters, Billing, Payments, Rooms, Tenants, Maintenance, Announcements, Reports).
- Security test `server/src/__tests__/integration/payment-security.test.ts` passes 100% (Manager denied payment-settings 403).
- Both `npm --prefix server run build` and `npm run build` pass with exit code 0.

---

## 4. Verification Plan
1. Automated backend tests:
   - Manager operational permissions test suite (`server/src/__tests__/unit/manager-permissions.test.ts`).
   - Payment security regression test (`server/src/__tests__/integration/payment-security.test.ts`).
   - Direct access grant integration test (`server/src/__tests__/integration/direct-access-grant.test.ts`).
2. Automated frontend tests:
   - `src/tests/direct-access-grant-staff-workspace.test.tsx`
   - `src/tests/owner-ui-ux-refinements.test.tsx`
3. TypeScript build passes for both server and client.
4. Live E2E script verifying Manager session can execute:
   - Meter toggle switch (`POST /api/v1/meters/switch` -> 200 OK)
   - Announcements creation (`POST /api/v1/announcements` -> 201 Created)
   - Cash payment (`POST /api/v1/payments/cash` -> 200 OK)
