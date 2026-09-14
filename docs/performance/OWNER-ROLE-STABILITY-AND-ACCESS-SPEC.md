# Owner & Manager Role Stability and Access Specification (OSA-01 - OSA-04)

## 1. Executive Summary & Problem Statement

During PO testing of the Owner (`/owner`) and Manager roles, three functional defects were identified:
1. **Announcements Cannot Be Created / Disappear (`/owner/announcements`)**:
   - **Root Cause**: `OwnerAnnouncements` does not accept or pass `dormitoryId`, and `ApiAnnouncementAdapter.createAnnouncement` omits `options.dormitoryId` in `httpRequest`. The request falls back to `selected_dormitory_id` in `localStorage`, which, if invalid or non-UUID, causes backend middleware to reject the request with `400 INVALID_ID_FORMAT`.
   - **Silent Failure**: `announcements.tsx` silently catches the failure, creates a temporary in-memory announcement, and shows `"เผยแพร่ประกาศเรียบร้อยแล้ว"`. Immediately after, `onSaveAnnouncements` invalidates the React Query cache, fetching `GET /api/v1/announcements` from the server. Because the server never persisted the announcement, the query returns an empty list `[]`, instantly wiping the UI back to `"ประชาสัมพันธ์ (0)"`.
2. **Cash Payment Fails with 500 Error (`/owner/payments`)**:
   - **Root Cause**: When staff or manager enters via Direct Access Grant, `req.auth.userId` is set to `ag_user_<grantId>`. In `payment.routes.ts`, this synthetic ID is passed to `paymentService.recordCash`, which invokes `idempotencyService.runWithIdempotency`.
   - In `idempotency.service.ts`, `prisma.idempotencyKey.findUnique` queries by `userId: actorUserId`. In Prisma's schema, `IdempotencyKey.userId` is defined as `@db.Uuid`. Passing non-UUID strings (`ag_user_...`) causes Prisma to throw `P2023: Inconsistent column data: Error creating UUID, invalid character: expected an optional prefix of urn:uuid: followed by [0-9a-fA-F-], found g at 2`. Express catches this unhandled error and returns `500 INTERNAL_ERROR` (`ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง`).
3. **Manager Direct Access Link Invalid / Revoked (`/owner/users`)**:
   - **Root Cause**: In `src/pages/owner/users.tsx`, `getAccessLink(tokenId)` used `${window.location.origin}/staff-access#${tokenId}` as a fallback when `createdTokensMap[tokenId]` was not populated in local state. `tokenId` is the grant UUID (`41fe...`), NOT the 64-character bearer token. Opening or redeeming `#<grantUUID>` hashes the UUID, finds 0 matching token hashes in PostgreSQL, and returns `401 ACCESS_GRANT_REVOKED` (`Access grant link has been revoked or is invalid`).

---

## 2. Product Owner Authorities & Locked Behaviors

- **PO Authorities**:
  - PO User Request: "ผมลองทดสอบสิทธิ์ เจ้าของหอพัก แล้ว ทำไมเมนูประชาสัมพันธ์ เพิ่มไม่ได้ , เมนูการชำระเงิน กดรับเงินสด ขึ้นว่า 'เกิดข้อผิดพลาดในการบันทึกเงินสด: ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง' , 'ลิงก์เข้าใช้งาน' สำหรับ ผู้จัดการขึ้นว่า 'Access grant link has been revoked or is invalid' ครับ , /diagnosing-bugs /triage"
- **Locked Behaviors**:
  - Security controls SEC-01 through SEC-08 remain strictly preserved.
  - Multi-tenant dormitory isolation and RLS context are preserved.
  - Thai copywriting and approved status badges are preserved.
  - No secrets or raw tokens leaked in server logs or URL query parameters (always hash fragment `#<token>`).

---

## 3. Scope of Changes

### Backend Services & Routes
- `server/src/services/idempotency.service.ts`:
  - Sanitize `actorUserId`: strip `ag_user_` and `ag_` prefixes. If non-UUID, deterministically format to UUID.
- `server/src/routes/payment.routes.ts`:
  - Sanitize `auth.userId` in `/cash` and `/cash/combined` endpoints.
