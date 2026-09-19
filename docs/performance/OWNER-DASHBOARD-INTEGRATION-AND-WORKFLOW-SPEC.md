# Specification: Owner Dashboard End-to-End Integration and Operational Workflow

**Document ID**: `SPEC-ODI-01`  
**Status**: APPROVED BY PO (via /grill-me Alignment)  
**Target Version**: HorPlus-V2 v2.8.0  
**Branch**: `main`

---

## Problem Statement

Currently, the Owner Dashboard (`/owner/dashboard` — "หน้าหลัก") is largely disconnected from the production HorPlus backend database:
1. **Mock Tenant Requests**: The "คำขอจากผู้เช่า" (Tenant Requests) section displays hardcoded mock data (`INITIAL_TENANT_REQUESTS`) and relies on fragile, transient browser LocalStorage. Approving or rejecting requests only modifies in-memory state and does not trigger real database mutations.
2. **Artificial & Drifted Financial Calculations**: The overdue balance KPI card ("ยอดค้างชำระทั้งหมด") includes an arbitrary `+500` THB estimated utility fallback for unissued rooms, creating discrepancies with the authoritative figures displayed in the Payments workspace (`/owner/payments`).
3. **Hardcoded Subscription Lifespan**: The top header banner shows a static `90 วัน` remaining lifespan badge, ignoring the dormitory's actual subscription entitlement, trial status, or expiration date in PostgreSQL.
4. **Unconnected Room Mutations**: Editing room attributes (rent, deposit, operational status) from the dashboard's room grid popup executes in-memory updates without sending `PUT` mutations to the server, causing immediate rollback upon page refresh.
5. **Lack of Role-Aware Security**: Operational staff (maids, maintenance technicians) see restricted administrative cards and menu buttons that expose sensitive financial aggregates and unauthorized system settings.

From the user's perspective, the dashboard gives an illusion of functionality while failing to serve as a reliable daily operations hub.

---

## Solution

Transform the Owner Dashboard into a fully integrated, live operational command center:
1. **Authoritative Tenant Requests**: Connect the requests section directly to backend endpoints (`/api/v1/tenant-registrations`, `/api/v1/tenant-move-out-requests`, and `/api/v1/contract-renewals/requests`). When no requests are pending, render a clean, professional empty state ("ไม่มีคำขอที่รอดำเนินการ") with zero mock data.
2. **Strict Financial Parity**: Compute all overdue and uncollected amounts solely from issued, active bills (`totalAmount - paidAmount` / `outstandingAmount`) in the selected billing cycle, completely eliminating arbitrary estimation fallbacks to achieve 100% parity with the Payments workspace.
3. **Live Subscription Entitlement**: Query `/api/v1/subscriptions/current` to determine actual remaining days and plan status. Clicking the badge navigates directly to the dedicated Subscription workspace (`/owner/subscription`).
4. **Transactional Room & Contract Mutations**: Wire room editing directly to `PUT /api/v1/properties/rooms/:id`, and integrate the Move-out / Terminate modal to execute authoritative contract termination, room vacancy, and deposit deduction tracking in the database.
5. **Strict Role-Aware Presentation**: Tailor the dashboard UI based on the authenticated actor's role. For Staff members, hide all revenue/financial cards and restricted navigation buttons (Payments, Reports, Settings, Users, Subscription).

---

## User Stories

1. As an **Owner**, I want to see real tenant registration requests submitted through the Tenant Portal on my dashboard, so that I can promptly approve or reject new tenants into the dormitory.
2. As an **Owner**, I want to see real move-out requests submitted by tenants, so that I can inspect departure dates, schedule room inspections, and initiate move-out settlements.
3. As an **Owner**, I want to see real contract renewal requests from tenants wishing to extend their stay, so that I can approve their term extension without manual paperwork.
4. As an **Owner**, I want to see contracts nearing expiration in the current cycle highlighted on the dashboard, so that I can follow up with tenants before contracts lapse.
5. As an **Owner**, I want the dashboard to show a clean "ไม่มีคำขอที่รอดำเนินการ" empty state when all requests are resolved, so that I am never confused by placeholder mock items.
6. As an **Owner**, I want approving a registration request from the dashboard to create real Tenant and Contract records and assign the room in the database, so that the tenant is immediately activated.
7. As an **Owner**, I want executing a move-out termination from the dashboard modal to update the contract to `TERMINATED`, release the room to `VACANT`, mark the tenant `INACTIVE`, and record deposit settlement details in the database, so that room inventory is instantly updated.
8. As an **Owner**, I want the "ยอดค้างชำระ" (Overdue Balance) on the dashboard to match the exact uncollected balance in `/owner/payments`, so that financial numbers across the application are consistent.
9. As an **Owner**, I want the dashboard to avoid adding arbitrary estimated utilities (such as +500 baht) to unissued rooms, so that I do not see phantom debt figures.
10. As an **Owner**, I want to see the count of rooms awaiting slip verification ("รอตรวจสลิป") reflecting actual unverified payments, so that I know how many transfers need my review.
11. As an **Owner**, I want the "เวลาใช้งานคงเหลือ" badge to display my real subscription days left from the database, so that I know when my subscription or trial requires renewal.
12. As an **Owner**, I want clicking the subscription badge to navigate directly to `/owner/subscription`, so that I can review plans, generate PromptPay QR codes, and verify renewal slips.
13. As an **Owner**, I want editing room details (rent, deposit, max occupants, status) from the dashboard room grid to persist to the database via API, so that my edits remain intact after page reload.
14. As a **Staff Member (Maid / Technician)**, I want the dashboard to hide financial totals, revenue KPIs, and overdue balances, so that confidential business figures are kept private.
15. As a **Staff Member**, I want the dashboard navigation to show only operational tools (Meters, Rooms, Maintenance), so that my workspace is focused on my daily maintenance tasks without unauthorized access errors.
16. As a **Manager**, I want full visibility into operational and billing workflows, so that I can assist the owner in day-to-day administrative duties.
17. As an **Owner**, I want clicking any main menu item from the dashboard to smoothly transition to the designated workspace with proper sub-tab context, so that my administrative workflow is fluid.

