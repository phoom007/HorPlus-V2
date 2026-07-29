# HorPlus-V2 Production Blueprint — Consolidated Entry

Version: `2026-07-25 / FINAL-LOCK-A`

ไฟล์นี้เป็นจุดเริ่มต้นแบบรวมสำหรับ AI agent เนื้อหารายละเอียด authoritative อยู่ในไฟล์ย่อย เพื่อป้องกันสำเนาขัดกัน

## Non-negotiable Decisions

- Free = 1 dormitory, 10 rooms, 30 LINE sends/month
- Paid = maximum 150 rooms/dormitory, 300 LINE sends/month
- 1/3/6/12/24 months = 189/529/999/1,799/2,999 THB total including VAT
- Trial 30 days; `HORPLUS` +60 days; default first 100 dormitories
- Paid-capable Google account maximum 10 dormitories, configurable by Developer
- OWNER/MANAGER/TECH only; all personnel accounts combined maximum 10/dormitory
- one role/user/dormitory
- Google for first Owner registration; LINE OA/LIFF afterward; Tenant LINE/LIFF only
- per-dormitory LINE OA
- every room belongs to a building; room number unique within building
- Dormitory→Building→Room defaults; active contract is immutable snapshot
- scheduled billing creates Draft; Tenant sees only Issued+
- separate Deposit bill; refundable or rent-credit; active contract may have outstanding deposit
- unpaid bill can be voided with reason/no hard delete; paid uses adjustment/refund
- Owner/Manager can override SlipOK only with reason
- Platform package activates only after verified SlipOK/Admin review
- LINE counts each successful recipient; Reply is free
- package expiry enters Restricted Mode immediately; no Grace Period
- Public Dormitory Directory/SEO deferred until core production readiness passes

## Reading and Execution Order

1. [`REQUIREMENTS-LOCK.md`](REQUIREMENTS-LOCK.md)
2. [`AI-AGENT-EXECUTION-RULES.md`](AI-AGENT-EXECUTION-RULES.md)
3. [`production-blueprint/01-CURRENT-STATE-AUDIT.md`](production-blueprint/01-CURRENT-STATE-AUDIT.md)
4. [`production-blueprint/15-IMPLEMENTATION-ROADMAP.md`](production-blueprint/15-IMPLEMENTATION-ROADMAP.md)
5. Domain file from the map below
6. [`production-blueprint/13-TESTING-STRATEGY.md`](production-blueprint/13-TESTING-STRATEGY.md)
7. [`production-blueprint/19-BLUEPRINT-CONSISTENCY-AUDIT.md`](production-blueprint/19-BLUEPRINT-CONSISTENCY-AUDIT.md)

## Domain Map

| Topic | Authoritative file |
|---|---|
| Overview | `production-blueprint/00-EXECUTIVE-SUMMARY.md` |
| Current code gaps | `production-blueprint/01-CURRENT-STATE-AUDIT.md` |
| Architecture | `production-blueprint/02-TARGET-ARCHITECTURE.md` |
| Data model | `production-blueprint/03-DOMAIN-AND-DATA-MODEL.md` |
| Roles/RLS | `production-blueprint/04-MULTI-TENANCY-AND-AUTHORIZATION.md` |
| Auth/session | `production-blueprint/05-AUTHENTICATION-SESSION-SECURITY.md` |
| Package/trial | `production-blueprint/06-SUBSCRIPTION-TRIAL-ENTITLEMENT.md` |
| Billing/payment/deposit | `production-blueprint/07-BILLING-PAYMENT-SLIPOK.md` |
| LINE/quota | `production-blueprint/08-LINE-MESSAGING-QUOTA.md` |
| API | `production-blueprint/09-API-CONTRACTS.md` |
| Files | `production-blueprint/10-FILE-STORAGE-AND-DOCUMENTS.md` |
| Audit/monitoring | `production-blueprint/11-AUDIT-LOG-OBSERVABILITY.md` |
| Migration | `production-blueprint/12-DATA-MIGRATION-PLAN.md` |
| Tests | `production-blueprint/13-TESTING-STRATEGY.md` |
| Deploy/ops | `production-blueprint/14-DEPLOYMENT-OPERATIONS.md` |
| Roadmap | `production-blueprint/15-IMPLEMENTATION-ROADMAP.md` |
| Decisions/risks | `production-blueprint/16-DECISION-REGISTER.md`, `17-RISK-REGISTER.md` |
| Locked architecture | `production-blueprint/18-ARCHITECTURE-DECISION-LOCK.md` |
| Consistency | `production-blueprint/19-BLUEPRINT-CONSISTENCY-AUDIT.md` |
| Routes/onboarding | `production-blueprint/20-PRODUCTION-ROUTING-AND-ONBOARDING.md` |
| Security release gate | `security/SECURITY-CONTRACTS.md` |
| Frontend/API gaps | `integration/FRONTEND-BACKEND-INTEGRATION-MAP.md` |
| Real LINE/SlipOK staging | `integrations/LINE-OA-LIFF-EXTERNAL-COMPLETION-NOTES.md` |

## Current Repository Warning

Repository code still contains legacy gaps such as FINANCE/STAFF role comments, nullable `Room.buildingId`, dorm-wide room uniqueness, duration-insensitive `monthlyPrice`, default 300 messages for all plans and incomplete migrations. Treat these as Roadmap tasks. Do not modify the Product Lock to match them.

Baseline verification on 25 July 2026: Frontend lint/build and 16/16 tests pass; Backend lint/build fail from service/repository/type contract mismatches, and Backend tests pass 88/92. Gate 0 requires fixing these existing failures before adding feature scope.

## Production Completion Gate

Production-ready requires:

- all Roadmap Gates 0–11 passed
- external PostgreSQL/RLS/Redis tests passed
- real staging LINE/LIFF/SlipOK/storage tests passed
- migration+backup restore verified
- no unresolved P0/P1
- owner-approved release review
