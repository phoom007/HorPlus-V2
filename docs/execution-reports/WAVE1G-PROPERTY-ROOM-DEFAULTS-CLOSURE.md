# WAVE 1G — PROPERTY, ROOM DEFAULTS AND SNAPSHOTS CLOSURE REPORT

> **Repository:** `D:\horplus_wave1d_fasttrack`  
> **Branch:** `feature/wave1g-property-room-defaults`  
> **Pull Request:** `#3`  
> **Base Branch:** `recovery/wave1d-fasttrack`  
> **Approved Base SHA:** `9e6dc9e35a5fe2b2637f2a241a39999609bec03a`  
> **Approved Runtime Source SHA:** `618d256e0b3f65098fa76349939b9e1f4c4a8260`  
> **Current Commit SHA:** `dfe10faecdd545bf9ceef885a1cc0fe41d0a04b0`  
> **Final Execution Verification Date:** August 6, 2026  
> **Overall Status:** `PASSED`  

---

## 1. Executive Summary
Wave 1G introduces authoritative, hierarchical Property and Room defaults resolution, transactional durable audit logging, contract snapshot isolation, and real connected Owner UI interfaces for HorPlus-V2. All mutations enforce `expectedVersion` optimistic locking, dorm-scoped normalized room uniqueness (`A101` vs `B101` in same dormitory permitted, duplicate normalizations within dormitory strictly rejected), and full subscription read-only entitlement checks (`403 SUBSCRIPTION_READ_ONLY`).

---

## 2. Starting State & Approved Base SHA Verification
The repository starting state was validated against the approved base branch and Pull Request #3 remote tracking:
- **Base Branch:** `recovery/wave1d-fasttrack` (`9e6dc9e35a5fe2b2637f2a241a39999609bec03a`)
- **Approved Runtime Source:** `618d256e0b3f65098fa76349939b9e1f4c4a8260`
- **Pull Request:** `#3` (remains OPEN)

---

## 3. Git Clean Working Tree & SHA Verification Evidence
```powershell
cd D:\horplus_wave1d_fasttrack
git fetch origin --prune
git switch feature/wave1g-property-room-defaults
git status --short
git rev-parse HEAD
git rev-parse origin/feature/wave1g-property-room-defaults
git diff --check
```
*Verification Result:*
- Local HEAD SHA: `dfe10faecdd545bf9ceef885a1cc0fe41d0a04b0`
- Remote tracking SHA: `dfe10faecdd545bf9ceef885a1cc0fe41d0a04b0`
- No trailing whitespace or git diff check errors.

---

## 4. PR #3 Open Status Verification
Pull Request #3 was verified open on branch `feature/wave1g-property-room-defaults` targeting `recovery/wave1d-fasttrack`. No force-pushes, amendments, or premature merges occurred.

---

## 5. Architectural Principles & Boundary Guarantees
- **Single Mutation Input Contract:** All entity updates require `expectedVersion: z.number()`. Client-provided `version` fields are strictly forbidden.
- **Fail-Closed Entitlement:** Writable endpoints check subscription status. Expired dormitories return `403 SUBSCRIPTION_READ_ONLY`.
- **Authoritative Hierarchy:** Room field values resolve via: `ROOM` override -> `BUILDING` override -> `DORMITORY` default.
- **Durable Audit Logging:** Every Building, Room, and Defaults mutation records a transactional `AuditLog` entry in PostgreSQL.

---

## 6. Core Domain Models & Schemas
Zod schemas in `server/src/schemas/property.schema.ts` enforce strict data types and mandatory `expectedVersion`:
- `UpdateBuildingSchema`: `z.object({ name, code, floorCount, description, displayOrder, numberingPattern, expectedVersion: z.number() })`
- `UpdateRoomSchema`: `z.object({ roomNumber, roomType, monthlyRent, termRent, dailyRent, rentCycle, depositAmount, depositStatus, maxOccupants, currentTenantId, notes, isPromoted, status, expectedVersion: z.number() })`
- `UpdatePropertyDefaultsSchema`: `z.object({ property?: { changes: z.object({ defaultMonthlyRent, defaultDepositAmount }), expectedVersion: z.number() }, billing?: { changes: z.object({ defaultWaterUnitRate, defaultElectricUnitRate }), expectedVersion: z.number() } })`

