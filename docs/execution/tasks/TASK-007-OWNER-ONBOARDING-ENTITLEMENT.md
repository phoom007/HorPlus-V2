# TASK-007 — Owner Onboarding & Entitlement

สถานะเริ่มต้น: `LOCKED UNTIL TASK-006 PASS`  
Gate: `G6`  
Prerequisite: TASK-006 PASS

## เป้าหมาย

ทำให้ Owner ลงทะเบียนหอพักแรก/หอที่สองได้ถูกต้อง และ server บังคับ plan, room limit, dorm limit, trial และ promo

## Business rules

- Free: 1 หอ/Google Account, 10 ห้อง, 30 LINE push/เดือน
- Paid: รวมสูงสุด 10 หอ/Google Account, 150 ห้อง/หอ, 300 LINE push/เดือน
- packages: 1/3/6/12/24 เดือน รวม VAT `189/529/999/1,799/2,999`
- trial 30 วัน; `HORPLUS` เพิ่ม 60 วัน รวมสูงสุด 90 วัน
- expiry เข้า Restricted Mode ทันที ไม่มี Grace Period

## ขั้นตอน

1. ทำ first-dorm direct route และ selector ตั้งแต่หอที่สอง
2. ย้าย entitlement calculation ไป server service
3. ทำ atomic check ก่อนสร้าง dorm/room/package
4. บันทึก promo redemption และ capacity
5. ทำ package status และ expiry job/command
6. เชื่อม Owner Portal cards กับ API status เดียวกัน

## Tests

- free limit 1 dorm/10 rooms/30 push
- paid limit 10 dorm/150 rooms/300 push
- promo replay/capacity/expiry
- package boundary date/time (Asia/Bangkok)
- restricted mode block create/edit/issue/send

## Acceptance Criteria

- client ปลอมค่า plan/room/dorm ไม่สามารถ bypass ได้
- account selector ไม่แสดงเมื่อมีหอเดียว
- expiry/restricted state ตรง Owner และ Tenant
- audit ของ subscription/promo ครบ

## Next

เปิด TASK-008 เมื่อ entitlement boundary tests ผ่าน
