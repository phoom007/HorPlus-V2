# Specification: Staff Permissions, Meter Saving, Maintenance Persistence, Logout Restoration & Meter Card Styling

## Status: Approved by Product Owner (Grill-Me Decided: Q1=ก + Other Fees, Q2=ก, Q3=ก, Q4=ก, Q5=ก)

## 1. Objective & Background
Following manual UAT by the Product Owner on the Direct Access Grant and Staff Workspace ("ช่าง / แม่บ้าน"), five operational issues were identified:
1. **Meter Saving & Other Fees**: Staff saving meter numbers was rejected with 403 Forbidden resulting in the error `"ไม่มีสิทธิ์ดำเนินการกับบิลนี้"`. Staff must be able to record meters and edit other fees ("ค่าใช้จ่ายอื่นๆ"). Billing generation ("ออกบิล") must remain disabled for staff.
2. **Tenant Details Click Guard**: Clicking tenant information in the meter table or card caused attempted navigation to the forbidden `/owner/tenants` tab. Staff clicking tenant details must be blocked and shown a toast with fade: `"คุณไม่มีสิทธิ์ดำเนินการสิ่งนี้"`.
3. **Maintenance Creation & Persistence**: When staff submitted a maintenance request, a transient success message was displayed, but the request was rejected by the server with 403 Forbidden and disappeared upon refresh. Staff must have authoritative permissions to create and update maintenance requests.
4. **Restoration of Logout Button**: The "ออกจากระบบ" (Logout) button was previously hidden for direct access sessions. The button must be restored for all sessions so users can log out cleanly and switch accounts.
5. **Meter List Card Border Styling**: In list mode (`OwnerMeterListCard`), the outer card border had bright status colors (amber for pending payment, rose for overdue/daily). The border must be standardized to `border-slate-200 hover:border-slate-300`, keeping all inner badges and labels untouched.

---

## 2. Canonical Authorities & Locked Behaviors
- **Dormitory Security Guard**: Multi-tenant isolation and fail-closed RBAC must be preserved.
- **Thai Role Phrasing**: `"ช่าง / แม่บ้าน"` must remain the official display role title.
- **Thai Toast Messages**:
  - Tenant details click: `"คุณไม่มีสิทธิ์ดำเนินการสิ่งนี้"`
  - Maintenance success: `"สร้างเรื่องแจ้งซ่อมเรียบร้อยแล้ว"`
- **Separation of Duties**:
  - Staff: records meters, edits other fees, views/creates/updates maintenance requests.
  - Staff DOES NOT issue bills (no `billing:manage` authority).

---

## 3. Acceptance Criteria

### [SPM-01] Staff Meter Saving & Other Fees Mutation Permission
- **Requirement**: When `roleCode === 'STAFF'` or when a role possesses `meters:record` / `meter:record`, requests to `POST /api/v1/meters/workspace/bulk` must succeed without 403 Forbidden.
- **Scope**:
  - `server/src/middleware/permission.ts`: Recognize `meters:record` and `meter:record` as fulfilling `meter:write` and `meters:write`.
  - `server/src/middleware/dormitory-context.ts`: Explicitly assign `meters:view`, `meters:record`, `meter:write` to `roleCode === 'STAFF'`.
  - Both meter readings and custom charges ("ค่าใช้จ่ายอื่นๆ") submitted via bulk save must persist to the database.

### [SPM-02] Staff Billing Generation Guard
- **Requirement**: In `/owner/meters`, the bulk "ออกบิลทุกห้อง" button and the per-room "ออกบิล" toggle switch must be disabled for staff (`userRole === 'staff'`).
- **Behavior**:
  - "ออกบิลทุกห้อง" button receives `disabled={... || userRole === 'staff'}` with disabled styling and tooltip `"เฉพาะเจ้าของหรือผู้จัดการ"`.
  - Room status toggle switch in both table mode and list mode is disabled for staff, preventing unauthorized bill state changes.
  - Button "+ เพิ่มค่าใช้จ่าย" / "ค่าใช้จ่ายอื่นๆ" remains enabled and interactive for staff.

