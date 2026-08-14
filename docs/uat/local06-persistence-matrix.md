# HorPlus Persistence Matrix (LOCAL-06)

This document establishes the persistence boundaries, storage engines, and lifecycle behavior across all domains and entities in the HorPlus local application.

---

## Domain Persistence Architecture

| Domain / Entity | PostgreSQL Authoritative? | Database Table(s) | F5 Browser Reload Behavior | New Browser Window / Context Behavior | Logout / Login Behavior | Server Process Restart Behavior | Scope & Status |
|---|---|---|---|---|---|---|---|
| **Users & Authentication** | `YES` | `users`, `sessions` | Fully Persisted | Fully Persisted (via cookie) | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Dormitory Profiles** | `YES` | `dormitories` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Buildings & Floors** | `YES` | `buildings` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Rooms & Properties** | `YES` | `rooms` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Tenants & Profiles** | `YES` | `tenants` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Co-Occupants** | `YES` | `tenant_co_occupants` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Vehicles & Emergencies** | `YES` | `tenant_vehicles`, `tenant_emergency_contacts` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Contracts & Snapshots** | `YES` | `contracts`, `contract_snapshots` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Contract Renewals** | `YES` | `contract_renewal_requests` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Move-Out & Settlements** | `YES` | `tenant_move_out_requests`, `settlements` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Billing Cycles** | `YES` | `billing_cycles` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Rate Snapshots & Defaults** | `YES` | `dormitory_billing_settings`, `billing_rate_snapshots` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Meter Devices & Readings** | `YES` | `meter_devices`, `meter_readings`, `meter_replacements` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Bills & Bill Items** | `YES` | `bills`, `bill_items` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Payments & Slips** | `YES` | `payments`, `payment_upload_intents` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Receipts & Sequences** | `YES` | `receipts`, `receipt_sequences` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Staff Grants & LINE Friends** | `YES` | `staff_access_grants`, `line_friends` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Subscriptions & Promos** | `YES` | `platform_subscriptions`, `dormitory_subscriptions`, `promo_redemptions` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Owner Digital Signatures** | `YES` | `owner_signatures` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Tenant Registration Requests** | `YES` | `tenant_registration_requests` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **In-App Notifications** | `YES` | `notifications` | Fully Persisted | Fully Persisted | Fully Persisted | Fully Persisted | IN_SCOPE (PASS) |
| **Maintenance / Repairs** | `NO` (Approved In-Memory) | In-Memory Queue | In-Memory Preserved | In-Memory Preserved | In-Memory Preserved | Resets to Baseline | IN_SCOPE (PASS - In-Memory Domain) |
| **Announcements / Broadcasts** | `NO` (Approved In-Memory) | In-Memory Queue | In-Memory Preserved | In-Memory Preserved | In-Memory Preserved | Resets to Baseline | IN_SCOPE (PASS - In-Memory Domain) |

---

## Data Safety Rules

1. **PostgreSQL Target**: All database mutations connect strictly to `127.0.0.1:5455`, database `horplus_wave1d_fasttrack_test`.
2. **In-Memory Domains**: Maintenance & Announcements are formally recognized as In-Memory per approved product boundary (no claim of server-restart persistence).
3. **Zero Phantom State**: All financial, property, tenant, and contract operations are backed by relational foreign keys with cascade safety.
