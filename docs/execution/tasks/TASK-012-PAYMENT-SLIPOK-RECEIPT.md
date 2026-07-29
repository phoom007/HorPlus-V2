# TASK-012 — Payment, SlipOK & Receipt

สถานะเริ่มต้น: `LOCKED UNTIL TASK-011 PASS`  
Gate: `G11`  
Prerequisite: TASK-011 PASS

## เป้าหมาย

ทำให้เงินสด/โอน/สลิป, SlipOK adapter, manual override และ receipt เชื่อมบิลเดียวกันโดยไม่เกิด duplicate หรือข้าม financial domain

## Business rules

- Slip verification ไม่จำกัดจำนวนครั้ง แต่มี rate limit/duplicate guard/audit
- Owner/Manager override SlipOK ได้โดยต้องมีเหตุผล
- External timeout/error = review/pending ไม่ใช่ approved
- receipt สร้าง idempotently
- tenant financial domain แยกจาก platform package payment

## ขั้นตอน

1. ทำ private file upload/presigned URL และ MIME/size validation
2. บันทึก PaymentEvidence ด้วย bill/tenant ID จาก server
3. ต่อ mock SlipOK adapter ที่มี success/rejected/error/timeout
4. ทำ retry/idempotency และ manual review
5. อัปเดต bill/payment/receipt ใน transaction
6. ทำ owner/tenant status refresh และ audit

## Tests

- duplicate slip hash/reference
- concurrent approval
- SlipOK timeout/retry
- override without reason denied
- receipt replay returns same receipt
- owner/tenant approved/rejected parity
- private file access by wrong tenant denied

## Acceptance Criteria

- ไม่มีการ mark Paid จาก client อย่างเดียว
- Approved slip ทำให้ bill/payment/receipt สอดคล้องกัน
- rejected slip ส่งใหม่ได้โดยไม่ลบ history
- no secret/signed URL leak

## Next

เปิด TASK-013 เมื่อ CP-05/CP-06 และ idempotency tests ผ่าน
