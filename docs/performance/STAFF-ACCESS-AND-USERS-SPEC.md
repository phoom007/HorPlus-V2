# HorPlus-V2: Staff Access Grants & User Management Specification (/owner/users)

## 1. OBJECTIVE / SCOPE
Align and develop the `/owner/users` menu (Access Token & Staff Management) to connect with real backend database services (PostgreSQL/Prisma) and LINE Messaging API, replacing temporary local state with authoritative server-persisted access grants while preserving 100% of the User's newly designed UI layout, styling, and interactions.

### PO Authorities & Confirmed Grill-Me Alignments
1. **PO Request**:
   - "ต่อไป พัฒนาเมนู /owner/users ผมพึ่งเปลี่ยน UI ให้แสดงผลได้ตามนี้ครับ คุณช่วยวางแผนและวิเคราะห์ อย่างครอบคอบได้เลย ถ้าไม่เคลียร์ส่วนไหน หรือไม่เห็นข้อมูล ต้องให้ผมเป็นคนตัดสินใจ ให้ถามเพื่อให้ confirm นะครับ 'C:\Horplus-V2\HORPLUS_V2_ANTIGRAVITY_WORKFLOW_PROMPTS.md' /grill-me /implement-spec"
2. **Confirmed Grill-Me Decisions**:
   - **Q1 (Data Persistence Strategy)**: Option 2 — Full backend database integration via PostgreSQL/Prisma with real API for token creation, validation, and revocation on the server.
   - **Q2 (LINE OA Friends Picker Source)**: Option 2 — Pull strictly real LINE friends (`DormitoryLineFriend`) from backend API (`GET /api/v1/properties/:id/line-friends`). When no friends exist, render an informative empty state prompting the owner to have staff add the LINE OA bot.
   - **Q3 (Grant Creation Modes)**: Option 1 (Recommended) — Support both:
     - **LINE-Bound**: If a LINE friend is selected, send the link via LINE OA and bind identity to that friend (`POST /api/v1/properties/:id/access-grants`), deducting 1 unit from LINE quota.
     - **Direct Link**: If no LINE friend is selected, allow generating an unassigned "Direct Link" (สร้างลิงก์เข้าใช้งาน) for direct manual copying.
   - **Q4 (Token Lifetime & Expiration)**: Option 1 (Recommended) — Non-expiring tokens. All access tokens remain active indefinitely until explicitly revoked by the owner via the revocation modal.

---

## 2. INSPECT FIRST & CANONICAL AUTHORITIES

### Frontend Authorities
- Page Component: `src/pages/owner/users.tsx` (1,216 lines, rich UI for token generator, LINE friend picker modal, history table, and role policy cards).
- Staff Access Page: `src/pages/StaffAccessPage.tsx` (reads `#<RAW_TOKEN>` fragment, calls `/api/v1/staff-access/redeem`, sets session and redirects to `/owner/dashboard`).
- API Adapter: `src/data/adapters/task009.ts` (`Task009ApiAdapter.getStaff`, `getLineFriends`, `createAccessGrant`, `getCopyLink`, `revokeAccessGrant`, `redeemStaffAccess`).
- LINE Logo Component: `src/components/LineLogo.tsx` (exported as `LineLogo`).
- LINE Quota Utility: `src/utils/lineQuota.ts` (helper for quota events and client tracking).

### Backend Authorities
- Prisma Schema: `server/prisma/schema.prisma` (`DormitoryAccessGrant`, `DormitoryLineFriend`, `DormitoryMember`, `Session`, `AuditLog`).
- Services:
  - `server/src/services/access-grant.service.ts` (`AccessGrantService`: creates, validates, redeems, and revokes grants; enforces slot limit <= 10).
  - `server/src/services/line-friend.service.ts` (`LineFriendService`: queries and upserts LINE friends).
  - `server/src/services/line-push-usage.service.ts` (`LinePushUsageService`: manages and reserves push quota).
- API Routes:
  - `server/src/routes/staff.routes.ts` (contains public `/api/v1/staff-access/redeem` and protected `/api/v1/properties/:id/staff`, `/api/v1/properties/:id/line-friends`, `/api/v1/properties/:id/access-grants`, etc.).

