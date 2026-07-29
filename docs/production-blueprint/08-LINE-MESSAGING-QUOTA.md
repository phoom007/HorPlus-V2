# 08. LINE Messaging and Quota

## 1. Policy

| Entitlement | Quota ต่อหอพัก/เดือน |
|---|---:|
| Free/Trial | 30 |
| Paid Active | 300 |

- reset วันที่ 1 เวลา 00:00:00 `Asia/Bangkok`
- นับ Push ที่ส่งสำเร็จต่อผู้รับ
- Reply ไม่คิด
- 20 ผู้รับสำเร็จ = 20 ครั้ง
- UI ใช้ `จำนวนการส่งข้อความ`

## 2. Per-dorm LINE OA

- one active OA integration per dormitory
- credential encrypted
- webhook URL ใช้ public opaque key ไม่รับ dormitory ID จาก query
- เชื่อมตอน onboarding หรือ just-in-time ก่อนใช้ LINE feature
- disconnect ต้องหยุด outbox ใหม่และแจ้งผลกระทบก่อนยืนยัน

## 3. Quota Ledger

ต่อเดือนมี:

- `quota_limit`
- `successful_send_count`
- `reserved_count`
- `remaining = limit - successful - reserved`

Flow:

```text
validate recipients
→ reserve N atomically
→ create outbox/deliveries
→ provider send
→ success: reserved -1, successful +1
→ failure/cancel: reserved -1
```

ห้ามหัก quota ตั้งแต่กดส่งโดยไม่คืนเมื่อ fail

## 4. Idempotency

- message command มี client/server idempotency key
- delivery unique ต่อ outbox+recipient
- webhook event ID unique
- worker retry delivery เดิม ไม่สร้าง delivery ใหม่
- provider timeout ที่ผลไม่ชัดต้อง query/reconcile ก่อน resend ถ้ารองรับ

## 5. Monthly Cycle

ไม่จำเป็นต้อง update row เก่ากลับเป็นศูนย์ สร้าง quota cycle ใหม่ตาม year/month และเก็บอดีตไว้ การเรียกครั้งแรกของเดือนสามารถ lazy-create พร้อม scheduled job เป็น safety

## 6. UX

- แสดง `ใช้แล้ว/ทั้งหมด` และ `คงเหลือ`
- ก่อนส่งหลายคนแสดงจำนวนผู้รับที่จะใช้
- quota ไม่พอห้ามส่งบางส่วนโดยไม่แจ้ง; ให้เลือกกลุ่มใหม่
- Free หมดที่ 30 และ Paid หมดที่ 300
- ไม่แสดง Channel Secret/OA ID สู่ Public

## Acceptance Criteria

- concurrent sends ไม่ทำ remaining ติดลบ
- failed recipient ไม่ถูกนับ
- mixed result นับเฉพาะ success
- reset boundary Bangkok ถูกต้อง
- Reply event ไม่สร้าง usage
- Dorm A ใช้ quota Dorm B ไม่ได้
- package upgrade เปลี่ยน limit ของ current/future cycle ตาม entitlement event ที่ audit ได้

