# Specification: Manager Role LINE OA Setup & Tenant Document Enablement (MLD-01 - MLD-05)

## Status: Draft for Review (Gate A)

---

## 1. Objective & Background
During PO testing in the Manager ("ผู้จัดการ") role:
1. Opening the "เพิ่มผู้เช่าด่วน" (Quick Add Tenant) modal and switching to the "เพิ่มผู้เช่า LINE แนะนำ" tab resulted in a red error card: `"ไม่สามารถโหลดข้อมูล LINE OA ได้"` with a `"ลองใหม่"` (Try again) button.
   - **Root Cause**: The route `GET /api/v1/dormitories/:dormId/line-oa/config` required `line_oa:manage`, which was not granted to the Manager role, resulting in an HTTP 403 Forbidden.
   - **PO Decision**: Enable the Manager role to configure LINE OA (`/owner/line-oa`), allowing them to set up Channel ID/Secret, test connection, configure Webhooks, and manage notification preferences, so they can onboard tenants independently.
2. In the "ผู้เช่า" (Tenants) menu under "ประวัติเอกสารสำคัญ" (Important Document History), uploading a national ID card file returned an HTTP 500 error (`"เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง"`).
   - **Root Cause**: For sessions authenticated via a direct access grant, `req.auth.userId` has the synthetic prefix `ag_user_<uuid>`. In `server/src/services/tenant.service.ts` (line 749), this string was passed directly to the PostgreSQL UUID column `id_card_uploaded_by_user_id`, causing Prisma to crash with `P2023: Inconsistent column data: Error creating UUID, invalid character: expected an optional prefix of urn:uuid: followed by [0-9a-fA-F-], found g at 2`.
   - **PO Decision**: Sanitize `actorUserId` to a valid UUID or fallback to `null` before database insertion, enabling Manager and all direct grant sessions to upload and view tenant identity documents cleanly.

---

## 2. Canonical Authorities & Locked Behaviors
- **Tenant Isolation**: Strict dormitory tenancy boundaries via `dormitory_id` and RLS.
- **RBAC Separation of Duties**:
  - **Manager Role Authority**:
    - Full operational execution of all 8 primary modules.
    - **NEW**: LINE OA configuration authority (`line_oa:read`, `line_oa:write`, `line_oa:manage`) on `/owner/line-oa`.
    - **NEW**: Tenant identity document upload and viewing (`tenants:document:read`, `tenants:document:write`).
  - **Owner-Only Locked Boundaries**:
    - `staff:manage` / `users:*` (Staff management and bearer link creation remains exclusive to Owner).
    - `payment_settings:*` (Bank account & PromptPay recipient configuration remains exclusive to Owner).
    - `subscription:*` (Plan upgrades and billing subscriptions remain exclusive to Owner).
    - `dormitory:delete` and `dormitory:transfer` remain exclusive to Owner.
    - Global wildcard `*` remains stripped for non-owner roles.
    - Sensitive general settings in `/owner/settings` remain hidden from Manager navigation.
- **Thai Copywriting & UI**:
  - Approved status badges, button labels, and modal titles preserved.
  - Display name for Manager: `"ผู้จัดการ"`.

---

## 3. Acceptance Criteria

### [MLD-01] Manager Role LINE OA Operational Permissions
- In `server/src/middleware/dormitory-context.ts`, grant the Manager role:
  `line_oa:read`, `line_oa:write`, `line_oa:manage`.
- In `server/src/db/repositories/role.repository.ts`, ensure `role-manager` in `seedSystemRoles()` includes `line_oa:read`, `line_oa:write`, `line_oa:manage`.
- Manager calling `GET /api/v1/dormitories/:dormId/line-oa/config` succeeds with HTTP 200 (no 403 Forbidden).
- Manager calling `PUT /api/v1/dormitories/:dormId/line-oa/config` succeeds with HTTP 200.
- Manager calling Webhook rotation and testing endpoints succeeds with HTTP 200.

