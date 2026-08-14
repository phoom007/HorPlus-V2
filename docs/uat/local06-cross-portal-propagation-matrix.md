# HorPlus Cross-Portal Propagation Matrix (LOCAL-06)

This matrix maps and verifies the end-to-end data flow, multi-role state propagation, notification triggers, and persistence guarantees across the entire HorPlus application.

---

## Propagation Flows

| Mutation ID | Source Role | Source Action | Destination Role | Expected Destination State | PostgreSQL Database State | In-App Notification Triggered | F5 Refresh Result | Verified Status |
|---|---|---|---|---|---|---|---|---|
| **PROP-001** | PUBLIC | Submit Tenant Registration (`/tenant/register`) | OWNER / MANAGER | Request appears in Owner Tenants -> Registration Requests tab with status `PENDING` | `tenant_registration_requests.status = 'PENDING'` | Owner notification generated | Pending card remains on F5 | PASS |
| **PROP-002** | OWNER / MANAGER | Approve Tenant Registration | TENANT | Applicant account provisioned; Tenant can log in and view assigned room & contract | `tenant_registration_requests.status = 'APPROVED'`, `tenants.id`, `contracts.id`, `rooms.status = 'occupied'` | Tenant welcome notification | Tenant portal active on F5 | PASS |
| **PROP-003** | OWNER / MANAGER | Create New Lease Contract (`/owner/contracts`) | TENANT | Contract appears in Tenant Portal -> Contract tab with rent & deposit breakdown | `contracts.status = 'ACTIVE'`, `contract_snapshots` created | In-app notification | Contract details intact on F5 | PASS |
| **PROP-004** | OWNER / TECH | Enter Meter Readings (`/owner/meters`) | TENANT | Authoritative water/electric readings recorded; Unpaid bill recalculation executed if people-count changed (Bill issuance is separate action) | `meter_readings` inserted, `room_billing_cycle_snapshots` updated, unpaid `bills` auto-recalculated | Notification generated on peopleCount correction | Meter readings intact on F5 | PASS |
| **PROP-005** | TENANT | Upload Payment Slip (`/tenant/pay`) | OWNER / MANAGER | Slip appears in Owner Payments -> Checking tab with status `UNDER_REVIEW` | `payments.status = 'UNDER_REVIEW'`, `bills.status = 'UNDER_REVIEW'` | Owner payment checking notice | Slip card intact on F5 | PASS |
| **PROP-006** | OWNER / MANAGER | Approve Payment Slip (`/owner/payments`) | TENANT | Bill marked `PAID`; Official receipt generated with receipt number (e.g. REC-202607-001) | `payments.status = 'APPROVED'`, `bills.status = 'PAID'`, `receipts` created | Tenant payment receipt notice | Paid status & receipt intact on F5 | PASS |
| **PROP-007** | OWNER / MANAGER | Reject Payment Slip with Reason | TENANT | Payment marked `REJECTED`; Bill reverts to `UNPAID`; Rejection reason shown to tenant | `payments.status = 'REJECTED'`, `bills.status = 'UNPAID'` | Tenant payment rejection notice with reason | Rejection message intact on F5 | PASS |
| **PROP-008** | OWNER / MANAGER | Record Cash Payment (`/owner/payments`) | TENANT | Bill marked `PAID` instantly; Cash receipt available in Tenant Portal -> Receipts | `payments.status = 'APPROVED'`, `payments.method = 'CASH'`, `bills.status = 'PAID'`, `receipts` created | Tenant receipt notice | Paid state intact on F5 | PASS |
| **PROP-009** | OWNER / MANAGER | Reverse Mistaken Payment | TENANT | Bill returns to `UNPAID`; Receipt marked voided (`is_voided = true`) | `payments.status = 'REVERSED'`, `bills.status = 'UNPAID'`, `receipts.is_voided = true` | Tenant payment reversal notice | Reversal intact on F5 | PASS |
| **PROP-010** | TENANT | Manage Co-Occupants (Add / Delete) | OWNER / MANAGER | Co-occupant list on Owner Tenant Profile updates immediately; Outbox event generates Staff Notification | `tenant_co_occupants` inserted / soft-deleted, `outbox_events` created | Staff notice generated with Room and co-occupant name | Co-occupants intact on F5 | PASS |
| **PROP-011** | TENANT | Submit Move-Out Notice (`/tenant/profile`) | OWNER / MANAGER | Move-out notice appears in Owner Tenants -> Lease Termination tab | `tenant_move_out_requests` inserted | Owner move-out notice | Move-out request intact on F5 | PASS |
| **PROP-012** | OWNER / MANAGER | Terminate Lease & Settle Deposit | TENANT | Room status -> `vacant`; Contract status -> `terminated`; Settlement statement created | `contracts.status = 'terminated'`, `rooms.status = 'vacant'`, `settlements` created | Tenant settlement notice | Vacant room & settlement intact on F5 | PASS |
| **PROP-013** | TENANT | Submit Contract Renewal Request | OWNER / MANAGER | Renewal request appears in Owner Contracts -> Renewal queue | `contract_renewal_requests.status = 'PENDING_OWNER_APPROVAL'` | Owner contract renewal notice | Renewal request intact on F5 | PASS |
| **PROP-014** | OWNER / MANAGER | Approve Contract Renewal | TENANT | Chained renewal contract created with `previousContractId`; Tenant portal shows extension | `contracts` (new active contract linked to previous), `contract_renewal_requests.status = 'APPROVED'` | Tenant renewal approval notice | Chained contract intact on F5 | PASS |
| **PROP-015** | TENANT | Submit Maintenance Request (`/tenant/repairs`) | OWNER / TECH | Request appears in Owner Maintenance Kanban board "Submitted" column | In-Memory maintenance queue | Owner maintenance notice | In-memory per product boundary | PASS |
| **PROP-016** | OWNER / TECH | Update Maintenance Status & Cost | TENANT | Tenant repair timeline updates (e.g. Scheduled / Done) with assigned technician | In-Memory maintenance queue | Tenant repair status update notice | In-memory per product boundary | PASS |
| **PROP-017** | OWNER / MANAGER | Broadcast Announcement (`/owner/announcements`) | TENANT | Announcement card appears on Tenant Portal Home & Announcements feed | In-Memory announcement queue | Tenant broadcast banner | In-memory per product boundary | PASS |
| **PROP-018** | OWNER | Create Staff Access Grant (`/owner/users`) | MANAGER / TECH | Bearer link `/staff-access#<token>` generated; Redeemed by staff to access role workspace | `staff_access_grants` created, `sessions` established | None | Grant & session intact on F5 | PASS |
| **PROP-019** | OWNER | Update Dormitory Payment Settings | TENANT | PromptPay QR code and Bank account details on Tenant Pay screen update immediately | `dormitory_billing_settings` updated | None | Updated payment info intact on F5 | PASS |
| **PROP-020** | OWNER | Update Property Defaults (3-Level Defaults) | ALL ROOMS | Newly created rooms inherit updated monthly rent and deposit defaults | `dormitories` defaults updated with version concurrency | None | Updated defaults intact on F5 | PASS |

---

## Architectural Guarantees

1. **Transactional Consistency**: All cross-portal database state transitions use Prisma transactions (`prisma.$transaction`) to guarantee atomic multi-table updates.
2. **Deterministic Role Segregation**: Tenant actions cannot alter Owner-level settings; Owner approval is strictly required for financial status transitions and contract renewals.
3. **Auditability & Outbox Propagation**: Critical business events generate structured outbox events dispatched reliably into in-app notifications.
