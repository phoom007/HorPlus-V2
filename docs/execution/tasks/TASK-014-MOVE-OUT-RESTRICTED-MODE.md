# TASK-014 — Move-out, Final Settlement & Restricted Mode

สถานะเริ่มต้น: `LOCKED UNTIL TASK-013 PASS`  
Gate: `G13`  
Prerequisite: TASK-013 PASS

## เป้าหมาย

ทำให้ผู้เช่าย้ายออก/สัญญาสิ้นสุด/ชำระยอดสุดท้าย และ package expiry/restricted access เปลี่ยนสิทธิ์ครบทั้ง Owner และ Tenant

## ขั้นตอน

1. ตรวจ end date แบบ half-open interval และ early move-out confirmation
2. สร้าง final settlement/adjustment ตาม ledger
3. ปิด contract/bill state โดยไม่ลบประวัติ
4. revoke tenant LINE binding/session เมื่อสิ้นสิทธิ์
5. package expiry เข้า Restricted Mode ทันที
6. Restricted อนุญาตดูย้อนหลังและต่ออายุ/อัปโหลดสลิปเท่านั้น
7. block create/edit/issue/send และซ่อน Draft จาก Tenant

## Tests

- scheduled end vs early move-out
- unpaid/paid final settlement
- revoke session/binding
- package expiry boundary Asia/Bangkok
- restricted mode bypass attempts
- Owner/Tenant view after move-out

## Acceptance Criteria

- ไม่มี Grace Period
- active access ถูกปิดตาม state จริง
- financial history/audit ยังอ่านได้ตามสิทธิ์
- ไม่เกิด duplicate final bill/receipt เมื่อ retry

## Next

เปิด TASK-015 เมื่อ move-out/restricted และ CP-09 ผ่าน
