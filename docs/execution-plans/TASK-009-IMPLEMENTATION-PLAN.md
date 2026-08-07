# Implementation Plan — TASK-009: Staff Roles & Per-Dorm LINE OA (Final Product Model)

## 1. TASK-009 Final Product Architecture & Scope

### Final Product Model Specification
The previous 7-day StaffInvitation and recipient-authenticated acceptance flow is **COMPLETELY SUPERSEDED** by:
```text
LINE Friend Directory + Revocable Bearer Access Grant + Access-Grant Session
```
- **No Expiration**: Access Grants do NOT expire by time. They remain active indefinitely until explicitly revoked by an Owner.
- **No Invitation Login**: There is NO invitation acceptance login. Anyone in possession of the valid bearer URL may access the system.
- **Bearer Credential URL**: The access URL itself is the bearer credential (`https://<app>/staff-access#<RAW_GRANT_TOKEN>`). The selected LINE friend identity serves as a display label/reference for the grant.
- **Allowed Grant Roles**: `OWNER`, `MANAGER`, `TECH`.

---

## 2. Permanent Google Owner Protection & Ownership Invariants

- **Permanent Google Owner**: The original/bootstrap Owner created via Google login is flagged with `membershipOrigin = 'GOOGLE_BOOTSTRAP'`.
  - Always retains full `OWNER` permissions.
  - Cannot be revoked, deleted, downgraded, or suspended through TASK-009.
  - Cannot have their `OWNER` permission removed by any other Owner (Google or Access-Grant Owner).
  - Cannot lose access when a staff grant is revoked or when LINE OA is disconnected.
  - Displayed in UI as: **`เจ้าของหลัก`** (with no Revoke/Delete/Downgrade controls).
- **Additional Owners**: Additional `OWNER` access may be granted via Access Grants.
  - Can manage staff/access grants, create `OWNER`/`MANAGER`/`TECH` grants, revoke other revocable grants, and change roles.
  - **Inviolable Invariant**: Additional Owners CANNOT revoke, downgrade, or remove the Permanent Google Owner. The system guarantees >= 1 effective Owner at all times.

---

## 3. Atomic 10-Slot Account Capping Algorithm

Total access slots per dormitory MUST NOT exceed **10**.
```text
usedSlots = Permanent Google Owner memberships + non-revoked Access Grants (status = 'ACTIVE')
```
- A newly created Access Grant immediately reserves 1 slot. (No separate pending vs accepted double-counting).
- Enforced inside PostgreSQL transaction via `pg_advisory_xact_lock(hashtext(dormitoryId))`. If `usedSlots >= 10`, throws `HTTP 409 STAFF_LIMIT_EXCEEDED`.
- Revoking an Access Grant releases its slot immediately.
- Changing a Grant's Role does NOT consume an additional slot.

---

## 4. LINE Friend Directory & Webhook Ingestion (`DormitoryLineFriend`)

- Maintains a per-dormitory LINE Friend Directory automatically ingested from signed LINE webhook events (`follow`, `message`/interaction).
- Model fields: `lineUserIdHash`, `lineUserIdEncrypted`, `displayName`, `pictureUrl`, `friendStatus` (`FOLLOWING`, `UNFOLLOWED`), `followedAt`, `unfollowedAt`, `lastSeenAt`.
- Owner Users page displays LINE profile image & display name when selecting recipients for Access Grants.
- **Unfollow Behavior**: If a LINE friend unfollows/blocks the OA, their existing Access Grant remains `ACTIVE` until explicitly revoked by an Owner.

---

## 5. Revocable Bearer Access Grant & Safer URL Format (`DormitoryAccessGrant`)

- Model fields: `id`, `dormitoryId`, `lineFriendId`, `roleCode` (`OWNER` | `MANAGER` | `TECH`), `tokenHash`, `tokenPrefix`, `status` (`ACTIVE` | `REVOKED`), `version`, `createdByPrincipal`, `createdAt`, `revokedByPrincipal`, `revokedAt`, `lastRoleChangedAt`.
- **Token Generation**: Generates 256-bit secure random token (`crypto.randomBytes(32).toString('hex')`). Stores ONLY `tokenHash` (SHA-256). Raw token is NEVER stored in database or logged.
- **Safer Bearer Link Format**: `https://<horplus-app>/staff-access#<RAW_GRANT_TOKEN>` (URL fragment keeps secret out of server HTTP request logs and referrer headers).
- **Redemption**: Frontend reads `#token`, `POST`s `{ token }` to `/api/v1/staff-access/redeem`, and immediately clears hash fragment with `history.replaceState()`. Returns HttpOnly session cookie (`principalType = 'ACCESS_GRANT'`, `accessGrantId`).

