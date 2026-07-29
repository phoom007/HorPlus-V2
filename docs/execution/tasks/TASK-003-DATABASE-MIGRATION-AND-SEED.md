# TASK-003 — Database Migration & Demo Seed

สถานะเริ่มต้น: `LOCKED UNTIL TASK-002 PASS`  
Gate: `G2`  
Prerequisite: TASK-002 PASS

## เป้าหมาย

ทำให้ Prisma schema, migration history และ demo dataset ใช้งานจริงบน PostgreSQL local ได้ทั้ง fresh DB และ upgrade DB

## ขั้นตอน

1. เปรียบเทียบ `server/prisma/schema.prisma` กับ migration ที่ deploy จริง
2. สร้าง migration สำหรับ identity/property/tenant/contract/meter/billing/payment/receipt/LINE/audit ที่ยังขาด
3. backfill `buildingId`, normalize role, room unique key และ plan/quota constants
4. เพิ่ม constraints/index/RLS ตาม blueprint
5. สร้าง seed ตาม `../06-DEMO-SEED-CONTRACT.md`
6. รันทดสอบ fresh DB และ DB ที่มี baseline data
7. บันทึก row counts/reconciliation และ recovery procedure

## Commands

```bash
npm --prefix server run prisma:validate
npm --prefix server run prisma:generate
npm --prefix server run prisma:migrate:deploy
```

เพิ่ม script seed/reset ได้ถ้าจำเป็น แต่ต้องระบุผลกระทบต่อ local volume

## Tests

- fresh migration
- upgrade migration จาก baseline
- reset + seed ซ้ำ
- duplicate room/building constraint
- RLS/query scope smoke
- decimal/rounding และ nullability

## Acceptance Criteria

- migration history ครบกับ schema ที่ application ใช้
- `Room.buildingId` required หลัง backfill
- room number ซ้ำได้ต่าง building แต่ซ้ำใน building เดียวกันไม่ได้
- role/plan/quota เป็นค่าตาม Requirements Lock
- demo Dormitory A/B แยกข้อมูลได้
- migration fail มี recovery note และไม่ลบข้อมูลเงียบ ๆ

## Next

เปิด TASK-004 เมื่อ fresh/upgrade/seed/RLS smoke ผ่าน

## หยุดถาม

ถ้ามีข้อมูลเดิมที่ map ไม่ได้หรือ migration ต้องลบข้อมูล ให้หยุดถามก่อนดำเนินการ