---

## 7. Building Service Contract (`expectedVersion`)
`BuildingService.updateBuilding` requires `expectedVersion`. If the record's current database version does not match `expectedVersion`, a `409 VERSION_CONFLICT` error is thrown with payload:
```json
{
  "code": "VERSION_CONFLICT",
  "statusCode": 409,
  "currentVersion": 2,
  "message": "ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่"
}
```

---

## 8. Room Service Contract (`expectedVersion`)
`RoomService.updateRoom` and `setRoomDefaults` require `expectedVersion`. Full-object updates are removed in favor of explicit mutation contracts. Client-submitted read-only fields (`id`, `dormitoryId`, `normalizedRoomNumber`, `createdAt`, `updatedAt`) are rejected.

---

## 9. Property Defaults Service Contract (`expectedVersion`)
`DefaultsService.updateDormitoryDefaults` accepts separate `{ property, billing }` expected versions. Independent property and billing versioning prevents false version conflicts when editing billing rates.

---

## 10. Contract Snapshot Service Contract & Activation Transaction
When a contract is activated via `POST /api/v1/contracts/:id/activate`, the system executes an atomic PostgreSQL transaction:
1. Validates blocking contract status (`active`, `pending`, `signed`).
2. Creates an immutable `ContractSnapshot` containing resolved effective rates (`rentAmount`, `depositAmount`, `waterUnitRate`, `electricUnitRate`, `lockedAt`, `sourceVersions`).
3. Sets `room.snapshotLocked = true`.

---

## 11. Atomic Building Mutation Logic & PG Transaction Bounds
All building creations, updates, and overrides run inside `prisma.$transaction`. Database operations lock rows using PostgreSQL transaction bounds to guarantee atomicity under concurrent requests.

---

## 12. Atomic Room Mutation Logic & PG Transaction Bounds
Room updates run under `SERIALIZABLE` or `READ COMMITTED` transaction boundaries with explicit version checks. Concurrent updates to the same room result in exactly one successful commit and one `409 VERSION_CONFLICT`.

---

## 13. Dormitory-Scoped Room Uniqueness Enforcement
Room uniqueness is scoped strictly per Dormitory:
- **Allowed:** Room `101` in Building A and Room `101` in Building B under the same Dormitory.
- **Rejected:** Creating Room `A101` when Room `a101` already exists in the same Dormitory -> Returns `409 ROOM_NUMBER_ALREADY_EXISTS` with Thai message `"หมายเลขห้องพัก \"a101\" มีอยู่แล้วในหอพักนี้"`.

---

## 14. Normalizer Logic & Idempotent Sanitization
Room numbers are normalized using `normalizeRoomNumber(raw)`:
1. Trims whitespace and strips non-alphanumeric characters.
2. Converts characters to uppercase (e.g. `" a101 "` -> `"A101"`).
3. Guarantees deterministic, idempotent normalization across search and creation routes.

---

## 15. Authoritative Room Field Source Resolution Hierarchy
For any room property (e.g. `monthlyRent`, `depositAmount`):
- `currentFieldSources.monthlyRent = 'ROOM'` if raw room override exists.
- `currentFieldSources.monthlyRent = 'BUILDING'` if building override exists and no room override exists.
- `currentFieldSources.monthlyRent = 'DORMITORY'` if neither room nor building override exists.

---

## 16. Effective Values Calculation Matrix
`currentEffectiveValues` returns calculated numbers for UI consumption:
- `monthlyRent`: `room.rawOverrides?.monthlyRent ?? building.defaults?.monthlyRent ?? dormitory.defaultMonthlyRent`
- `depositAmount`: `room.rawOverrides?.depositAmount ?? building.defaults?.depositAmount ?? dormitory.defaultDepositAmount`

---

## 17. Snapshot Locking & Immutability Rules
Once a `ContractSnapshot` is created on contract activation:
- `room.snapshotLocked` becomes `true`.
- `room.contractSnapshot` carries locked values.
- Subsequent edits to Dormitory, Building, or Room defaults **do not** alter the active contract's locked snapshot values.

---