---

## 6. Unlimited Devices, Dynamic Permission Resolution & Session Revocation

- **Unlimited Devices**: A single active Access Grant can be redeemed on unlimited devices/browsers simultaneously, each receiving a separate secure session.
- **Dynamic Authorization**: On EVERY request, authorization middleware resolves current backend grant state:
  ```text
  Verify grant exists AND grant.status == 'ACTIVE'
  Resolve current grant.roleCode and grant.version
  ```
- **Instant Role Changes**: Owner can change Grant role (`OWNER` ↔ `MANAGER` ↔ `TECH`). Increments `grant.version` and writes AuditLog. All active sessions immediately assume the new role on their next request without needing to reopen the link.
- **Instant Revocation**: Clicking Revoke sets `grant.status = 'REVOKED'`, releases 1 slot, revokes all active server sessions (`Session` lookup by `accessGrantId`), invalidates bearer URL, and writes AuditLog. Any request from a revoked session fails immediately with `HTTP 401 ACCESS_GRANT_REVOKED`.

---

## 7. Flex Message Push & Quota Integration

- Server constructs a polished LINE Flex Message for the selected friend with dormitory name, granted role, and a primary button **"เปิด HorPlus"** containing the bearer access URL.
- Successful Push delivery increments dormitory Push quota by 1 (Free: 30, Paid: 300 / month, labeled **`จำนวนการส่งข้อความ`**).
- Failed Push does NOT increment quota and does NOT revoke the grant. UI displays "Grant created but LINE delivery failed" with Copy Link & Retry Send options.

---

## 8. Secure Per-Dormitory LINE OA Configuration & Opaque Webhook

- `DormitoryLineConfig` stores `channelSecretEncrypted` and `channelAccessTokenEncrypted` using **AES-256-GCM**.
- GET endpoints return safe boolean flags (`hasChannelSecret`, `hasAccessToken`). Credentials are write-only.
- Public Webhook Route: `POST /api/v1/line/webhook/:opaqueWebhookKey` (maps via `webhookKeyHash`).
- Webhook is mounted with `express.raw({ type: 'application/json' })` BEFORE `express.json()`. Verifies `x-line-signature` via constant-time HMAC-SHA256 comparison. Invalid signature yields `HTTP 401 INVALID_SIGNATURE`.
- Durable Webhook Deduplication: `LineWebhookEventReceipt` enforces unique constraint on `webhookEventId`.

---

## 9. Data Model Impact (Prisma Schema)

