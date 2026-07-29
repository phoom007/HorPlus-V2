# TASK-006 — Identity, Session, Permission & RLS

สถานะเริ่มต้น: `LOCKED UNTIL TASK-005 PASS`  
Gate: `G5`  
Prerequisite: TASK-005 PASS

## เป้าหมาย

ทำให้การยืนยันตัวตนและ authorization ใช้ได้กับ Owner, Manager, Tech และ Tenant พร้อมป้องกัน cross-dorm access ที่ server/database

## ขอบเขต

- Google bootstrap สำหรับ Owner ครั้งแรก
- HttpOnly session/JWT ตาม ADR และ CSRF double-submit
- LINE/LIFF tenant session
- role matrix และ one-role-per-user-per-dorm
- transaction-local RLS ผ่าน `app.current_dormitory_id`
- session revoke/recovery และ rate limit

## ขั้นตอน

1. ตรวจ middleware order: request ID → cookie/session → actor → dormitory → permission → handler
2. ตรวจว่าทุก route mutation ใช้ server-derived dormitory
3. ผูก RLS context ภายใน transaction ไม่ใช้ global mutable state
4. เพิ่ม negative tests สำหรับ A/B dormitory, role และ stale session
5. ตรวจ audit ของ login, bind, revoke, recovery และ denied access

## Acceptance Criteria

- Owner/Manager/Tech เห็น/ทำได้ตาม matrix
- Tenant เห็นเฉพาะ contract/bill/announcement ของตน
- Dormitory A อ่าน/เขียน Dormitory B ไม่ได้ แม้ส่ง ID ปลอม
- CSRF/session/replay/expired session tests ผ่าน
- error ไม่เปิดข้อมูลว่า record ของอีกหอมีอยู่
- RLS integration test รันกับ PostgreSQL จริง หรือมี `EXTERNAL VERIFICATION REQUIRED`

## Next

เปิด TASK-007 เมื่อ identity/permission/tenant isolation ผ่าน

## หยุดถาม

ถ้าต้องเพิ่ม role หรือเปลี่ยน login method จากที่ Requirements Lock กำหนด
