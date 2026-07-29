# Execution 13 — Rollback & Recovery

## ระดับการกู้คืน

| เหตุการณ์ | วิธีรับมือ |
|---|---|
| code change ผิด | หยุด server, เก็บ log/request ID, revert เฉพาะ commit ตามคำสั่งเจ้าของ |
| migration fail ก่อน commit | แก้ migration หรือ restore snapshot; ห้ามแก้ production DB ด้วยมือแบบไร้บันทึก |
| migration ผ่านแต่ data ผิด | ใช้ compensating migration/reconciliation; ห้าม drop table เพื่อแก้เร็ว |
| seed/demo เสีย | reset local volume ที่ระบุชัด แล้ว migrate/seed ใหม่ |
| external timeout | idempotency + retry/backoff; ไม่สร้าง payment/receipt ซ้ำ |
| cross-portal mismatch | mark flow blocked, ตรวจ source DB/audit ก่อนแก้ UI |

## สิ่งที่ต้องเก็บก่อนแก้

- commit SHA
- migration status
- database backup/snapshot identifier
- test output
- request ID และ audit ID
- รายการ record ที่ได้รับผลกระทบ

## Acceptance Criteria

- ทุก Task ที่แตะ schema มี recovery note
- มีวิธีหยุดซ้ำ/duplicate request โดยไม่เกิดข้อมูลซ้ำ
- ไม่ใช้ destructive command กับฐานข้อมูลจริง
- recovery ถูกทดสอบใน local ก่อนประกาศ PASS
