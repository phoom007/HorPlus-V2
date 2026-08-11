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
| **LINE OA Settings (`settings.tsx`)** | Removed `seedDatabase` import from `mockData.ts` and editable `Channel Access Token` input field. | Editable Channel ID & Channel Secret; read-only metadata fields per Section 13 contract. |

## Verification Gates
1. **Architectural Gate (`productionTruthBoundary.test.ts`)**: Asserts 0 `mockData` imports in runtime paths, 0 external payment generation URLs, and `getDataMode() === 'api'`.
2. **Acceptance E2E Suite (`wave0-production-truth.spec.ts`)**: Verifies zero states, route guard decommission, empty DB behavior, and subscription catalog error handling in real browser execution.
