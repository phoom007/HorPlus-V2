# Wave 0 Production Truth Audit & Route Matrix

## Executive Summary
This document records the absolute closure of Wave 0 Production Truth Boundaries across HorPlus. All prototype mocks, synthetic UI fallbacks, manufactured readings, hardcoded rates, and fake demo authority have been completely decommissioned.

## Complete Route & Navigation Audit Matrix

| Route/Menu | Old Fake/Demo Dependency | Action Taken | Authoritative Source | Remaining Functional Gap | Assigned Closure Wave | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/owner/dashboard` | Hardcoded 90 remaining days, fake QR URLs, synthetic stepper count. | Integrated `/api/v1/subscription/entitlements`, set initial `remainingDays` to `null`, derived stepper metrics strictly from DB `Bill` records. | `/api/v1/subscription/entitlements` & DB | Subscription payment gateway checkout | Wave 1 | `TRUTH-SAFE` |
| `/owner/rooms` | Mock room fallbacks | Bound directly to DB with optimistic concurrency locking. | Property & Room API | Bulk room CSV import | Wave 1 | `FUNCTIONAL` |
| `/owner/tenants` | Sample tenant records ("สมชาย", "สมศรี") | Purged mock imports, rendered clean zero-state when database is empty. | Tenant API | OCR ID card auto-fill | Wave 1 | `FUNCTIONAL-GAP` |
| `/owner/contracts` | Sample contract records | Purged mock imports, bound to server contract lifecycle. | Contract API | Digital e-signature execution | Wave 1 | `FUNCTIONAL-GAP` |
| `/owner/meters` | Manufactured readings (+8/+120), Math.random autofill, `meters_state_*` cache, 18/7/200/100 rate fallbacks | Purged all synthetic readings, removed `meters_state_*` reads, scoped unsaved inputs to local `meters_form_draft_${cycle}` key with explicit notice banner, fallback rates resolve to 0 / warning. | Server DB + `meters_form_draft_${cycle}` | Bulk meter reading CSV import | Wave 1 | `TRUTH-SAFE` |
| `/owner/issue-bills` | Synthetic frontend bill generation | Displayed truthful unavailable notice state on issue attempt. | Billing API | Automated backend PDF bill engine | Wave 1 | `TRUTH-SAFE` |
| `/owner/payments` | Fake slip verification & synthetic QR | Real operational slip verification & approval flow against DB. | Payment API & Billing API | Automatic bank webhook reconciliation | Wave 1 | `TRUTH-SAFE` |
| `/owner/maintenance` | Sample repair requests ("ก๊อกน้ำรั่ว") | Purged sample requests, rendered empty state when empty, handled API 500 cleanly. | Maintenance API | Technician dispatch workflow | Wave 1 | `TRUTH-SAFE` |
| `/owner/announcements` | Sample announcements ("แจ้งปิดปรับปรุง") | Purged sample announcements, rendered empty state, handled API 500 cleanly. | Announcement API | Push notifications via LINE OA | Wave 1 | `TRUTH-SAFE` |
| `/owner/reports` | Synthetic building A/B and 30/15 room count | Derived all financial metrics strictly from DB, zero-state when empty. | Financial DB | Export report to Excel/PDF | Wave 1 | `TRUTH-SAFE` |
| `/owner/settings` | Editable token/ID, fake dormitory defaults (`dorm-1`), fallback rates (18/7/200/100), no-op save | Limited editable fields to Channel ID/Secret, purged fake dormitory & rate fallbacks, hydrated from server defaults API, preserved valid 0 values and verified F5 persistence. | Dormitory Profile, Defaults API & LINE OA API | Live LINE webhook handling | Wave 1 | `TRUTH-SAFE` |
| `/owner/logs` | Sample audit log entries | Backed by DB activity logs. | Audit Log API | Audit log export & filtering | Wave 1 | `FUNCTIONAL` |
| `/tenant/login` | Auto-login redirect to `/demo` | Removed `/demo` redirect loop, restricted to server tenant auth. | Tenant Auth API | SMS OTP provider integration | Wave 1 | `TRUTH-SAFE` |
| `/tenant/register` | Fake registration flow | Validated registration backed by DB invitation code. | Tenant Auth API | Self-service invitation code lookup | Wave 1 | `FUNCTIONAL-GAP` |
| `/tenant/home` | Synthetic dashboard metrics | Clean initial states backed by tenant DB. | Tenant Portal API | Dynamic widget customizer | Wave 1 | `TRUTH-SAFE` |
| `/tenant/bills` | Sample tenant bills | Fetched real tenant bills, empty state when none exist. | Billing API | Online payment gateway redirect | Wave 1 | `TRUTH-SAFE` |
| `/tenant/maintenance` | Sample repair tickets | Wired form submission to server endpoint, fail-closed on non-2xx response; local preview labels file selected prior to upload. | Maintenance API | Tenant maintenance create persistence & photo upload | Wave 2 | `FUNCTIONAL-GAP` |
| `/tenant/utilities` | Sample March-July utility history | Purged hardcoded utility history chart fixtures and fake meter readings; renders truthful unavailable notice shell. | Tenant Portal API | Tenant utility history API | Wave 2 | `TRUTH-SAFE` / `FUNCTIONAL-GAP` |
| `/tenant/co-occupants` | Local state co-occupant editing | Disabled local mutations and fake success toasts; fails closed cleanly. | Tenant Portal API | Tenant co-occupant management persistence | Wave 2 | `TRUTH-SAFE` / `FUNCTIONAL-GAP` |
| `/tenant/move-out` | Unchecked POST & localStorage request authority | Fails closed on non-2xx server response; removed localStorage request authority and fake cancellation; verified via non-skipping E2E. | Tenant Move-Out API | Tenant move-out request submission & cancellation | Wave 2 | `TRUTH-SAFE` / `FUNCTIONAL-GAP` |
| `/tenant/announcements` | Sample tenant announcements | Clean zero state when no announcements. | Announcement API | Rich media announcements | Wave 1 | `TRUTH-SAFE` |
| `/tenant/parcels` | Sample parcel tracking | Backed by parcel API with clean zero state. | Parcel API | Barcode scanner integration | Wave 1 | `TRUTH-SAFE` |
| `/tenant/profile` | Sample profile data | Fetched real tenant profile, removed hardcoded bank account fallback, contract PDF generated from snapshot/billing DB without 18/7/101 defaults. | Tenant Profile API & Contract PDF API | LINE account linking | Wave 1 | `TRUTH-SAFE` |

## Verification Gates
1. **Architectural Gate (`src/tests/productionTruthBoundary.test.ts`)**: Asserts 0 `mockData` imports in runtime paths, `getDataMode() === 'api'`, 0 forbidden external QR URLs, 0 `meters_state_*` / numeric rate fallbacks in `meters.tsx`, 0 reset demo data in `settings.tsx`, 0 `demoHasRoom` or `A-101` in `tenant.tsx`, and 0 hardcoded 18/7/101/25/5 defaults in server contract PDF route.
2. **Acceptance E2E Suite (`tests/e2e/wave0-production-truth.spec.ts`)**: Verifies zero states across all 7 main owner routes, route guard decommission, empty DB behavior, authenticated owner meters draft banner, non-skipping tenant move-out API 500 failure behavior, truthful tenant utilities view, and authoritative tenant contract PDF output in real browser execution.
