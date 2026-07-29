# Execution 02 — Gate Protocol

## สถานะที่อนุญาต

| สถานะ | ความหมาย | ผลต่อ Task ถัดไป |
|---|---|---|
| `PASS` | Acceptance Criteria ครบและมีหลักฐาน | เปิดได้ตาม roadmap |
| `PARTIAL` | ทำบางส่วน แต่ยังมีข้อค้างที่ไม่ใช่ blocker | ห้ามเปิด Task ถัดไป เว้นแต่เจ้าของสั่ง |
| `BLOCKED` | ติดสิทธิ์, decision, environment หรือ defect สำคัญ | หยุดและรายงานสิ่งที่ต้องตัดสินใจ |
| `FAIL` | ทดสอบแล้วไม่ผ่าน | แก้ใน Task เดิม |
| `EXTERNAL VERIFICATION REQUIRED` | AI Studio รันไม่ได้ ต้องทดสอบภายนอก | ยังไม่ใช่ PASS |

## ขั้นตอนก่อนประกาศ PASS

1. ตรวจไฟล์ที่เปลี่ยนและ migration ที่เกี่ยวข้อง
2. รันคำสั่งใน Task ตามลำดับ
3. รัน regression ของ Gate ก่อนหน้า
4. รัน happy path, error path, permission, cross-dorm, duplicate/retry
5. ตรวจ Owner Portal และ Tenant Portal จากข้อมูลกลางเดียวกัน
6. บันทึกผลใน `12-TEST-EVIDENCE-HANDOFF.md`
7. อัปเดต `11-DEFECT-REGISTER.md` และ Current State หากมี gap

## Quality gates บังคับ

### Technical

- TypeScript/lint/build ผ่านตามขอบเขต
- ไม่มี test ถูกปิด/skip เพื่อให้ผ่าน
- migration ทำซ้ำหรือมี recovery ที่ทดสอบแล้ว
- error response ใช้ envelope เดียวกัน

### Security

- actor, dormitory context, permission และ state transition ตรวจที่ server
- ไม่มี client-trusted price, role, quota, tenantId หรือ dormitoryId
- mutation ที่สำคัญมี idempotency และ audit
- cross-dorm read/write เป็น negative test

### Cross-Portal

- mutation ฝั่ง Owner สะท้อนฝั่ง Tenant ภายใน API read ใหม่/refresh ตาม contract
- mutation ฝั่ง Tenant สะท้อนฝั่ง Owner โดยไม่ต้องแก้ข้อมูลซ้ำ
- ID, amount, status, timestamps และ audit reference ตรงกัน
- กดซ้ำหรือเปิดสอง tab ไม่สร้างรายการซ้ำ

## Handoff ขั้นต่ำ

```text
Task:
Status:
Commit:
Changed files:
Migration/seed:
Commands:
Automated tests:
Manual/cross-portal tests:
External tests not run:
Security checks:
Known defects:
Rollback:
Next task:
```
