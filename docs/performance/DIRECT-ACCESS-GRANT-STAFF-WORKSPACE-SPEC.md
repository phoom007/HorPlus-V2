# Technical Specification: Direct Access Grant & Staff Workspace Experience

## Document Metadata
- **Spec ID**: DIRECT-ACCESS-GRANT-STAFF-WORKSPACE-SPEC
- **Module**: Access Grants & Staff Role Boundaries (Task-009 Checkpoint 1B Extension)
- **Status**: Draft (Gate A Review)
- **Author**: Antigravity Main Agent
- **Target Version**: HorPlus-V2

---

## 1. Background & Business Context

HORPLUS provides direct access links (Direct Access Grants) allowing dormitory staff (e.g. technicians, housekeepers) to access their assigned dormitory workspace without requiring an initial LINE Friend binding.
During Product Owner manual testing:
1. Generated bearer URLs pointed to `https://app.horplus.com`, requiring manual modification to `http://127.0.0.1:5173` in local development.
2. Accessing the workspace via the redeemed link resulted in a full-screen error card: *"ไม่สามารถโหลดข้อมูลหน้านี้ได้: เกิดข้อผิดพลาดในการดึงข้อมูลจากเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง"* because:
   - `StaffAccessPage.tsx` failed to persist `dormitoryId` to `sessionStorage` due to mismatching response key location (`res.data.grant.dormitoryId` vs `res.data.dormitoryId`).
   - `owner.tsx` executed financial and contract queries (`bills`, `contracts`, `billingCycles`) which return `403 Forbidden` for the `STAFF` role.
   - `dormitories.getById` requires `dormitory:view` which is not possessed by `STAFF`.
3. The profile fallback name displayed English `"Staff Member"` instead of Thai `"ช่าง / แม่บ้าน"`.
4. Buttons and menus without permission must be non-clickable, disabled, and not active.
5. The "ออกจากระบบ" (Logout) button must be hidden for sessions originating from a direct access link.

---

## 2. Acceptance Criteria (Observable Outcomes)

### DAG-01: Local Test Origin Alignment
- In `server/.env`, `PUBLIC_APP_URL` defaults to `http://127.0.0.1:5173`.
- In `server/src/services/access-grant.service.ts`, `baseUrl` falls back to `process.env.PUBLIC_APP_URL || (process.env.NODE_ENV === 'production' ? 'https://app.horplus.com' : 'http://127.0.0.1:5173')`.
- In `src/pages/owner/users.tsx`, newly generated bearer URLs and copied links replace foreign hostnames with `window.location.origin` when running on localhost/127.0.0.1, ensuring immediate local usability without manual editing.

### DAG-02: Dormitory ID Session Persistence upon Redemption
- In `src/pages/StaffAccessPage.tsx`, `dormId` is extracted from `res.data?.grant?.dormitoryId || res.data?.dormitoryId`.
- Both `sessionStorage.setItem('active_dormitory_selected_for_session', dormId)` and `localStorage.setItem('selected_dormitory_id', dormId)` are populated upon successful redemption.
- `sessionStorage.setItem('is_direct_access_grant', 'true')` is recorded.
- Query client cache is invalidated or cleared before navigation to `/owner/dashboard`.

### DAG-03: Role-Aware Query Scoping for Staff Dashboard
- `getTargetQueriesForTab(targetTab, dormId, cycleId, userRole)` is role-aware.
- When `userRole === 'staff'` and `targetTab === 'dashboard'`:
  - Queries ONLY:
    1. `rooms(dormId)` (`fetchAuthoritativeRooms`)
    2. `buildings(dormId)` (`/api/v1/properties/buildings`)
    3. `maintenance(dormId)` (`/api/v1/maintenance`)
    4. If `cycleId` present: `meterReadings(dormId, cycleId)` (`/api/v1/meters/readings`)
  - Excludes `bills`, `contracts`, and `billingCycles`.
- `activeTabHasError` evaluates to `false`, resolving the full-screen red error card.

### DAG-04: Dormitory View Guard Fallback
- In `src/pages/owner.tsx`, `dormitoryQuery` is guarded (`enabled: isQueryEnabled && userRole !== 'staff'`).
- `currentDormitory` falls back gracefully to `activeMembership?.dormitory || (activeMembership ? { id: activeMembership.dormitoryId, name: activeMembership.dormitoryName } : null)`.
- No 403 Forbidden is emitted by the dormitory shell for staff members.

### DAG-05: Thai Role Profile Display Name Mapping
- In `server/src/services/auth.service.ts`, line 303:
  - If `grant.lineFriend?.displayName` is empty:
    - `grant.roleCode === 'STAFF'` -> `'ช่าง / แม่บ้าน'`
    - `grant.roleCode === 'MANAGER'` -> `'ผู้จัดการ'`
    - `grant.roleCode === 'OWNER'` -> `'เจ้าของหอพัก'`
- In `src/utils/role.ts`, normalize `'ช่าง / แม่บ้าน'`, `'ช่าง'`, `'แม่บ้าน'` to `'staff'`.
- In `src/pages/owner.tsx`, `user.roleName` renders `"ช่าง / แม่บ้าน"`.

### DAG-06: Strict RBAC & Inactive Disabled Menus/Buttons
- **Sidebar Menu**: For `userRole === 'staff'`, only `dashboard` (หน้าหลัก), `meters` (จดมิเตอร์), and `maintenance` (งานแจ้งซ่อม) are displayed in `allowedMenuItems`.
- **URL Route Protection**: Direct navigation via browser URL to disallowed tabs (`/owner/payments`, `/owner/rooms`, `/owner/tenants`, `/owner/contracts`, `/owner/announcements`, `/owner/reports`, `/owner/users`, `/owner/settings`, `/owner/subscription`) is intercepted, fail-closed, and redirected back to `/owner/dashboard`.
- **Dashboard Quick Actions**:
  - Financial total card ("สรุปยอดค้างชำระทั้งหมด"): "ดูรายละเอียด" button is disabled/hidden for `staff`.
  - Main menu grid (`mainMenus` in `dashboard.tsx`): Menus without permission (`payments`, `rooms`, `tenants`, `announcements`, `reports`, `users`, `settings`) have `disabled={true}`, styling `opacity-40 cursor-not-allowed pointer-events-none`, are not active, and cannot be clicked.
  - Billing workflow stepper: Non-permitted billing steps are non-clickable.

### DAG-07: Hide Logout Button for Direct Access Grant Sessions
- In `src/pages/owner.tsx`:
  - When `isDirectAccess` is `true` (`(user as any)?.isDirectAccess || user?.id?.startsWith('ag_user_') || user?.email?.endsWith('@horplus.local') || sessionStorage.getItem('is_direct_access_grant') === 'true'`), the "ออกจากระบบ" (Logout) button is NOT rendered in both:
    1. Mobile Sidebar drawer
    2. Desktop Sidebar navigation footer

---

## 3. Security & Invariant Rules (Locked Behaviors)
- SEC-01: Multi-tenant dormitory isolation (`x-dormitory-id` check and active membership verification) strictly preserved.
- SEC-02: Permission boundaries enforced at backend; frontend query omission does not bypass backend authorization.
- SEC-03: Bearer token format (256-bit high entropy hash fragment `#<token>`) and single-use redemption strictly preserved.
