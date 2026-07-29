# TASK-011 — Meter, Billing Cycle & Issued Bill

สถานะเริ่มต้น: `LOCKED UNTIL TASK-010 PASS`  
Gate: `G10`  
Prerequisite: TASK-010 PASS

## เป้าหมาย

ทำให้ meter → calculation → Draft Bill → Issue → Tenant visibility ใช้สูตร/ยอด/เลขที่เดียวกัน

## ขั้นตอน

1. ตรวจ meter reading monotonicity, replacement และ period boundary
2. ทำ rate snapshot ตาม contract/room
3. ให้ cycle สร้าง Draft แบบ idempotent
4. Owner/Manager ตรวจและ Issue แบบ permissioned mutation
5. คำนวณ installment/deposit ตาม rules และ Decimal
6. ทำ state `DRAFT/ISSUED/PARTIALLY_PAID/PAID/OVERDUE/VOIDED`
7. ซ่อน Draft จาก Tenant
8. void unpaid แบบไม่ลบ; paid ใช้ adjustment/refund path

## Tests

- meter lower than previous
- duplicate cycle/retry
- rounding/last installment
- issue concurrent clicks
- tenant cannot read draft
- owner/tenant bill ID, amount, due date parity

## Acceptance Criteria

- ยอดเงินคำนวณ server ด้วย Decimal
- Draft/Issued visibility ถูกต้อง
- contract snapshot ไม่ถูก default ใหม่เปลี่ยน
- audit ของ meter/cycle/issue/void ครบ

## Next

เปิด TASK-012 เมื่อ bill lifecycle และ CP-04 ผ่าน
