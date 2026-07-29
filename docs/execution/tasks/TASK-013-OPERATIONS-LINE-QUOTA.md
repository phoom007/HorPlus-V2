# TASK-013 — LINE Messaging, Quota, Maintenance & Announcement

สถานะเริ่มต้น: `LOCKED UNTIL TASK-012 PASS`  
Gate: `G12`  
Prerequisite: TASK-012 PASS

## เป้าหมาย

ทำให้ outbox/delivery/quota, maintenance assignment และ announcement audience ทำงานตาม role/plan และ cross-portal contract

## Business rules

- Free 30 / Paid 300 push ต่อเดือนต่อหอ
- reset วันที่ 1 เวลา 00:00:00 Asia/Bangkok
- push สำเร็จต่อ recipient นับ 1; reply ฟรี
- quota เตือนเมื่อเหลือ <= 50 ตาม preference
- Tech เห็น/ทำเฉพาะงานที่มอบหมาย

## ขั้นตอน

1. ทำ outbox + delivery status + retry/backoff
2. consume quota แบบ atomic และนับเฉพาะ successful push
3. ทำ monthly reset job และ audit
4. แก้ announcement audience/recipient ให้มี dormitory/announcement IDs
5. ทำ maintenance state machine และ cost formatting
6. เชื่อม in-app + LINE notification และ quota warning

## Tests

- mixed success/failure recipients
- quota boundary 0/1/50/limit
- reset timezone
- duplicate job/retry ไม่ double count
- announcement audience by building/room/tenant
- Tech cross-room/cross-dorm denied
- owner/tenant announcement parity

## Acceptance Criteria

- UI label เป็น `จำนวนการส่งข้อความ`
- quota reset เป็น 300/300 หรือ 30/30 ตาม plan
- publish insufficient quota ได้ error code canonical
- maintenance/announcement tests เดิม 4 เคสผ่านด้วย contract ที่ถูกต้อง

## Next

เปิด TASK-014 เมื่อ delivery/quota/operations และ CP-07/CP-08 ผ่าน
