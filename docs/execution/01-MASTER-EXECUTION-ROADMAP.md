# Execution 01 — Master Execution Roadmap

## หลักการ

ทุก Task มีวงจรเดียวกัน:

```text
Inspect → Plan → Change → Migrate/Seed → Test → Cross-Portal Check → Evidence → Gate Decision
```

Agent ทำได้ครั้งละหนึ่ง Task และห้ามเปิด Task ถัดไปจนกว่า Acceptance Criteria ของ Task ปัจจุบันจะผ่านครบ

## Roadmap ตั้งแต่เริ่มจนจบ

| ลำดับ | Task | ขอบเขต | Gate ที่ต้องผ่านก่อน | เปิดถัดไปเมื่อ |
|---:|---|---|---|---|
| 1 | TASK-001 | repository audit, baseline, defect register | ไม่มี | baseline ถูกบันทึกและทำซ้ำได้ |
| 2 | TASK-002 | ports, env, Docker, health checks | 001 | Web/API/DB/Redis พร้อมกัน |
| 3 | TASK-003 | Prisma migration, backfill, demo seed | 002 | fresh/upgrade/reset ผ่าน |
| 4 | TASK-004 | backend TypeScript/repository/service contracts | 003 | API lint/build/test ผ่าน |
| 5 | TASK-005 | frontend ↔ API adapter, shared state/status | 004 | production path ไม่มี split-brain |
| 6 | TASK-006 | Google bootstrap, LINE session, permission, RLS | 005 | negative isolation tests ผ่าน |
| 7 | TASK-007 | owner onboarding, package/trial/promo | 006 | entitlement boundary ผ่าน |
| 8 | TASK-008 | dorm/building/room/default/snapshot | 007 | duplicate/default tests ผ่าน |
| 9 | TASK-009 | staff roles, account cap, OA connect/recovery | 008 | concurrency and secret tests ผ่าน |
| 10 | TASK-010 | tenant registration, documents, signature, contract | 009 | approval and race tests ผ่าน |
| 11 | TASK-011 | meter, billing cycle, draft/issue/void | 010 | owner↔tenant bill parity ผ่าน |
| 12 | TASK-012 | payments, SlipOK adapter, receipt | 011 | idempotency and override ผ่าน |
| 13 | TASK-013 | LINE outbox/quota, maintenance, announcement | 012 | delivery/quota/role tests ผ่าน |
| 14 | TASK-014 | move-out, final settlement, expiry/restricted | 013 | access revocation and finance tests ผ่าน |
| 15 | TASK-015 | full cross-portal release candidate | 014 | journey matrix ผ่านครบ |
| 16 | TASK-016 | security and resilience hardening | 015 | no P0/P1 security defect |
| 17 | TASK-017 | local UAT, responsive/browser regression | 016 | UAT sign-off evidence ครบ |
| 18 | TASK-018 | production readiness and Go/No-Go | 017 | launch decision พร้อมหลักฐาน |

## Stage Mapping

### Stage A — Foundation (Tasks 001–006)

ห้ามทำ business feature ใหม่จนกว่าจะเปิดระบบ local และ Backend contract ผ่าน

### Stage B — Vertical Slices (Tasks 007–014)

แต่ละ Task ต้องจบทั้ง schema/API/permission/UI/test และต้องตรวจ cross-portal

### Stage C — Release Confidence (Tasks 015–018)

ทดสอบเส้นทางจริง ความผิดพลาด ความปลอดภัย UAT และความพร้อมสำหรับ production

## ห้ามข้าม

- ห้ามทำ Public Directory/SEO/Website Builder ก่อน Task 018
- ห้ามเปลี่ยนราคา, quota, role, account cap, auth หรือ state เพราะแก้ test ง่ายขึ้น
- ห้ามแยก Owner และ Tenant ไปใช้ mock store คนละชุดใน production path
- ห้ามนับ external integration ว่าผ่านจาก mock เพียงอย่างเดียว