---

## 3. LOCKED BEHAVIORS
- **SEC-01 through SEC-08**: Bearer access tokens are never transmitted in URL query strings or logged in server access logs. Raw tokens are only passed in URL hash fragments (`/staff-access#<token>`) and redeemed via `POST` with CSRF protection and HttpOnly session cookies.
- **Tenant Isolation**: All operations enforce `dormitoryId` verification against authenticated owner context (`app.current_dormitory_id` and RLS).
- **Slot Limit Enforcement**: Total active staff (Permanent Google Owners + Active Access Grants) cannot exceed 10 slots per dormitory.
- **Thai Copywriting & Layout**: Preserves exact wording, badge classes, table drag-to-scroll, and 3-role policy overview cards from `users.tsx`.

---

## 4. REQUIRED CHANGES (Incorporating Gate A Findings F-01 & F-02)

### 1. Build Fixes & Utilities (SAU-01)
- In `src/pages/owner/users.tsx`, update import:
  `import { LineLogo as LineIcon } from '../../components/LineLogo';`
- Create `src/utils/lineQuota.ts`:
  Exports `consumeLineQuota(month: string, amount?: number)` to update client quota cache and dispatch custom DOM events (`line-quota-consumed`).

### 2. Frontend Friend Data Mapping & Empty State (SAU-02 / F-01 & F-03)
- In `src/pages/owner/users.tsx`:
  - Resolve authoritative active dormitory ID:
    ```typescript
    const activeDormitoryId = dormitoryId || sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id') || '';
    ```
  - Normalize backend `LineFriend` DTO (`id`, `displayName`, `pictureUrl`, `friendStatus`) to UI `LineOAFriend`:
    ```typescript
    const adaptLineFriend = (f: LineFriend): LineOAFriend => ({
      id: f.id,
      name: f.displayName || 'เพื่อนใน LINE',
      lineDisplayName: f.displayName || 'user',
      avatarColor: 'bg-emerald-500',
      status: f.friendStatus === 'FOLLOWING' ? 'เพื่อนใน LINE' : (f.friendStatus || 'ติดตามแล้ว'),
      phone: undefined,
    });
    ```
  - Fetch real friends using `Task009ApiAdapter.getLineFriends(activeDormitoryId)`.
  - When `friends.length === 0`: render an informative empty state inside the friend picker modal explaining that no friends have added the LINE OA bot yet, with guidance to have staff scan the dormitory's LINE OA QR Code first.

### 3. Backend Direct Link Support & Comprehensive Null-Safety (SAU-03 / F-02 & F-04)
- In `server/prisma/schema.prisma`:
  Make `lineFriendId` nullable in `DormitoryAccessGrant`:
  ```prisma
  model DormitoryAccessGrant {
    id                    String               @id @default(uuid()) @db.Uuid
    dormitoryId           String               @map("dormitory_id") @db.Uuid
    lineFriendId          String?              @map("line_friend_id") @db.Uuid
    ...
    lineFriend            DormitoryLineFriend? @relation(fields: [lineFriendId], references: [id], onDelete: Cascade)
  }
  ```
  Run `npx prisma generate` in `server/`.
- In `server/src/services/access-grant.service.ts`:
  - **Phase A (Creation)**:
    - If `lineFriendId` is null/empty/omitted:
      - Skip LINE friend lookup (`tx.dormitoryLineFriend.findFirst`).
      - Skip `existingActive` per-friend uniqueness check.
      - Create grant with `lineFriendId: null` and `lastDeliveryStatus: null`.
      - In AuditLog, set `friendDisplayName: 'Direct Link'` (preventing `friend.displayName` crash).
    - If `lineFriendId` is provided:
      - Perform existing validation and create grant tied to the friend.
  - **Phase B (Delivery)**:
    - If `lineFriendId` is null/empty:
      - Skip `this.deliverAccessGrant(...)` completely. Return `{ grant, bearerUrl, pushed: false, deliveryStatus: null }`.
      - Do NOT deduct push quota and do NOT mark delivery as failed.
    - If `lineFriendId` is present:
      - Perform existing push delivery and quota reservation.
  - **Bearer Redemption (`redeemAccessGrant`)**:
    - Use safe optional chaining:
      ```typescript
      friendDisplayName: grant.lineFriend?.displayName ?? null,
      pictureUrl: grant.lineFriend?.pictureUrl ?? null,
      ```
  - **Staff Listing (`listDormitoryStaff`)**:
    - Safe fallback for direct links:
      ```typescript
      displayName: g.lineFriend?.displayName || 'ลิงก์เข้าใช้งานตรง (Direct Link)',
      pictureUrl: g.lineFriend?.pictureUrl ?? null,
      ```