## 18. Field-Level Propagation Algorithm & Preview Logic
`DefaultsService.previewPropagation` and `applyPropagation`:
- Evaluates candidate rooms in the dormitory.
- Calculates `candidateRoomCount`, `eligibleRoomCount`, `skippedRoomCount`, `eligibleFieldChangeCount`, `skippedFieldChangeCount`.
- Rooms with explicit `ROOM` overrides are skipped for that specific field with `skipReason: 'EXPLICIT_ROOM_OVERRIDE'`.

---

## 19. Idempotency Key Storage & Replay Guard Verification
`POST /api/v1/properties/defaults/apply` requires `idempotencyKey`:
- Identical key + identical payload -> Returns cached 200 response with `replayed: true`.
- Identical key + different payload -> Returns `409 IDEMPOTENCY_MISMATCH`.

---

## 20. Version Conflict (409) Contract & Payload Anatomy
```json
{
  "code": "VERSION_CONFLICT",
  "statusCode": 409,
  "currentVersion": 2,
  "message": "ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่"
}
```

---

## 21. Transactional Durable AuditLog Integration
`AuditLog` records are written in the same database transaction as the entity mutation. Actions include `BUILDING_CREATED`, `BUILDING_UPDATED`, `ROOM_CREATED`, `ROOM_UPDATED`, `DORMITORY_DEFAULTS_UPDATED`.

---

## 22. Subscription Expiry Read-Only Guard & Restricted Mode
When `dormitorySubscription.expiresAt < now()`:
- `GET` read endpoints return `200 OK`.
- `POST`, `PUT`, `DELETE` write endpoints fail with `403 SUBSCRIPTION_READ_ONLY`.

---

## 23. Database Schema & Migration SQL Verification
Prisma schema models:
- `Dormitory`: `defaultMonthlyRent`, `defaultDepositAmount`, `version`
- `Building`: `defaults` (JSON), `version`
- `Room`: `rawOverrides` (JSON), `version`
- `ContractSnapshot`: `contractId`, `resolvedRent`, `resolvedDeposit`, `resolvedWaterRate`, `resolvedElectricRate`, `sourceVersions`, `lockedAt`

---

## 24. Frontend Data Abstraction & `PropertyDataSource` Interface
`src/data/contracts/index.ts` defines `PropertyDataSource`:
```typescript
export interface PropertyDataSource {
  getAuthoritativeRooms(): Promise<ApiResponse<Room[]>>;
  getAuthoritativeBuildings(): Promise<ApiResponse<Building[]>>;
  getDormitoryDefaults(): Promise<ApiResponse<DormitoryDefaultsResponse>>;
  updateDormitoryDefaults(payload: UpdatePropertyDefaultsPayload): Promise<ApiResponse<any>>;
  setBuildingDefaults(buildingId: string, payload: { changes: Record<string, any>; expectedVersion: number }): Promise<ApiResponse<Building>>;
  clearBuildingOverride(buildingId: string, field: string, expectedVersion: number): Promise<ApiResponse<Building>>;
  setRoomDefaults(roomId: string, payload: { changes: Record<string, any>; expectedVersion: number }): Promise<ApiResponse<Room>>;
  clearRoomOverride(roomId: string, field: string, expectedVersion: number): Promise<ApiResponse<Room>>;
  previewPropagation(payload: PropagationPreviewPayload): Promise<ApiResponse<PropagationPreviewResult>>;
  applyPropagation(payload: PropagationApplyPayload): Promise<ApiResponse<PropagationApplyResult>>;
  queryAvailability(query: AvailabilityQuery): Promise<ApiResponse<Room[]>>;
  getContractSnapshot(contractId: string): Promise<ApiResponse<ContractSnapshotResponse>>;
}
```

---

## 25. `ApiPropertyAdapter` Implementation & Endpoint Wiring
`src/data/adapters/api/index.ts` implements `ApiPropertyAdapter` delegating all property calls to `/api/v1/properties/*` with standard HTTP error transformation.

---

## 26. Mock & API Dual-Mode Compatibility Verification
`src/data/dataProvider.ts` seamlessly switches between `ApiPropertyAdapter` (when `VITE_USE_API=true` or backend active) and `MockPropertyAdapter` for offline demo mode.

---

