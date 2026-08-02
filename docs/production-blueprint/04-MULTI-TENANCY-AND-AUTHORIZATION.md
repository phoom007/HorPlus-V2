> [!WARNING]
> **[STATUS: SUPERSEDED_IN_PART]**
> Some or all rules in this document may be superseded. Always refer to **[21-CURRENT-PRODUCT-RULE-LOCK.md](./21-CURRENT-PRODUCT-RULE-LOCK.md)** as the absolute source of truth.

# 04. Multi-tenancy and Authorization

## 1. Tenant Boundary

Tenant ในเอกสารนี้หมายถึง Dormitory data boundary; ผู้เช่าจะเรียก `room tenant`

ทุก request ต้อง resolve:

```text
identity → actor → dormitory membership/binding → role → permission → RLS context
```

ห้ามให้ caller เลือก dormitory อิสระโดยไม่มี membership

## 2. Roles

| Module | Owner | Manager | Tech |
|---|---|---|---|
| Dormitory settings | Manage | View | None |
| Buildings/rooms | Manage | Manage | View assigned |
| Tenants/contracts | Manage | Manage | Contact assigned only |
| Registration approval | Manage | Manage | None |
| Meter | Manage | Manage | Work assigned |
| Billing/payment/receipt | Manage | Manage | None |
| Maintenance | Manage | Manage | Work assigned |
| Announcement | Manage | Manage | View work-related |
| LINE sending | Manage | Manage | None |
| LINE OA configuration | Manage | None | None |
| Roles/staff/recovery | Manage | None | None |
| Audit | Full | Operational | Own work only |

One user = one role per dormitory. รวม membership ที่ใช้ slot ไม่เกิน 10

## 3. Tenant Portal Authorization

LINE binding ต้อง resolve ไปยัง `tenant_id + dormitory_id + active contract`

Tenant อ่านได้เฉพาะ:

- profile ของตน
- active contract ของตน
- issued bills/payments/receipts ของตน
- maintenance/announcements ที่เกี่ยวข้อง

หลัง moved-out binding ถูก revoke และ portal history ไม่เปิดให้ดูอีก

## 4. RLS Execution

ภายใน transaction:

```sql
SET LOCAL app.current_actor_id = '<uuid>';
SET LOCAL app.current_dormitory_id = '<uuid>';
SET LOCAL app.current_role = 'OWNER|MANAGER|TECH|TENANT|SYSTEM';
```

- ใช้ `SET LOCAL` เท่านั้น
- transaction จบแล้ว context ต้องหาย
- runtime role ไม่มี `BYPASSRLS`
- System worker ใช้ service role เฉพาะ job และต้องระบุ target dormitory ก่อน query

## 5. Object-level Guards

RLS อย่างเดียวไม่พอ Service ต้องตรวจ:

- relation ทั้งหมดอยู่ dormitory เดียวกัน
- Tech ได้รับมอบหมายห้อง/งานจริง
- Tenant resource เป็นของ binding ปัจจุบัน
- state transition ถูกต้อง
- resource version ตรงเพื่อ optimistic concurrency

## 6. Account Recovery

- Owner ที่ยัง Active เชื่อม Owner คนเดิมกับ LINE ใหม่ได้หลัง step-up verification
- หากไม่มี Owner เข้าถึงได้ ให้ Admin HorPlus ใช้ recovery case
- ต้อง revoke session/binding เก่า บันทึก evidence/เหตุผล และแจ้ง Owner ทุกคน
- ห้ามเปลี่ยน ownership จากการรู้เบอร์โทรหรือ email เพียงอย่างเดียว

## Acceptance Criteria

- cross-dorm IDOR test ทุก endpoint ได้ 403/404 โดยไม่เปิดว่ามี resource
- Manager เข้า roles/settings mutation ไม่ได้
- Tech เข้าบิล/สัญญา/สลิปไม่ได้
- คนที่ 11 ถูกปฏิเสธแบบ atomic
- revoke role มีผลกับ session/LIFF revalidation
- connection pool ไม่ทำ RLS context รั่ว


