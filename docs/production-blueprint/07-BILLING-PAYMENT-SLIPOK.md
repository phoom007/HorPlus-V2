# 07. Billing, Payment, Deposit and SlipOK

## 1. Financial Domain Separation

| Domain | Payer | Receiver | ตัวอย่าง |
|---|---|---|---|
| Tenant Finance | Tenant | Dormitory Owner | ค่าเช่า น้ำ ไฟ มัดจำ ค่าปรับ |
| Platform Finance | Owner | HorPlus | ค่าแพ็กเกจ 189–2,999 บาท |

ห้ามแชร์ payment ID, receipt number, receiver account, table หรือ approval service

## 2. Billing Lifecycle

```text
METER_READY
→ DRAFT
→ ISSUED
→ PARTIALLY_PAID
→ PAID
```

ทางแยก:

- `DRAFT → VOIDED`
- `ISSUED/OVERDUE unpaid → VOIDED` พร้อมเหตุผล
- `PAID` ห้าม void; ใช้ Adjustment/Refund

Scheduler สร้าง Draft อัตโนมัติ แต่ Tenant เห็นเมื่อ Owner/Manager Issue เท่านั้น

## 3. Meter-to-Bill

- reading current ต้องไม่น้อย previous เว้นแต่มี meter replacement event
- rate มาจาก billing snapshot ไม่รับจาก client
- generate idempotent ต่อ cycle+contract+kind
- ก่อน Issue แสดง preview และ validation error ต่อห้อง
- ในหน้า `จดมิเตอร์` ถ้า Draft ยังไม่ Issue ให้ย้อนเป็น `ยังไม่ออกบิล` และ void Draft เดิมแบบมี audit ได้

## 4. Installment

- max installment ต่อ dormitory
- schedule รวมเท่ากับ contract term amount
- default แบ่งเท่ากัน; งวดสุดท้ายรับ rounding remainder
- Owner/Manager แก้ amount/due date ก่อน Issue
- หลัง Issue การแก้ใช้ void+reissue หรือ adjustment ตามสถานะ

## 5. Deposit

Deposit Bill แยกจาก Rent Bill:

- `REFUNDABLE`
- `RENT_CREDIT`

รองรับ:

- Owner บันทึกว่าได้รับก่อน Tenant เชื่อม LINE
- Tenant ชำระจาก Portal
- Contract Active โดย deposit outstanding ได้
- credit/refund/damage deduction ใช้เฉพาะ paid balance

Deposit ledger ต้องรักษา:

```text
charged = paid + outstanding
paid = refundable_balance + applied_credit + refunded + damage_deducted
```

## 6. Tenant SlipOK

1. upload intent
2. validate MIME/size/magic bytes
3. private store
4. SHA-256 duplicate check
5. create submitted payment idempotently
6. enqueue SlipOK
7. compare receiver, amount, timestamp, bank reference/QR
8. auto approve หรือ manual review

จำนวนการตรวจไม่จำกัดเชิงแพ็กเกจ แต่ rate limit/abuse protection ยังบังคับ

## 7. Manual Override

Owner และ Manager:

- approve/reject mismatch/review-required ได้
- ต้องกรอก reason
- บันทึก provider response hash, actor, time, before/after
- ห้าม override duplicate bank transaction ที่เคยใช้กับ payment อื่นโดยไม่มี Admin case

## 8. Receipt

- ออกหลัง approved payment
- idempotency key = approved payment ID
- one canonical receipt ต่อ payment version
- correction ใช้ void/correction document ไม่ลบ
- PDF/print data คำนวณจาก immutable receipt items

## 9. Platform SlipOK

- invoice amount ต้องตรง offer total price
- receiver ต้องเป็นบัญชี HorPlus
- verified เท่านั้นจึง activate
- N/A/API error/timeout เข้า Admin review
- Admin action มี reason/audit และห้ามใช้ Tenant Finance permission

## Acceptance Criteria

- Tenant ไม่เห็น Draft
- concurrent generate/payment approval ไม่สร้างซ้ำ
- paid bill void ไม่ได้
- deposit unpaid ไม่ถูกนับเป็น cash/credit
- Owner/Manager override มี reason; Tech ทำไม่ได้
- Tenant/Platform slip สลับ domain ไม่ผ่าน
- rounding ยอด installment รวมตรงถึงสตางค์