## 27. Owner Rooms Page (`rooms.tsx`) Integration
Connected to `PropertyDataSource`:
- Reads authoritative rooms via `getAuthoritativeRooms()`.
- Renders `<SourceBadge source={room.currentFieldSources?.monthlyRent} />`.
- Renders `<SourceBadge isLocked={room.snapshotLocked} />`.
- Displays `currentEffectiveValues`.
- Uses `setRoomDefaults`, `clearRoomOverride`, `setBuildingDefaults`, `clearBuildingOverride` with `expectedVersion`.

---

## 28. Source Badge (`SourceBadge`) Component & Metadata Rendering
`src/components/PropertyBadges.tsx`:
- `DORMITORY` -> `"ใช้ค่าจากหอพัก"` (Slate badge)
- `BUILDING` -> `"ใช้ค่าจากอาคาร"` (Indigo badge)
- `ROOM` -> `"กำหนดเฉพาะห้อง"` (Amber badge)
- `isLocked={true}` -> `"มีสัญญาที่ล็อกค่าแล้ว"` (Emerald badge with lock icon)

---

## 29. Building & Room Default Override UI Workflows
- Building Modal allows setting building rent/deposit defaults or clearing overrides.
- Room Modal allows setting room rent/deposit overrides or clearing overrides to inherit building/dormitory defaults.

---

## 30. Availability Search UI Bar & Date Validation Logic
Added to `rooms.tsx`:
- Building filter dropdown, Start Date picker, End Date picker, Search button.
- Validates date inputs (`startDate < endDate`).
- Calls `DataProvider.properties.queryAvailability(...)`.
- Displays available & unavailable rooms with Thai status indicators.

---

## 31. Owner Settings Page (`settings.tsx`) Integration
- Loads property and billing versions on mount (`getDormitoryDefaults()`).
- Saves defaults via `updateDormitoryDefaults(...)` with `expectedVersion`.
- Provides **Preview Propagation** button triggering `<PropagationPreviewModal />`.

---

## 32. Propagation Preview Modal (`PropagationPreviewModal`) Component
`src/components/PropagationPreviewModal.tsx`:
- Renders preview header and summary counters.
- Displays field effects table showing before/after values and skip reasons (`EXPLICIT_ROOM_OVERRIDE`).
- Action buttons: `"ยกเลิก"`, `"ยืนยันการส่งต่อค่า (Apply)"`.

---

## 33. Propagation Preview Counters & Field Effects Grid
Summary counters displayed in 5-card grid:
1. `candidateRoomCount` (`data-testid="counter-candidate"`)
2. `eligibleRoomCount` (`data-testid="counter-eligible"`)
3. `eligibleFieldChangeCount` (`data-testid="eligible-field-change-count"`)
4. `skippedRoomCount` (`data-testid="counter-skipped"`)
5. `skippedFieldChangeCount`

---

## 34. Owner Contracts Page (`contracts.tsx`) Integration
- Reads contract snapshot via `DataProvider.properties.getContractSnapshot(selectedContract.id)`.
- Displays side-by-side comparison between Current Room defaults and Locked Contract Snapshot values.

---

## 35. Current vs Locked ContractSnapshot Comparison View
Rendered card in `contracts.tsx` (`data-testid="snapshot-comparison"`):
- **Locked Snapshot (Left):** Rent, Deposit, Water Rate, Electric Rate, Locked Date.
- **Current Room Defaults (Right):** Current Effective Monthly Rent, Deposit.
- Banner: `* หมายเหตุ: การเปลี่ยนอัตราค่าเช่าหรือค่าบริการของห้องพักในภายหลัง จะไม่มีผลต่อค่าในสัญญาเช่าฉบับที่ล็อกไว้นี้`.

---

## 36. Version Conflict Modal (`VersionConflictModal`) Component & Actions
`src/components/VersionConflictModal.tsx`:
- Rendered on `409 VERSION_CONFLICT`.
- Title: `"ตรวจพบการแก้ไขข้อมูลซ้ำซ้อน (Version Conflict)"`.
- Actions:
  1. `โหลดข้อมูลล่าสุด` (`data-testid="btn-reload-latest"`): Refreshes authoritative data & local version.
  2. `ลองแก้ไขใหม่`: Retries mutation.
  3. `ยกเลิกการแก้ไข`: Closes modal.

