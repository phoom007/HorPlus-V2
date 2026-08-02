> [!NOTE]
> **[STATUS: DRAFT]**
> Refer to **[21-CURRENT-PRODUCT-RULE-LOCK.md](./21-CURRENT-PRODUCT-RULE-LOCK.md)** for absolute precedence.

# 12. Data Migration Plan

ใช้ Expand → Backfill → Verify → Enforce → Contract และห้ามแก้ production schema ด้วย `db push`

## Phase M0 — Baseline

- backup database
- record deployed migration checksum
- inventory enum/role/room/subscription data
- dry-run บน clone
- หยุดถ้ามี orphan/cross-dorm relation

## Phase M1 — Role Normalization

1. เพิ่ม fixed role codes OWNER/MANAGER/TECH
2. map legacy:
   - OWNER → OWNER
   - MANAGER → MANAGER
   - TECH → TECH
   - FINANCE → MANAGER
   - STAFF → ตัดสินตาม permission จริง: MANAGER หรือ TECH; ambiguous ต้อง report ไม่เดา
3. one role/user/dorm
4. ตรวจหอที่มี membership >10 และสร้าง remediation report
5. enforce enum/check/unique

ห้ามตัดบัญชีคนที่ 11 โดยอัตโนมัติ

## Phase M2 — Building/Room

1. สร้าง `Unassigned/ข้อมูลรอตรวจ` building ต่อหอสำหรับ legacy room ที่ไม่มี building
2. backfill `building_id`
3. normalize room number
4. report duplicate ภายใน building
5. Owner ต้อง resolve duplicate ก่อน unique constraint
6. set `building_id NOT NULL`
7. เปลี่ยน unique เป็น `(dormitory_id, normalized_room_number)`

## Phase M3 — Package Model

- เพิ่ม duration offer + total price
- seed 1/3/6/12/24 เดือนตาม lock
- Free 10/30; Paid 150/300
- migrate existing subscription พร้อม effective entitlement event
- ลบการพึ่ง `monthly_price` หลัง code switch
- no grace state

## Phase M4 — Contract/Deposit/Installment

- เพิ่ม snapshot version/hash
- backfill snapshot จาก contract/room เดิม
- เพิ่ม deposit type/ledger
- สร้าง deposit opening balance เฉพาะสถานะที่พิสูจน์ได้
- unknown status → review queue ไม่ถือว่าจ่ายแล้ว
- เพิ่ม installment schedule และ sum constraint/service invariant

## Phase M5 — Billing/Payment

- normalize bill status
- map cancelled unpaid → VOIDED
- paid cancelled legacy → remediation; ห้าม convert เงียบ
- เพิ่ม unique idempotency/receipt constraints
- แยก platform payment tables

## Phase M6 — LINE

- one OA per dormitory
- encrypt secrets และ rotate plaintext legacy
- backfill identity/role/tenant binding
- create current quota cycle based on entitlement
- reconcile usage จาก delivery success เท่าที่มีหลักฐาน

## Phase M7 — RLS

- policy ทุก dormitory-owned table
- transaction helper
- runtime role no BYPASSRLS
- background service role limited
- automated cross-dorm matrix

## Rollback/Recovery

- schema expand ย้อน code ได้ก่อน enforce
- backfill มี checkpoint/idempotent batch
- destructive column removal ทำ release หลัง verify อย่างน้อยหนึ่งรอบ
- financial/receipt/audit records ห้าม rollback ด้วย delete; ใช้ corrective entry

## Acceptance Criteria

- migration บน fresh DB และ production-like clone ผ่าน
- rerun ปลอดภัย
- duplicate/orphan/ambiguous data มี report
- counts/totals before-after reconcile
- app version N และ N+1 ทำงานใน expand window
- backup restore drill ผ่านก่อน enforce destructive constraint


