# ADR-008 — Platform Financial Domain

Status: Accepted

## Decision

ค่าแพ็กเกจ HorPlus เป็น Platform Finance แยกจาก Tenant Finance ทุก table/service/receiver/numbering

## Consequences

- offer เป็น duration + total price
- upload slip ยังไม่ activate
- SlipOK/Admin verified จึง activate
- platform refund/correction ไม่ใช้ tenant bill/payment/receipt
- authorization เป็น Owner/Admin HorPlus ตาม context

