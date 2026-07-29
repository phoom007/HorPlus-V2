# TASK-010 — Tenant Registration & Contract

สถานะเริ่มต้น: `LOCKED UNTIL TASK-009 PASS`  
Gate: `G9`  
Prerequisite: TASK-009 PASS

## เป้าหมาย

ทำให้ Tenant สมัครผ่าน LINE/LIFF หรือ Owner สร้างให้ได้ โดยระบบตรวจห้องว่าง เอกสาร กฎหอ Co-tenant ลายเซ็น และ approval flow ครบ

## Business rules

- ปุ่ม Tenant Registration ถาวรจน Owner ปิดรับ ไม่ใช่ invitation token
- Tenant active request ได้หนึ่งรายการต่อหอ
- เลือกได้เฉพาะห้องว่างจริง รวม future reservation
- เอกสาร/กฎบังคับต่อหอ; ไม่ครบห้าม submit
- Co-tenant ใช้ชื่อ/เบอร์โทร ไม่ต้องผูก LINE
- Tenant เซ็นด้วยนิ้ว/เมาส์ พร้อม version/time/IP/LINE ID
- Owner/Manager `อนุมัติ`, `แก้ไข`, `ปฏิเสธ`; reject ต้องมีเหตุผล

## ขั้นตอน

1. สร้าง draft/request ด้วย canonical IDs
2. ตรวจ availability และ race ใน transaction
3. ตรวจ required documents/rules/signature ที่ server
4. ทำ owner review/edit/reject/approve และ notification
5. เมื่อ approve สร้าง tenant binding/contract snapshot แบบ atomic
6. ทำ resubmit หลัง reject โดยเก็บ history

## Tests

- two applicants แย่งห้องเดียวกัน
- missing docs/invalid signature
- owner edit แจ้ง changed fields
- reject reason + resubmit
- duplicate submit/idempotency
- Owner/Tenant registration state parity

## Acceptance Criteria

- approve แล้ว Tenant เข้า portal ได้ทันทีตาม session
- contract/binding/room ไม่ซ้ำ
- owner signature ไม่ถูกบังคับก่อน approval
- audit มี actor/state/reason/time ครบ

## Next

เปิด TASK-011 เมื่อ approval/race/cross-portal tests ผ่าน