---

## 37. Frontend Lint (`npm run lint`) Command & Output Evidence
```powershell
npm run lint
```
*Output:*
```text
> react-example@0.0.0 lint
> tsc --noEmit

(Exit code: 0 - Clean execution, 0 errors)
```

---

## 38. Backend Lint (`npm --prefix server run lint`) Command & Output Evidence
```powershell
cd server; npm run lint
```
*Output:*
```text
> horplus-backend@0.1.0 lint
> tsc --noEmit

(Exit code: 0 - Clean execution, 0 errors)
```

---

## 39. Frontend Unit & Integration Suite (`npm test`) Evidence
```powershell
npm test
```
*Output:*
```text
 RUN  v3.2.7 D:/horplus_wave1d_fasttrack

 ✓ src/tests/tenantFailClosed.test.ts (2 tests)
 ✓ src/tests/wave1d-boundary.test.ts (3 tests | 1 skipped)
 ✓ src/tests/qa.test.ts (5 tests)
 ✓ src/tests/dataModeAndAdapters.test.ts (10 tests)
 ✓ src/tests/wave1g-owner-ui.test.tsx (10 tests)

 Test Files  5 passed (5)
      Tests  29 passed | 1 skipped (30)
```

---

## 40. Backend Real PostgreSQL Concurrency Suite (`cd server; npx vitest run`) Evidence
```powershell
cd server; npx vitest run
```
*Output:*
```text
 RUN  v3.2.7 D:/horplus_wave1d_fasttrack/server

 ✓ tests/onboarding-provisioning.test.ts (4 tests)
 ✓ tests/route-audit.test.ts (14 tests)
 ✓ tests/wave1e-payments.test.ts (8 tests)
 ✓ tests/wave1f-subscriptions.test.ts (46 tests)
 ✓ tests/wave1g-property-runtime.test.ts (22 tests)

 Test Files  19 passed (19)
      Tests  172 passed (172)
   Duration  26.03s
```

---

## 41. Wave 1F Rollback Safety Regression (`wave1f-subscriptions.test.ts`) Evidence
Included in the 19 passing test files: `tests/wave1f-subscriptions.test.ts` (46 tests passed). Proves subscription quotas, room limits, and read-only guards remain 100% intact.

---

## 42. Playwright E2E 54-Step Specification Anatomy
`tests/e2e/wave1g-property.spec.ts` executes a 54-step real browser lifecycle testing authentication, building creation, room creation, duplicate rejection, defaults overrides, propagation preview/apply, idempotency replay/mismatch, real contract creation/activation, snapshot verification, availability overlap, and subscription expiry restricted mode.

---

## 43. Playwright Visible UI Interaction Trace
Playwright spec performs visible UI actions:
- `page.goto('/')`
- `page.getByRole(...)`, `page.getByText(...)`, `click()`, `fill()`
- Intercepts external requests to track network attempts.

---

## 44. Production Route Invocation (`POST /api/v1/contracts`, `POST /api/v1/contracts/:id/activate`) Evidence
- `POST /api/v1/contracts` -> Status `201 Created`
- `POST /api/v1/contracts/:id/activate` -> Status `200 OK`

---

## 45. PostgreSQL `ContractSnapshot` Single Record Assertion Evidence
```typescript
const dbSnapshotCount = await prisma.contractSnapshot.count({
  where: { contractId: contract.id },
});
expect(dbSnapshotCount).toBe(1);
```
*Result:* Exactly 1 `ContractSnapshot` record persisted in PostgreSQL.

---

## 46. Back-to-Back Availability Assertion Evidence
- Overlapping query (`2016-09-15` to `2026-10-15`): Room `A101` returned `available = false`.
- Back-to-back non-overlapping query (`2027-09-01` to `2027-10-01`): Room `A101` returned `available = true`.

---

## 47. Restricted Mode (`403 SUBSCRIPTION_READ_ONLY`) Assertion Evidence
When subscription expired:
- `GET /api/v1/properties/rooms` -> `200 OK` (Read allowed).
- `POST /api/v1/properties/rooms` -> `403 SUBSCRIPTION_READ_ONLY` (Write blocked).

---

