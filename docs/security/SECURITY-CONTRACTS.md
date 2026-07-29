# HorPlus-V2 Security Contracts

ข้อกำหนดนี้เป็น Release Gate ไม่ใช่คำแนะนำ

## 1. RLS Execution Contract

- ทุก dormitory-owned table เปิด RLS
- application DB role ไม่มี owner/superuser/`BYPASSRLS`
- ทุก repository operation อยู่ใน transaction ที่ตั้ง `SET LOCAL app.current_dormitory_id`, actor และ role
- transaction helper clear โดยธรรมชาติเมื่อ commit/rollback
- background worker ตั้ง dormitory ชัดต่อ job
- migration/maintenance role แยกจาก runtime

Test:

- Dorm A อ่าน/แก้ ID Dorm B ไม่ได้
- pooled connection สลับ Dorm A→B ไม่เห็นข้อมูล A
- missing context = deny
- direct raw SQL ของ app role ยังถูก RLS

## 2. Authorization Contract

Route ทุกตัวต้องมี:

1. authenticated actor
2. dormitory scope
3. fixed permission
4. resource ownership
5. state transition guard
6. audit requirement

Roles:

- OWNER full dorm operations/settings/staff
- MANAGER operations+finance+tenant approval; no staff/critical settings
- TECH assigned room/meter/maintenance and limited contact only
- TENANT bound self-service only

รวม OWNER/MANAGER/TECH ไม่เกิน 10 active/invited slot ต่อหอ

## 3. Property/Tenant/Contract Contract

- room `building_id` required
- room unique within building
- relation dormitory IDs must match
- active contract overlap blocked
- contract snapshot immutable after activation
- tenant document requirement validated server-side
- signature bound to tenant, document version/hash and time
- moved-out tenant binding revoked

## 4. Meter/Billing/Payment Contract

- current reading >= previous unless replacement
- bill amount server-calculated from snapshots
- Tenant reads only issued/paid own bills
- unpaid void records reason/history; paid cannot void
- payment approval and receipt issuance atomic/idempotent
- deposit paid balance cannot go negative or refund/apply twice
- Tenant Finance and Platform Finance repositories/services separate

## 5. LINE OA/LIFF/Webhook Contract

- one OA integration per dorm
- channel secret/access token encrypted; never returned
- webhook verifies `x-line-signature` over raw body before JSON use
- public opaque webhook key maps internally to dorm
- event ID unique; replay no-op
- LIFF token verified server-side
- staff role and tenant binding revalidated
- quota reserve/success/release atomic; Free 30/Paid 300

## 6. File Contract

- private bucket/prefix
- upload intent after auth
- magic byte/size/hash validation
- malware scan policy
- short signed read URL after auth
- no PII in object key/log
- sensitive download audit

## 7. Subscription Contract

- offer/duration/price fetched server-side
- promo redemption atomic
- room/message/dorm limit checked server-side
- package activation after verified platform payment only
- expiry immediately restricts mutations

## 8. Audit Contract

Audit append-only สำหรับ financial, contract, role, recovery, approval, LINE and subscription mutations Application role update/delete audit ไม่ได้ Redacted diff เท่านั้น

## 9. Security Acceptance Matrix

| Attack | Expected |
|---|---|
| Change dormitoryId | deny/no data |
| Change role/price/total/status | ignored/rejected/server recompute |
| Replay payment/issue/send | same result, no duplicate |
| Guess object URL | deny |
| Fake LINE webhook | 401/no side effect |
| CSRF mutation | deny |
| SQL/injection payload | validation/parameterized deny |
| Concurrent 11th staff | one or all conflicting request denied, total ≤10 |
| Concurrent quota sends | used+reserved ≤ limit |
| Old moved-out LIFF session | deny |

## 10. Release Evidence

- migration/RLS test output
- permission route matrix
- secret scan
- dependency/image scan
- backup/restore result
- external integration staging result
- known exceptions with owner/expiry

