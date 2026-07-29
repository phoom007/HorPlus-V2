# Execution 05 — Data, Migration และ Recovery Contract

## หลักการ

Prisma schema ไม่เท่ากับ migration ที่ deploy แล้ว Agent ต้องพิสูจน์ทั้ง fresh database และฐานข้อมูลที่มีข้อมูลเดิม

## Migration lifecycle

1. ตรวจ schema, migration history และ production-like snapshot
2. เพิ่ม migration ใหม่แบบ forward-only ที่มีชื่อสื่อความหมาย
3. backfill ใน transaction/batch พร้อม count ก่อนและหลัง
4. เพิ่ม constraint/index หลัง backfill ผ่าน
5. รัน `prisma migrate deploy` บน fresh DB และ upgrade DB
6. ทดสอบ application regression และ RLS
7. มี rollback/recovery procedure ที่ไม่ทำลายข้อมูล

## กฎข้อมูลที่ต้อง enforce

- `Room.buildingId` required; room number unique ต่อ Building
- role มีเพียง `OWNER`, `MANAGER`, `TECH`
- staff account รวมทุก role ไม่เกิน 10 ต่อหอพัก
- Free 10 ห้อง/30 LINE push ต่อเดือน; Paid 150 ห้อง/300 push
- package price เป็น total VAT-inclusive ตาม duration ไม่ใช่ monthly price
- Contract เก็บ snapshot ของราคา/เงื่อนไข
- Draft bill ไม่แสดงแก่ Tenant จนกว่าจะ Issue
- RLS/query scope ใช้ `dormitory_id`

## Acceptance Criteria

- fresh migration ผ่าน
- upgrade จาก baseline ผ่านและมี reconciliation report
- backfill count ตรงกับ source
- duplicate/invalid rows ถูกหยุดก่อน constraint
- reset/reseed demo ทำซ้ำได้โดยไม่ค้างข้อมูลข้าม run
- migration failure มีขั้นตอนกู้คืนและหลักฐาน