### [SPM-03] Tenant Details Click Guard & Toast with Fade
- **Requirement**: When a user with `userRole === 'staff'` clicks on tenant information (tenant name or link) in `/owner/meters` (table rows or list card):
  - Do NOT navigate to `/owner/tenants`.
  - Display an in-app toast with fade animation stating: `"คุณไม่มีสิทธิ์ดำเนินการสิ่งนี้"`.
  - Both `OwnerMeters` (inline toast) and `OwnerWorkspace` (`showNavToast`) must enforce this guard.

### [SPM-04] Staff Maintenance Creation & Update Persistence
- **Requirement**: When staff creates or updates a maintenance request (`POST /api/v1/maintenance-requests` or status endpoints):
  - `server/src/middleware/permission.ts`: Recognize `maintenance:update` and `maintenance:create` as fulfilling `maintenance:write`.
  - `server/src/middleware/dormitory-context.ts`: Explicitly assign `maintenance:view`, `maintenance:update`, `maintenance:write`, `maintenance:create` to `roleCode === 'STAFF'`.
  - `src/pages/owner/maintenance.tsx`: On request creation, verify API response. On failure, do not create a fake local item; display the real server error toast. On success, add the created item and invalidate query cache.

### [SPM-05] Restoration of "ออกจากระบบ" (Logout) Button
- **Requirement**: The "ออกจากระบบ" button must be rendered in both the mobile navigation drawer and the desktop sidebar across all user sessions, including direct access grants (`isDirectAccess === true`).
- **Behavior**:
  - Clicking "ออกจากระบบ" clears `localStorage` and `sessionStorage` (`is_direct_access_grant`, `active_dormitory_selected_for_session`), calls `POST /api/v1/auth/logout`, and navigates to `/auth/owner`.

### [SPM-06] Meter List Card Border Reset
- **Requirement**: In `src/components/meters/OwnerMeterListCard.tsx`, the outer container card border class must always evaluate to `border-slate-200 hover:border-slate-300`.
- **Integrity**: All inner status badges (`displayStatus.label`, e.g. "รอชำระ", "รายวัน", "ชำระแล้ว"), toggles, and text colors must remain unchanged.

### [SPM-07] Canonical Signed CSRF Token Issuance & Session Refresh for Direct Access Grants
- **Requirement**: In `server/src/services/access-grant.service.ts`, `redeemAccessGrant` must issue a signed CSRF token generated via `CsrfService.generateCsrfToken(sessionId)` (standard `${nonce}.${signature}` structure) instead of a raw SHA256 hex string.
- **Session Refresh**: In `server/src/routes/auth.routes.ts`, `GET /api/v1/auth/session` must re-issue/update the canonical `horplus_csrf` cookie for active authenticated sessions, allowing existing browser tabs to automatically obtain a valid signed CSRF token on page reload without re-redeeming the bearer link.
- **Outcome**: Resolves the `"CSRF Token ไม่ถูกต้องหรือหมดอายุแล้ว"` error when staff clicks "บันทึก" on `/owner/meters`.

### [SPM-08] Non-UUID Actor Handling in Maintenance Request Creation
- **Requirement**: In `server/src/db/repositories/maintenance.repository.ts`, `createRequest` and `updateRequest` must sanitize `createdByUserId` using UUID format validation (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`). Non-UUID identifiers (such as `ag_user_<grantId>`) must be stored as `null` in the PostgreSQL `@db.Uuid` column to prevent Prisma invocation crashes (`Inconsistent column data: Error creating UUID`).
- **Staff Attribution**: In `server/src/routes/maintenance.routes.ts`, when `actor?.userId?.startsWith('ag_user_')`, append staff provenance to `note` (`[แจ้งโดย: ช่าง / แม่บ้าน]`), preserving auditability for the dormitory owner while maintaining strict database integrity.

---

## 4. Verification Plan
- Unit and integration tests in `src/tests/direct-access-grant-staff-workspace.test.tsx` and `server/src/__tests__/integration/direct-access-grant.test.ts`.
- Verify CSRF generation and verification parity between auth service and access grant service.
- Verify maintenance request creation with `ag_user_...` actor persists to DB without UUID error.
- Full production builds (`npm run build`, `npm --prefix server run build`).