```prisma
model DormitoryLineFriend {
  id                  String   @id @default(uuid()) @db.Uuid
  dormitoryId         String   @map("dormitory_id") @db.Uuid
  lineUserIdHash      String   @map("line_user_id_hash") @db.VarChar(255)
  lineUserIdEncrypted String   @map("line_user_id_encrypted") @db.Text
  displayName         String   @map("display_name") @db.VarChar(255)
  pictureUrl          String?  @map("picture_url") @db.Text
  friendStatus        String   @default("FOLLOWING") @db.VarChar(50) // FOLLOWING, UNFOLLOWED
  followedAt          DateTime @default(now()) @map("followed_at") @db.Timestamptz()
  unfollowedAt        DateTime? @map("unfollowed_at") @db.Timestamptz()
  lastSeenAt          DateTime @default(now()) @map("last_seen_at") @db.Timestamptz()
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  dormitory    Dormitory              @relation(fields: [dormitoryId], references: [id], onDelete: Cascade)
  accessGrants DormitoryAccessGrant[]

  @@unique([dormitoryId, lineUserIdHash], name: "dormitory_line_friend_unique")
  @@map("dormitory_line_friends")
}

model DormitoryAccessGrant {
  id                 String    @id @default(uuid()) @db.Uuid
  dormitoryId        String    @map("dormitory_id") @db.Uuid
  lineFriendId       String    @map("line_friend_id") @db.Uuid
  roleCode           String    @map("role_code") @db.VarChar(50) // OWNER, MANAGER, TECH
  tokenHash          String    @unique @map("token_hash") @db.VarChar(255)
  tokenPrefix        String?   @map("token_prefix") @db.VarChar(20)
  status             String    @default("ACTIVE") @db.VarChar(50) // ACTIVE, REVOKED
  version            Int       @default(1)
  createdByPrincipal String    @map("created_by_principal") @db.VarChar(255)
  revokedByPrincipal String?   @map("revoked_by_principal") @db.VarChar(255)
  revokedAt          DateTime? @map("revoked_at") @db.Timestamptz()
  lastRoleChangedAt  DateTime? @map("last_role_changed_at") @db.Timestamptz()
  createdAt          DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt          DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  dormitory  Dormitory           @relation(fields: [dormitoryId], references: [id], onDelete: Cascade)
  lineFriend DormitoryLineFriend @relation(fields: [lineFriendId], references: [id], onDelete: Cascade)
  sessions   Session[]

  @@index([dormitoryId, status])
  @@map("dormitory_access_grants")
}

model DormitoryLineConfig {
  id                          String    @id @default(uuid()) @db.Uuid
  dormitoryId                 String    @unique @map("dormitory_id") @db.Uuid
  lineOaId                    String?   @map("line_oa_id") @db.VarChar(100)
  channelId                   String?   @map("channel_id") @db.VarChar(100)
  channelSecretEncrypted      String?   @map("channel_secret_encrypted") @db.Text
  channelAccessTokenEncrypted String?   @map("channel_access_token_encrypted") @db.Text
  encryptionKeyVersion        Int       @default(1) @map("encryption_key_version")
  webhookKeyHash              String    @unique @map("webhook_key_hash") @db.VarChar(255)
  webhookKeyEncrypted         String?   @map("webhook_key_encrypted") @db.Text
  isConnected                 Boolean   @default(false) @map("is_connected")
  lastVerifiedAt              DateTime? @map("last_verified_at") @db.Timestamptz()
  createdAt                   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt                   DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  dormitory Dormitory @relation(fields: [dormitoryId], references: [id], onDelete: Cascade)

  @@map("dormitory_line_configs")
}

model LineWebhookEventReceipt {
  id             String   @id @default(uuid()) @db.Uuid
  dormitoryId    String   @map("dormitory_id") @db.Uuid
  webhookEventId String   @unique @map("webhook_event_id") @db.VarChar(255)
  eventType      String   @map("event_type") @db.VarChar(100)
  status         String   @db.VarChar(50) // processed, ignored, failed
  receivedAt     DateTime @default(now()) @map("received_at") @db.Timestamptz()
  processedAt    DateTime @default(now()) @map("processed_at") @db.Timestamptz()

  dormitory Dormitory @relation(fields: [dormitoryId], references: [id], onDelete: Cascade)

  @@map("line_webhook_event_receipts")
}
```

---

## 10. Execution Sequence & Checkpoint Plan

1. **Schema & Migration (`task009_staff_line_oa`)**: Add `DormitoryLineFriend`, `DormitoryAccessGrant`, `DormitoryLineConfig`, `LineWebhookEventReceipt`, and update `DormitoryMember`/`Session` relations. Add RLS policies.
2. **Crypto & Access Primitives**: Implement `crypto-encryption.ts` (AES-256-GCM & SHA-256 hashing) and session extension for `accessGrantId`.
3. **Backend Services & Routes**: Implement `line-friend.service.ts`, `access-grant.service.ts`, `line-oa.service.ts`, staff/access grant routes, redemption route (`POST /api/v1/staff-access/redeem`), and raw-body webhook handler.
4. **Backend Integration & Concurrency Tests**: Verify 10-slot capping concurrency, Permanent Google Owner immutability, instant role change, instant revocation, signature validation, and RLS isolation.
5. **Frontend Adapters & UI Components**: Implement staff/grant adapter, update `src/pages/owner/users.tsx` (Permanent Owner card, LINE Friends list, Grant modal, Revoke action), add `/staff-access` redemption handler, update `settings.tsx` LINE OA card.
6. **E2E, Migration Verification & Closure Evidence Report**.