- `server/src/utils/payment-transaction.util.ts`:
  - Extract UUID from `input.userId` before UUID validation regex so `recordedByUserId` records the grant UUID rather than null.

### Frontend Pages & Adapters
- `src/pages/owner/announcements.tsx`:
  - Add `dormitoryId?: string` to `OwnerAnnouncementsProps`.
  - Pass `dormitoryId` to `dataProvider.announcements.createAnnouncement`.
  - Fail-fast error handling: on `!res.success`, show error toast and keep modal open; do not show false success toast or invalidate queries.
- `src/pages/owner.tsx`:
  - Pass `dormitoryId={activeDormitoryId}` to `<OwnerAnnouncements />`.
- `src/data/contracts/index.ts` & `src/data/adapters/api/index.ts`:
  - Update `AnnouncementDataSource` contract and `ApiAnnouncementAdapter` to accept `dormitoryId?: string` and pass `{ dormitoryId }` to `httpRequest`.
- `src/pages/owner/users.tsx`:
  - Fix `handleCopyLink`: always fetch authoritative bearer link from `Task009ApiAdapter.getCopyLink(activeDormitoryId, tokenId)`.
  - Never fall back to copying `#${tokenId}` (raw UUID). Show error toast if fetching fails.
  - Improve UI table tooltips to avoid displaying confusing `...?token=<UUID>...`.

---

## 4. Acceptance Criteria (OSA-01 - OSA-04)

### OSA-01: Cash Payment Idempotency UUID Guard & Synthetic User Handling
- When a user with a synthetic ID (e.g. `ag_user_41fe9480-a0c1-43be-a5c0-6d8fe0dec3c4`) or standard UUID records a cash payment:
  - `IdempotencyService` strips the prefix and uses the valid UUID for `IdempotencyKey.userId`.
  - Prisma query `idempotencyKey.findUnique` executes cleanly without `P2023` error.
  - `recordCashPaymentInTx` populates `recordedByUserId` with the sanitized grant UUID.
  - Returns HTTP 200 with payment record and receipt.
  - Cash payment succeeds cleanly on the frontend without error toasts.

### OSA-02: Announcements Persistence & Prop Alignment
- `OwnerAnnouncements` accepts `dormitoryId` prop and passes it through to `ApiAnnouncementAdapter.createAnnouncement`.
- `httpRequest` sends the authoritative `X-Dormitory-Id` header matching `activeDormitoryId`.
- Backend accepts and persists the announcement in PostgreSQL (`status: 'published'`).
- If creation fails on the server, the modal displays the Thai error message, retains form input, and does not show false success toast.
- On success, the announcement appears immediately in the board list, and persists across page reloads.

### OSA-03: Authoritative Direct Access Link Resolution & Redemption Parity
- In `/owner/users`, clicking the copy link button calls `Task009ApiAdapter.getCopyLink(activeDormitoryId, grantId)`.
- It copies the authoritative bearer URL (`/staff-access#<64-hex-token>`), never `#<grant-UUID>`.
- If an active link is not found or revoked, it displays an error toast rather than creating a broken URL.
- Visiting `/staff-access#<rawToken>` for Manager redeems successfully without `ACCESS_GRANT_REVOKED` error and grants access to the manager workspace.

### OSA-04: Test Suite Integrity & Build Verification
- Unit and integration tests pass:
  - Server integration tests for cash payment and access grants.
  - Frontend tests for `OwnerAnnouncements` and `OwnerUsers`.
- `npm --prefix server run build` passes with 0 errors.
- `npm run build` passes with 0 errors.

---

## 5. Verification Plan

### Automated Checks
1. Backend Unit & Integration Tests:
   `npm --prefix server test src/__tests__/unit/membership-uuid-guard.test.ts`
   `npm --prefix server test src/__tests__/integration/direct-access-grant.test.ts`
2. Frontend Tests:
   `npx vitest run src/tests/owner-users-access-tokens.test.tsx`
3. Build Verification:
   `npm --prefix server run build`
   `npm run build`
4. End-to-end API script:
   Run scratch script testing announcements creation, cash payment with synthetic user ID, and manager link redemption.
