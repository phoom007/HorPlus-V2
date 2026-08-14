# HorPlus Role Permission Matrix (LOCAL-06)

This matrix specifies the authoritative access control rules and authorization boundaries across all user roles in HorPlus.

---

## Role Definitions

- **`OWNER`**: Full administrative authority over all dormitory operations, staff grants, settings, subscriptions, and financial records.
- **`MANAGER`**: Operational authority over daily operations (Rooms, Tenants, Contracts, Meters, Billing, Payments, Maintenance, Announcements, Reports). Restricted from system settings, staff access grants, and subscription management.
- **`TECH`** (Staff): Technical field authority limited to Meter reading entry, Maintenance/Repair tickets, and Dashboard overview. Restricted from financial, tenant personal, and administrative settings.
- **`TENANT`**: Portal access strictly limited to personal room, itemized invoices, payment slip submissions, repair requests, active contract/renewals, utility charts, receipts, and personal co-occupants.
- **`PUBLIC`**: Unauthenticated public visitors and prospective dormitory applicants.

---

## Authoritative Permission Matrix

| Feature / Action / Route | OWNER | MANAGER | TECH | TENANT | PUBLIC |
|---|---|---|---|---|---|
| **Public Landing & Info Pages** (`/`, `/features`, `/pricing`, `/how-it-works`, `/help`, `/terms`, `/privacy`) | `ALLOW` | `ALLOW` | `ALLOW` | `ALLOW` | `ALLOW` |
| **Owner Authentication** (`/auth/owner`) | `ALLOW` | `ALLOW` | `ALLOW` | `ALLOW` | `ALLOW` |
| **Tenant Registration Submission** (`/tenant/register`) | `ALLOW` | `ALLOW` | `ALLOW` | `ALLOW` | `ALLOW` |
| **Staff Bearer Token Redemption** (`/staff-access#<token>`) | `ALLOW` | `ALLOW` | `ALLOW` | `DENY` | `ALLOW` |
| **Owner Dashboard Overview** (`/owner/dashboard`) | `ALLOW` | `ALLOW` | `ALLOW` | `DENY` | `DENY` |
| **Owner Global Search** (`/owner/*`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Owner Notification Center** (`/owner/*`) | `ALLOW` | `ALLOW` | `ALLOW` | `DENY` | `DENY` |
| **Rooms: View Inventory & Availability** (`/owner/rooms`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Rooms: Create, Edit, Delete Rooms** (`/owner/rooms`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Buildings: Manage Buildings & Floors** (`/owner/rooms`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Tenants: Directory & Profile Info** (`/owner/tenants`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Tenants: Add, Edit, Move-Out, Transfer** (`/owner/tenants`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Tenants: Review Registration Requests** (`/owner/tenants`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Contracts: View List, Snapshots & PDF** (`/owner/contracts`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Contracts: Create, Renew, Terminate** (`/owner/contracts`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Contracts: Settlement Reconciliation** (`/owner/contracts`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Meters: View Readings & Cycle Data** (`/owner/meters`) | `ALLOW` | `ALLOW` | `ALLOW` | `DENY` | `DENY` |
| **Meters: Record Water & Electric Readings** (`/owner/meters`) | `ALLOW` | `ALLOW` | `ALLOW` | `DENY` | `DENY` |
| **Payments: View Slips & Unpaid Bills** (`/owner/payments`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Payments: Approve / Reject Slips** (`/owner/payments`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Payments: Record Cash Payment & Reversals** (`/owner/payments`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Payments: View Official Receipts** (`/owner/payments`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Maintenance: View Kanban Board** (`/owner/maintenance`) | `ALLOW` | `ALLOW` | `ALLOW` | `DENY` | `DENY` |
| **Maintenance: Create, Assign, Update Status/Cost** (`/owner/maintenance`) | `ALLOW` | `ALLOW` | `ALLOW` | `DENY` | `DENY` |
| **Announcements: View & Broadcast** (`/owner/announcements`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Reports: Financial Metrics & Charts** (`/owner/reports`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Reports: CSV Export Download** (`/owner/reports`) | `ALLOW` | `ALLOW` | `DENY` | `DENY` | `DENY` |
| **Users & Staff: View Quota & Staff List** (`/owner/users`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Users & Staff: Create, Modify, Revoke Grants** (`/owner/users`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Users & Staff: LINE OA Configuration** (`/owner/users`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Subscription: View Entitlements & Limits** (`/owner/subscription`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Subscription: Redeem Promo Code & Upgrade** (`/owner/subscription`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Settings: Dormitory Profile Update** (`/owner/settings`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Settings: Property Defaults & Concurrency** (`/owner/settings`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Settings: Billing Rates & Modes** (`/owner/settings`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Settings: Payment Recipient (PromptPay/Bank)** (`/owner/settings`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Settings: Owner Digital Signature** (`/owner/settings`) | `ALLOW` | `DENY` | `DENY` | `DENY` | `DENY` |
| **Tenant Portal: Dashboard & Room Info** (`/tenant/dashboard`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Invoice & Itemized Bill** (`/tenant/invoice`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Upload Slip & PromptPay QR** (`/tenant/pay`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Submit Repair Request** (`/tenant/repairs`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Utilities Consumption Charts** (`/tenant/utilities`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: View Active Contract & PDF** (`/tenant/contract`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Submit Contract Renewal** (`/tenant/contract`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Receipt History** (`/tenant/payments_tab`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Announcements Feed** (`/tenant/announcements`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Profile Details** (`/tenant/profile`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Co-Occupants Management** (`/tenant/profile`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Move-Out Notice** (`/tenant/profile`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |
| **Tenant Portal: Notifications Tray** (`/tenant/*`) | `DENY` | `DENY` | `DENY` | `ALLOW` | `DENY` |

---

## Enforcement Architecture

1. **Frontend Route Guards**: `OwnerAuthGuard` and `TenantAuthGuard` in `src/router/guards.tsx` enforce role segregation at the browser routing layer.
2. **Frontend UI Adaptations**: `OwnerWorkspace` dynamically strips menu tabs and buttons not permitted for the active role (fail-closed model).
3. **Backend Middleware**: `server/src/middleware/auth.middleware.ts` and `role.middleware.ts` validate session cookies and verify role permissions on every API request.