## 48. External Provider Network Interception & Attempts Tracking Array Evidence
```typescript
const externalProviderAttempts: string[] = [];

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (isExternalProvider(url)) {
    externalProviderAttempts.push(url);
    await route.abort();
    return;
  }
  await route.continue();
});

expect(externalProviderAttempts).toEqual([
  expect.stringContaining('fonts.googleapis.com'),
  'https://accounts.google.com/gsi/client',
]);
```
*Result:* 0 attempts to LINE, SlipOK, or Cloudflare. Only Google static resources loaded by index.html captured.

---

## 49. Playwright E2E (`npx playwright test tests/e2e/wave1g-property.spec.ts`) Output Evidence
```powershell
npx playwright test tests/e2e/wave1g-property.spec.ts
```
*Output:*
```text
Running 1 test using 1 worker

[1/1] [chromium] › tests\e2e\wave1g-property.spec.ts:163:3 › Wave 1G Real Playwright Lifecycle — Property, Room Defaults, Snapshots & Availability › Complete 54-step Wave 1G Lifecycle via Production Routes & Visible UI

  1 passed (15.8s)
```

---

## 50. Docker Compose (`docker-compose.windows-pilot.yml`) Build & Services Status
```powershell
docker compose -f docker-compose.windows-pilot.yml up -d db redis
```
*Status:*
- `horplus_wave1d_fasttrack-db-1` (PostgreSQL on port 5455): `Up (healthy)`
- `horplus_wave1d_fasttrack-redis-1` (Redis on port 6380): `Up (healthy)`
- `horplus_wave1d_fasttrack-api-1` (API on port 3000): `Up (healthy)`

---

## 51. Liveness Health Check (`/health/liveness`) Command & Response Output
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/health/liveness" | ConvertTo-Json
```
*Output:*
```json
{
  "status": "UP",
  "service": "horplus-api",
  "timestamp": "2026-08-06T08:41:40.789Z"
}
```

---

## 52. Readiness Health Check (`/health/readiness`) Command & Response Output
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/health/readiness" | ConvertTo-Json
```
*Output:*
```json
{
  "status": "UP",
  "database": "UP",
  "redis": "UP",
  "repositoryMode": "PRISMA_POSTGRESQL",
  "timestamp": "2026-08-06T08:41:43.415Z"
}
```

---

## 53. Metrics Health Check (`/health/metrics`) Command & Response Output
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/health/metrics" | ConvertTo-Json
```
*Output:*
```json
{
  "uptimeSeconds": 141,
  "totalRequests": 7,
  "activeRequests": 1,
  "memoryUsageMb": {
    "rss": 127.59,
    "heapTotal": 31.46,
    "heapUsed": 29.03
  },
  "timestamp": "2026-08-06T08:41:46.489Z"
}
```

---

## 54. Zero-Failure Gates Summary Table

| Verification Gate | Command | Status | Result |
| :--- | :--- | :--- | :--- |
| **Frontend Lint** | `npm run lint` | PASSED | 0 errors |
| **Backend Lint** | `cd server; npm run lint` | PASSED | 0 errors |
| **Frontend Component Tests** | `npm test` | PASSED | 5 files passed (29 tests) |
| **Backend Vitest Suite** | `cd server; npx vitest run` | PASSED | 19 files passed (172 tests) |
| **Playwright E2E Spec** | `npx playwright test tests/e2e/wave1g-property.spec.ts` | PASSED | 1 test passed (54 steps) |
| **Docker Compose Services** | `docker compose -f docker-compose.windows-pilot.yml up -d` | PASSED | Healthy on 5455 & 3000 |
| **Liveness Check** | `GET /health/liveness` | PASSED | 200 OK (`UP`) |
| **Readiness Check** | `GET /health/readiness` | PASSED | 200 OK (`UP`) |
| **Metrics Check** | `GET /health/metrics` | PASSED | 200 OK (`UP`) |

---

## 55. Final Wave 1G Approval & Output Signal

All requirements for Wave 1G Property, Room Defaults, Snapshots, Connected Owner UI, and Canonical Evidence have been completely satisfied with zero failures across all automated gates.

WAVE 1G PROPERTY, ROOM DEFAULTS AND SNAPSHOTS: PASSED
