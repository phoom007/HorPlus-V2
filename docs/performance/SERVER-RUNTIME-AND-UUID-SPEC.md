# Server Runtime Stability & Prisma UUID Parameter Guard Specification (SRU-01 - SRU-04)

## 1. Executive Summary & Problem Statement

When attempting to run `npm run dev` and `npm run dev:api` and navigate through the application via Direct Access Grant links:
1. **Prisma P2023 UUID Crash**:
   Direct access users have synthetic user IDs (`ag_user_<grantId>`). When navigating to any owner/staff endpoint protected by `require-dormitory.ts`, the middleware invokes `membershipRepo.findByUserAndDormitory(req.auth.userId, dormitoryId)`. Because `DormitoryMember.userId` is mapped to `@db.Uuid` in PostgreSQL, Prisma's query engine rejects strings with characters like `'g'` with `P2023: Error creating UUID, invalid character: expected an optional prefix of urn:uuid: followed by [0-9a-fA-F-], found g at 2`. This unhandled exception crashes the Express server.
2. **Port 3001 EADDRINUSE**:
   When the background task in Antigravity keeps port 3001 bound, running `npm run dev:api` in a separate local terminal results in `EADDRINUSE: 3001`.
3. **Session Context Redundancy**:
   `authService.validateSession` already constructs a valid `syntheticMembership` on `req.auth.memberships` for `ACCESS_GRANT` sessions. The middleware should utilize this existing session context rather than redundantly querying PostgreSQL with an invalid UUID.

---

## 2. Product Owner Authorities & Locked Behaviors

- **Authorities**:
  - PO User Request: "npm run dev , npm run dev:api เกิด error ครับ วิเคราะห์สาเหตก่อน"
  - PO Confirmation: "ดำเนินการได้เลย"
- **Locked Behaviors**:
  - Security controls SEC-01 through SEC-08 remain strictly preserved.
  - Multi-tenant dormitory isolation and RLS context are preserved.
  - Existing Google OAuth and standard user authentication flow remain unaffected.
  - All existing unit, integration, and UI tests must pass 100%.

---

## 3. Scope of Changes

- `server/src/db/repositories/membership.repository.ts`:
  - Add `isUuid` regex check for `userId` (and `dormitoryId`).
  - Return `null` / `[]` safely when non-UUID string is provided.
- `server/src/middleware/require-dormitory.ts`:
  - First look for active membership in `req.auth?.memberships` matching `dormitoryId`.
  - Defensive try-catch around `findByUserAndDormitory` fallback.
- `server/src/__tests__/unit/membership-uuid-guard.test.ts`:
  - Targeted unit tests asserting that non-UUID `userId` does not throw and returns empty/null.
- Background process management:
  - Kill dangling Antigravity background tasks on port 3001 so the user can run `npm run dev:api`.

---

## 4. Acceptance Criteria (SRU-01 - SRU-04)

### SRU-01: Prisma UUID Parameter Guard in `membership.repository.ts`
- `findByUserId(userId)` must return `[]` immediately if `!isUuid(userId)`.
- `findByUserAndDormitory(userId, dormitoryId)` must return `null` immediately if `!isUuid(userId)` or `!isUuid(dormitoryId)`.
- No `P2023` error is thrown by Prisma when querying with `ag_user_...` synthetic user IDs.

### SRU-02: Auth Context Membership Reuse in `require-dormitory.ts`
- `createRequireDormitoryContextMiddleware` checks `req.auth?.memberships?.find(m => m.dormitoryId === dormitoryId && m.status === 'active')`.
- If found, `req.dormitoryContext` is populated using the existing membership context without querying the database table with a non-UUID ID.
- Fallback queries to `membershipRepo.findByUserAndDormitory` are wrapped in defensive error handling.

### SRU-03: Background Port 3001 Release & Clean Process Lifecycle
- Antigravity background task holding port 3001 is gracefully stopped.
- Port 3001 is completely free so that running `npm run dev:api` locally does not encounter `EADDRINUSE`.

### SRU-04: Automated Verification & Test Suite Integrity
- Full test pass across both frontend and backend suites:
  - `server/src/__tests__/unit/membership-uuid-guard.test.ts`
  - `server/src/__tests__/integration/direct-access-grant.test.ts`
  - `npm --prefix server run build` (Exit code 0)
  - `npm run build` (Exit code 0)
- Clear Thai instructions provided to PO on how to run both `npm run dev` and `npm run dev:api` cleanly.
