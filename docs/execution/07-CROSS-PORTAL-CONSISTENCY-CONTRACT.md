# Execution 07 — Cross-Portal Consistency Contract

## กฎสูงสุด

Owner Portal และ Tenant Portal ไม่จำเป็นต้องมี UI เหมือนกัน แต่ต้องใช้ **ข้อมูลจริง, ID, state machine, calculation และ audit source เดียวกัน**

```text
Owner Portal ─┐
              ├─ API/Domain Service ─ PostgreSQL + RLS
Tenant Portal ┘
```

## ห้ามทำ

- สร้างบิล/ยอดเงิน/สถานะซ้ำใน frontend คนละชุด
- ให้ client ส่ง `dormitoryId`, role, amount หรือ status แล้ว server เชื่อตาม
- ใช้ display name/room number จับคู่ record แทน ID
- แสดง Draft bill แก่ Tenant
- ให้ Owner เห็นข้อมูลจาก localStorage ขณะที่ Tenant เห็นจาก API

## Mutation contract

ทุก mutation ต้องระบุ:

| รายการ | ต้องมี |
|---|---|
| Actor | User/session/LINE identity |
| Context | dormitory ที่ server resolve |
| Input | validated DTO และ idempotency key |
| Transition | state เดิม → ใหม่ |
| Atomic write | transaction และ affected IDs |
| Owner read | สิ่งที่ Owner เห็นหลัง refresh |
| Tenant read | สิ่งที่ Tenant เห็นหลัง refresh |
| Audit | event, actor, reason, timestamp |
| Failure | error code และ retry/recovery |

## Canonical state sets

- Registration: `DRAFT → SUBMITTED → APPROVED | REJECTED`
- Contract: `DRAFT → ACTIVE → ENDED`
- Bill: `DRAFT → ISSUED → PARTIALLY_PAID → PAID | OVERDUE | VOIDED`
- Payment evidence: `UPLOADED → REVIEWING → APPROVED | REJECTED`
- Maintenance: `OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED`

## Acceptance Criteria

- ทุก state มี owner/tenant visibility ใน `08-CROSS-PORTAL-STATE-MATRIX.md`
- ทุก critical mutation มี scenario ใน `09-CROSS-PORTAL-E2E-MATRIX.md`
- API response ใช้ canonical IDs/status ไม่แปลงความหมายเฉพาะหน้า
- cross-portal test ผ่านหลัง mutation และหลัง hard reload
