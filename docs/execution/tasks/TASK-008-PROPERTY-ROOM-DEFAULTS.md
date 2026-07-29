# TASK-008 — Dormitory, Building, Room & Defaults

สถานะเริ่มต้น: `LOCKED UNTIL TASK-007 PASS`  
Gate: `G7`  
Prerequisite: TASK-007 PASS

## เป้าหมาย

ทำให้ข้อมูล Dormitory → Building → Room ถูกต้อง สร้างจาก onboarding ได้ และ default ราคาไม่แก้ snapshot ของสัญญาเดิม

## ขั้นตอน

1. บังคับทุก room มี building
2. unique normalized room number ต่อ building
3. ไหล default ค่าเช่า/บริการ/มัดจำจาก Dormitory → Building → Room
4. เปลี่ยน default มีผลเฉพาะห้องที่ไม่มี Active Contract
5. สร้าง Contract snapshot ณ เวลาอนุมัติ
6. เพิ่ม optimistic concurrency/version check ในแก้ข้อมูล
7. แสดง error ภาษาไทยเมื่อ duplicate/invalid

## Tests

- duplicate room ใน building เดียวกัน
- same room number ต่าง building
- default propagation และ override
- change default ไม่เปลี่ยน active contract
- concurrent edit/retry
- Owner/Tenant เห็น room/contract ที่เชื่อม ID เดียวกัน

## Acceptance Criteria

- migration constraint และ API validation สอดคล้องกัน
- room availability รวม future reservation ถูกต้อง
- UI/API ไม่มี `buildingId?` ใน path ที่ต้อง required
- audit ของ create/update/default ครบ

## Next

เปิด TASK-009 เมื่อ property/default/snapshot tests ผ่าน