- In `server/src/routes/staff.routes.ts`:
  - In `POST /properties/:id/access-grants`: allow `lineFriendId` to be optional (only `roleCode` is required).

### 4. Frontend Integration & Lifecycle (SAU-04, SAU-05, SAU-06, SAU-07, SAU-08)
- Fetch and display active staff from `Task009ApiAdapter.getStaff(activeDormitoryId)`.
- Map active access grants to table items:
  - If `lineFriend` is present, display friend's name, display name, and badge.
  - If `lineFriend` is null, display "ลิงก์ทั่วไป (คัดลอกส่งเอง)" matching the exact UI copy.
- Link Copying:
  - Generate secure URL `${window.location.origin}/staff-access#${rawToken}` upon creation.
  - In table copy button: for newly created grants in the session, copy cached URL; for existing active grants, call `Task009ApiAdapter.getCopyLink(activeDormitoryId, grantId)` to retrieve the authoritative bearer link and copy it to the clipboard.
- Two-Step Revocation:
  - Keep Step 1 confirmation and Step 2 security warning modal.
  - On Step 2 confirm: call `Task009ApiAdapter.revokeAccessGrant(activeDormitoryId, grantId)`.
  - Invalidate associated sessions on server and refresh the staff list.
- Preserve 100% of user UI layout, typography, cards, and drag-to-scroll.

---

## 5. DO NOT MODIFY
- The visual layout, color palette, badges, typography, cards, and animations in `src/pages/owner/users.tsx`.
- Security controls (SEC-01 through SEC-08).
- Existing subscription, LINE OA setup, or billing logic.

---

## 6. ACCEPTANCE CRITERIA

| ID | PO Source | Acceptance Requirement | Verification |
|---|---|---|---|
| **SAU-01** | Build parity | Resolve `LineLogo as LineIcon` import and create `src/utils/lineQuota.ts`. `npm run build` succeeds without errors. | Vite build exit code 0 |
| **SAU-02** | Confirmed Q2 & F-01 | LINE Friend Picker adapts backend `LineFriend` to UI model and renders real friends. When list is empty, renders an informative Thai empty state with QR code guidance. | Unit & UI tests |
| **SAU-03** | Confirmed Q3 & F-02 | Supports both LINE-Bound grant creation and unassigned Direct Link creation. Backend services handle nullable `lineFriendId` with zero runtime crashes across creation, delivery, listing, and redemption. | Service unit & API integration tests |
| **SAU-04** | Confirmed Q1 & F-03 | History table displays real `DormitoryAccessGrant` records loaded from `Task009ApiAdapter.getStaff(activeDormitoryId)`. | Component integration test |
| **SAU-05** | Confirmed Q4 | Tokens have no expiration date and remain ACTIVE permanently until explicitly revoked. | Schema & service inspection |
| **SAU-06** | SEC-01/08 | Copied links format as `/staff-access#<token>`, compatible with `StaffAccessPage` and bearer redemption. | Link copy test |
| **SAU-07** | PO UI Step 2 | Two-step revocation modal executes backend revocation and removes/disables token. | Revocation flow test |
| **SAU-08** | PO Request | Thai copywriting, role badges, policy overview cards, and table drag-to-scroll remain 100% intact. | Visual snapshot/assertion |

---

## 7. TARGETED TESTS
- `src/tests/owner-users-access-tokens.test.tsx` (New comprehensive test suite covering SAU-01 through SAU-08).
- `server/src/__tests__/integration/task009-staff-line-oa.test.ts` (Backend access grant integration tests).
- Full frontend build (`npm run build`).
- Full backend build (`npm --prefix server run build`).
