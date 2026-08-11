# Wave 0 Production Truth Audit Document

## Executive Summary
This document summarizes the audit and decommissioning of non-authoritative fallback data, prototype mocks, and synthetic UI authority across HorPlus.

## Audit Matrix

| Domain / Subsystem | Prototype / Demo Behavior Removed | Authoritative Operational Truth |
| :--- | :--- | :--- |
| **Data Mode (`dataMode.ts`)** | Removed `local` fallback, runtime mode switching, and localStorage mutation. | `getDataMode()` strictly returns `'api'` unconditionally. |
| **Routing & Guards (`guards.tsx`, `App.tsx`)** | Removed `/tenant/login` -> `/demo` redirect, `getDemoSession` fallback, SaaS token auto-login simulation, and `/demo` portal in production. | Unauthenticated access redirects to `/`. `/demo` disabled in normal production runtime. |
| **Subscription Catalog (`dashboard.tsx`)** | Removed hardcoded 189 THB price authority, fake PromptPay QR (`api.qrserver.com`), PromptPay phone `0935098808`, and synthetic timer verification. | Subscription catalog and pricing consumed dynamically from `/api/v1/subscription/entitlements`. Displays controlled unavailable error state on loading failure. |
| **Meters (`meters.tsx`)** | Removed manufactured `+ 8` water and `+ 120` electricity unit additions when no prior bill exists. Removed `mockData.ts` imports. | New meter readings default to previous meter readings (or 0 if unread). Owner enters real starting value. |
| **Reports (`reports.tsx`)** | Removed manufactured `30`/`15` room count fallbacks and fake building options (`bld-a`, `bld-b`). | Total rooms and financial calculations strictly reflect database records. Renders empty states when data is zero. |
| **Tenant Portal (`tenant.tsx`)** | Removed `getContracts()`, `getMaintenance()`, `getAnnouncements()`, `getBuildings()` mock imports. | Non-payment sections initialize to clean `[]` empty arrays when un-backed by backend APIs. |
| **LINE OA Settings (`settings.tsx`)** | Removed `seedDatabase` import from `mockData.ts` and editable `Channel Access Token` / `Basic ID` fields. | Editable Channel ID & Channel Secret; read-only metadata fields per Section 13 contract. |

## Complete Route & Navigation Menu Audit Matrix

| Route Path | Navigation Menu | Required Auth Role | Data Authority & Source | Wave 0 Production Truth Enforcement |
| :--- | :--- | :--- | :--- | :--- |
| `/` | Landing / Login | Public | Authentication API | Server-authoritative login; no automatic demo fallback. |
| `/demo` | Prototype Portal | Decommissioned | None | Decommissioned; redirects to `/` in production runtime. |
| `/tenant/login` | Tenant Login | Public | Tenant Auth API | Direct auth endpoint; no `/demo` redirect loop. |
| `/owner/dashboard` | Dashboard (ภาพรวม) | OWNER / STAFF | `/api/v1/subscription/entitlements` + Server DB | Entitlements dynamic from API; remainingDays initial state `null`. Stepper metrics derived strictly from server `Bill` state (no `meters_state_*` localStorage). |
| `/owner/meters` | Meters (จดมิเตอร์) | OWNER / STAFF | Server DB + `meters_form_draft_${cycle}` | No hardcoded rate authority (18/7/200/100). No `Math.random` autofill. Saves explicitly to local draft key with `(ร่างที่ยังไม่ได้บันทึกลงเซิร์ฟเวอร์)` notice banner. |
| `/owner/payments` | Payments (การชำระเงิน) | OWNER / STAFF | Payment API + Billing API | Real operational slip verification and approval lifecycle. |
| `/owner/rooms` | Rooms (ห้องพัก) | OWNER / STAFF | Property Defaults & Room API | Room management backed by DB and optimistic locking version controls. |
| `/owner/tenants` | Tenants (ผู้เช่า) | OWNER / STAFF | Tenant API | Tenant records backed by DB. |
| `/owner/contracts` | Contracts (สัญญาเช่า) | OWNER / STAFF | Contract API | Server-authoritative contract lifecycle. |
| `/owner/maintenance` | Maintenance (งานแจ้งซ่อม) | OWNER / STAFF | Maintenance API | Real maintenance requests without fake fallbacks. |
| `/owner/announcements`| Announcements (ประชาสัมพันธ์)| OWNER / STAFF | Announcement API | Real announcements. |
| `/owner/reports` | Reports (รายงานสถิติ) | OWNER / STAFF | Billing & Financial DB | Pure zero-state boundary when DB is empty; no fake buildings or artificial 30/15 room counts. |
| `/owner/users` | Staff Permissions (สิทธิ์และพนักงาน) | OWNER | User & Role API | Server-authoritative RBAC. |
| `/owner/settings` | Settings (ตั้งค่า) | OWNER | Dormitory Profile & Payment Settings API | Property/billing defaults with optimistic concurrency. LINE OA settings: Channel ID & Channel Secret editable; Basic ID & Channel Access Token NOT editable in UI. |

## Verification Gates
1. **Architectural Gate (`productionTruthBoundary.test.ts`)**: Asserts 0 `mockData` imports in runtime paths, 0 external payment generation URLs, and `getDataMode() === 'api'`.
2. **Acceptance E2E Suite (`wave0-production-truth.spec.ts`)**: Verifies zero states, route guard decommission, empty DB behavior, authenticated owner meters draft banner, and subscription catalog error handling in real browser execution.