### [MLD-02] QuickAddTenantModal State Handling & Navigation Parity
- In `src/components/QuickAddTenantModal.tsx`:
  - `fetchLineOaConfig()` succeeds for Manager, eliminating the `"ไม่สามารถโหลดข้อมูล LINE OA ได้"` error state.
  - When LINE OA is configured, render the QR code, LINE ID, and registration guide.
  - When LINE OA is not configured (`!isLineConfigured`), render the orange prompt with `[⚙️ ตั้งค่า LINE OA]`.
  - Clicking `[⚙️ ตั้งค่า LINE OA]` invokes `handleManageLineOa()`, navigating directly to `line-oa` (`/owner/line-oa`).

### [MLD-03] Navigation & Workspace Alignment for Manager LINE OA Tab
- In `src/pages/owner.tsx`:
  - Allow Manager to view and access the `line-oa` tab (`/owner/line-oa`).
  - General settings (`/owner/settings`), staff management (`/owner/users`), and subscription (`/owner/subscription`) remain hidden from Manager navigation.
  - Direct URL navigation to forbidden tabs fails closed and redirects to dashboard.

### [MLD-04] Direct Grant Synthetic User UUID Sanitization for Document Upload
- In `server/src/services/tenant.service.ts` (`updateTenantIdentityDocument`):
  - Extract/sanitize `actorUserId`: If prefixed with `ag_user_`, strip the prefix to obtain the canonical UUID.
  - Validate against standard RFC 4122 UUID regex (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).
  - If valid UUID, save to `idCardUploadedByUserId`; otherwise, fallback gracefully to `null`.
  - Zero Prisma `P2023` runtime errors and zero HTTP 500 responses on document upload.

### [MLD-05] Tenant Document Viewing & URL Parity
- In `src/pages/owner/tenants.tsx`:
  - Ensure `getDataProvider().tenants.getIdentityDocumentUrl(tenantId, effectiveDormId)` always attaches `?dormitoryId=...`.
  - Upon successful upload, immediately update `hasIdentityDocument: true`, set `idCardPhotoMock` to the streaming document URL, and show success toast `"อัปโหลดสำเนาบัตรประจำตัวประชาชนเรียบร้อยแล้ว"`.
  - Clicking "สำเนาบัตรประจำตัวประชาชน" when an image exists opens `isIdCardOpen` modal to preview the image clearly, with a "เปลี่ยน" button to replace it.
  - Manager streaming `GET /api/v1/tenants/:id/identity-document?dormitoryId=...` succeeds with HTTP 200 and returns the image buffer (`image/webp` or `image/png` or `application/pdf`).

---

## 4. TDD Verification Plan

### Test Seam 1: Backend API & Service Integration
File: `server/src/__tests__/integration/tenant-identity-document-multirole.test.ts`
- **Red Phase**:
  1. Test Manager session uploading image buffer to `POST /api/v1/tenants/:id/identity-document` -> Fails before fix with HTTP 500 (`P2023`).
  2. Test Manager session fetching `GET /api/v1/dormitories/:dormId/line-oa/config` -> Fails before fix with HTTP 403.
- **Green Phase**:
  1. Apply UUID sanitization in `tenant.service.ts` -> Upload passes with HTTP 200 and persists document metadata.
  2. Apply `line_oa:*` permissions in `dormitory-context.ts` -> GET and PUT config pass with HTTP 200.
  3. Verify Owner-only boundary: Manager still denied HTTP 403 on `/payment-settings` and `/staff`.

### Test Seam 2: Frontend Component & Adapter Vitest
File: `src/tests/manager-line-oa-and-documents.test.tsx`
- **Red Phase**:
  1. Test QuickAddTenantModal in Manager role with unconfigured LINE OA -> Expect navigation to `line-oa` on button click.
  2. Test tenants page ID card viewing with `dormitoryId` query parameter.
- **Green Phase**:
  1. Implement navigation and URL query binding -> All Vitest assertions pass 100%.

### Test Seam 3: Build & Static Analysis
- `npm --prefix server run build` (tsc) -> Exit code 0
- `npm run build` (vite) -> Exit code 0