---

## Implementation Decisions

### 1. Data Orchestration & Service Layer
- Introduce a specialized frontend dashboard communication module to aggregate pending requests across three distinct backend resource collections:
  - Tenant Registration Requests
  - Move-out Requests
  - Contract Renewal Requests
- Normalize incoming records into a uniform presentation model (`TenantRequestItem`) supporting category classification, room mapping, tenant identity, and request timestamps.
- Remove all static mock request arrays and mock ID references.
- Implement mutation methods for approval, rejection, and emergency tenancy termination that interact with authentic backend endpoints and invalidate React Query caches (`rooms`, `tenants`, `contracts`, `bills`, `dashboard`).

### 2. Financial KPI Calculation Engine
- Overdue and outstanding balance calculations must only sum issued, active bills whose status is unpaid, pending, overdue, or checking.
- Bill matching must evaluate both `billingCycleId` and `cycleCode` to prevent cycle mismatch regressions.
- Eliminate all arbitrary baseline addition heuristics (`(monthlyRent || 0) + 500`). Rooms with unissued monthly utilities must contribute 0.00 to overdue debt until the owner officially generates the bill.

### 3. Subscription Entitlement Synchronization
- Retrieve live subscription metadata through the authenticated subscription endpoint.
- For perpetual free tiers, display a lifetime active badge. For active trials or paid tiers, compute exact remaining calendar days from `expiresAt`.
- Replace the standalone mock subscription payment modal in the dashboard with seamless navigation to the canonical `/owner/subscription` route.

### 4. Room Management & Terminate Flow
- Connect room card modal submissions to the property room modification API.
- Upon saving, dispatch updates through standard HTTP client facilities with immediate query invalidation.
- The move-out termination dialog will collect deduction items, net refund/excess, and termination dates, passing them to the backend tenancy completion service.

### 5. Role-Based Access Control (RBAC) Presentation
- Evaluate the actor's resolved role (`owner`, `manager`, `staff`).
- If the role is `staff`:
  - Completely suppress the top financial summary card.
  - Filter the main navigation grid to show only authorized operational modules.

---

## Testing Decisions

### Test Characteristics & Strategy
- **Behavioral & Contract-Centric**: Tests must assert external UI behavior, DOM outputs, and network payload contracts rather than internal state variables or private component hooks.
- **Mock Service Worker / HTTP Interception**: Test against realistic HTTP responses matching the PostgreSQL schema and backend controller output.

### Target Test Suites
1. **`owner-dashboard-integration.test.tsx`**:
   - **Request Loading & Empty State**: Proves that real requests render correctly, and that an empty database yields the empty state message with zero mock cards.
   - **Request Approvals & Rejections**: Proves that approving a registration, move-out, or renewal fires the appropriate HTTP mutation and triggers success feedback.
   - **Financial Aggregation Precision**: Proves that overdue totals match the sum of active bills, and verifies that unissued rooms add zero arbitrary estimates.
   - **Subscription Days Resolution**: Proves that live subscription expiration dates calculate exact day counts.
   - **Role-Aware Scoping**: Proves that staff logins hide financial cards and unauthorized menu buttons.
   - **Room Edit Persistence**: Proves that modifying room fields issues a valid update request.

### Prior Art
- `src/tests/tax-invoice-single-sheet-and-sync.test.tsx` (Single-sheet document generation and meter synchronization)
- `src/tests/owner-payments-r38e-receipt.test.tsx` (Payment aggregation and canonical receipt resolution)
- `src/tests/owner-vat-presentation-and-settings.test.tsx` (Settings parity and export integrity)

---

## Out of Scope
- Redesigning the Tenant Portal submission forms (tenant-facing UI).
- Altering the backend database schema or running new Prisma migrations (existing schema is fully capable).
- Replacing the canonical Subscription workspace (`/owner/subscription`).
- Multi-currency or non-THB conversions.

---

## Further Notes
- All changes must preserve existing localization and Thai date formatting conventions (`formatToThaiFullDate`, `formatToShortThaiDate`).
- Toast notifications must adhere to the standardized white-card, smooth-fade design pattern established in recent updates.
