# ADR-006 — Money and Rounding

Status: Accepted

## Decision

ใช้ PostgreSQL `DECIMAL(12,2)` และ Decimal.js ห้ามใช้ floating point สำหรับ business money

## Rules

- round half-up เป็น 2 ตำแหน่งที่ line-item boundary ตาม policy เดียว
- installment งวดสุดท้ายรับ remainder
- total = sum persisted items ไม่เชื่อ client total
- refund/credit เป็น ledger entry ไม่แก้ยอดอดีต

