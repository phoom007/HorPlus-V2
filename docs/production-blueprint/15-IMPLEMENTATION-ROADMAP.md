> [!WARNING]
> **[STATUS: SUPERSEDED]**
> This document is entirely superseded. Always refer to **[21-CURRENT-PRODUCT-RULE-LOCK.md](./21-CURRENT-PRODUCT-RULE-LOCK.md)** as the absolute source of truth.

# 15. Implementation Roadmap

ทำตามลำดับนี้ ห้ามเริ่ม Public Dormitory/SEO ก่อน Gate 10 ผ่าน

> เอกสารนี้เป็นภาพรวม Production Blueprint เดิม ส่วนลำดับลงมือทำที่ละเอียดกว่าและมี Gate ต่อ Task ให้ใช้ `../execution/01-MASTER-EXECUTION-ROADMAP.md` และ `../execution/tasks/TASK-001-REPOSITORY-AUDIT.md` ถึง `TASK-018-PRODUCTION-READINESS.md` เป็นตัวควบคุมหลัก

## Gate 0 — Freeze and Baseline

งาน:

- ติดตั้งเอกสารชุดนี้แทน `/docs`
- freeze statuses/role/price constants
- แก้ Backend compile contract ให้ `lint:api` และ `build:api` ผ่าน
- แก้ Backend tests ที่ล้ม 4 เคสให้ครบ 92/92
- รักษา Frontend lint/build และ 16/16 tests ให้ผ่าน
- สร้าง gap report จาก Current State

ผ่านเมื่อ: ไม่มีข้อกำหนดเก่าที่ agent ใช้เป็น source และทั้ง Frontend/Backend lint/build/unit test ผ่าน

## Gate 1 — Schema and Migration Foundation

งาน:

- migration parity กับ Prisma
- role normalization
- building required/unique room per dormitory
- duration package model
- deposit/installment/bill states

ผ่านเมื่อ: fresh DB + clone migration + data reconciliation ผ่าน

## Gate 2 — Unified Identity, Session and RLS

งาน:

- Google bootstrap Owner
- LINE LIFF role/tenant session
- transaction-scoped RLS
- CSRF/rate limit/recovery

ผ่านเมื่อ: cross-dorm/role/replay tests ผ่าน

## Gate 3 — Dormitory Onboarding and Entitlement

งาน:

- registration main menu
- first dorm direct/second selector
- Free/Paid limits
- trial/promo 100
- immediate expiry restricted

ผ่านเมื่อ: price/room/dorm/promo boundary tests ผ่าน

## Gate 4 — Property and Defaults

งาน:

- dorm/building/room defaults
- copy/override/apply to no-active-contract rooms
- room required building
- responsive UI/API adapter

ผ่านเมื่อ: duplicate and snapshot scenarios ผ่าน

## Gate 5 — Membership and LINE OA Setup

งาน:

- 3 roles
- 10 total account limit
- invitation 7 days
- per-dorm OA connect now/later
- recovery

ผ่านเมื่อ: concurrency limit/permission/secret tests ผ่าน

## Gate 6 — Tenant Registration and Contract

งาน:

- permanent LINE registration
- owner-created tenant
- required docs/rules/co-tenant
- signature evidence
- approve/edit/reject/resubmit
- future reservation

ผ่านเมื่อ: two-applicant race + approval E2E ผ่าน

## Gate 7 — Meter, Draft and Issued Billing

งาน:

- cycle/rate snapshot
- meter/replacement
- auto Draft
- issue/void/revert unissued
- installment/deposit bills

ผ่านเมื่อ: Tenant visibility, rounding, retry tests ผ่าน

## Gate 8 — Payment, SlipOK and Receipt

งาน:

- cash/transfer
- private slip upload
- duplicate guard
- SlipOK + manual override
- receipt idempotency
- adjustment/refund

ผ่านเมื่อ: concurrent approval/domain-separation tests ผ่าน

## Gate 9 — LINE Messaging, Maintenance and Announcement

งาน:

- outbox/delivery/quota 30/300
- reset Bangkok
- notification triggers
- maintenance assignment for Tech
- announcement audience

ผ่านเมื่อ: mixed delivery/quota/role tests ผ่าน

## Gate 10 — Package Payment, Move-out and Full Regression

งาน:

- platform invoice/payment/SlipOK activation
- expiry/restricted
- move-out/final settlement/revoke binding
- full audit/observability
- mobile/iPad/desktop/LINE WebView

ผ่านเมื่อ: System Definition of Done ใน README ครบ

## Gate 11 — External Production Readiness

- real staging Google/LINE/SlipOK/storage
- load/concurrency/backup/restore/security test
- runbooks/alerts
- launch review

## Deferred Gate

หลัง Gate 11 เท่านั้น:

- Public Dormitory Directory
- SEO/Website Builder
- quota top-up
- additional payment gateway/developer ecosystem

## Task Handoff Rule

แต่ละ Gate แยก PR/agent task ได้ แต่ห้ามประกาศผ่านโดยดู UI อย่างเดียว ต้องอ้าง command/test/evidence และ mark สิ่งที่รันไม่ได้

