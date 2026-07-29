# AI Agent Execution Rules

ใช้กฎนี้ทุกครั้งที่มอบหมายงานจาก Blueprint ให้ AI Studio หรือ Coding Agent

## 0. โหมดการทำงานที่ล็อกไว้

HorPlus ใช้ **Hybrid Execution**:

1. เสถียรฐานระบบและ localhost แบบเรียงลำดับ
2. ทำ Business Flow แบบ Vertical Slice ให้จบทั้ง Database → API → Permission → UI → Test
3. ปิดท้ายด้วย Cross-Portal, Security, UAT และ Production Readiness

ห้ามเริ่ม Vertical Slice ก่อน Gate ที่เป็น prerequisite ผ่าน และห้ามทำหลาย Task ที่อยู่คนละ Gate พร้อมกันโดยไม่มีคำสั่งจากเจ้าของผลิตภัณฑ์

## 1. ก่อนเริ่ม

Agent ต้อง:

1. อ่าน `REQUIREMENTS-LOCK.md`
2. อ่าน Current State, Roadmap และเอกสาร Domain ของงาน
3. ตรวจโค้ดจริงก่อนสรุปว่า Feature ไม่มีหรือมีแล้ว
4. แสดง Scope, Files affected, Migration และ Test plan แบบสั้น
5. ถ้าพบ Product Decision ใหม่ที่เปลี่ยนราคา สิทธิ์ เงิน ข้อมูล หรือ Flow ให้หยุดถาม ห้ามเดา
6. อ่าน `execution/02-GATE-PROTOCOL.md` และ `execution/07-CROSS-PORTAL-CONSISTENCY-CONTRACT.md` ทุกครั้งที่เริ่มรอบงานใหม่

## 2. ขอบเขตต่อหนึ่งงาน

- ทำหนึ่ง Domain Slice ให้จบตั้งแต่ Schema → Repository → Service → Route → Frontend Adapter → UI → Test
- ห้ามแก้ Public Website/SEO จน Roadmap Core Phase ผ่าน
- ห้ามผูก UI กับ Prisma/Database โดยตรง
- ห้ามใช้ Mock เป็นผลลัพธ์ Production แต่ Demo Mode ต้องยังทำงานแยกได้
- ห้ามลบ Compatibility Adapter จน Production API ผ่าน regression
- Owner Portal และ Tenant Portal ห้ามมี business rule สำคัญซ้ำกันคนละชุด
- ห้ามให้ `localStorage`, mock หรือค่าจาก URL เป็นแหล่งข้อมูลจริงใน Production path

## 3. Security Gate

ทุก Mutation ต้องตอบได้ครบ:

- Actor คือใครและยืนยันอย่างไร
- Dormitory มาจากไหน
- Permission ใดอนุญาต
- State transition เดิม→ใหม่ถูกหรือไม่
- Idempotency/retry ทำอย่างไร
- Audit event ใดถูกบันทึก
- มีข้อมูลอ่อนไหวหรือไฟล์ใดต้องเข้ารหัส/จำกัด URL

## 3.1 Cross-Portal Mutation Contract

ก่อนปิด mutation ใด ๆ ต้องระบุใน handoff:

- ข้อมูลกลาง/ID ที่ถูกเปลี่ยน
- state transition เดิม → ใหม่
- สิ่งที่ Owner เห็นหลัง mutation
- สิ่งที่ Tenant เห็นหลัง mutation
- audit event และ notification ที่เกิดขึ้น
- พฤติกรรมเมื่อกดซ้ำ, timeout หรือเปิดสองหน้า

## 4. Verification Levels

| ระดับ | สิ่งที่ต้องรัน | รายงาน |
|---|---|---|
| AI Studio | TypeScript lint, build, unit test, static review, demo regression | PASS/FAIL พร้อมคำสั่ง |
| External Local | Docker Compose, PostgreSQL migration, Redis, API integration, RLS test | PASS/FAIL หรือ `EXTERNAL VERIFICATION REQUIRED` |
| Staging | Google/LINE/SlipOK Credential, Webhook, signed file, concurrency, backup | PASS/FAIL พร้อมหลักฐานแบบไม่เปิด Secret |

AI Studio ที่รัน Docker ไม่ได้ ห้ามรายงานว่าผ่าน PostgreSQL/Redis/RLS จริง

## 5. Definition of Done ต่อ Task

- Acceptance Criteria ในเอกสาร Domain ผ่าน
- ไม่มีข้อมูลเก่ากลับมา: FINANCE/STAFF role, Tenant Google Login, Shared OA, 7-day grace, old plan room tiers
- Migration reversible หรือมี recovery procedure
- Error message ภาษาไทยเข้าใจง่ายและไม่เปิด internal detail
- Test ครอบคลุม happy path, unauthorized, cross-dorm, duplicate/retry และ boundary
- อัปเดต Integration Map/Current State หาก endpoint หรือสถานะเปลี่ยน
- อัปเดต `execution/08-CROSS-PORTAL-STATE-MATRIX.md` และ `execution/09-CROSS-PORTAL-E2E-MATRIX.md` เมื่อ flow หรือ state เปลี่ยน

## 6. Handoff Template

```text
Task:
Status: PASS | PARTIAL | BLOCKED
Changed:
Migrations:
Tests executed:
Tests not executed:
Security checks:
Known gaps:
Next task:
```
