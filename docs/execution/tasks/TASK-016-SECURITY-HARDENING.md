# TASK-016 — Security & Resilience Hardening

สถานะเริ่มต้น: `LOCKED UNTIL TASK-015 PASS`  
Gate: `G15`  
Prerequisite: TASK-015 PASS

## เป้าหมาย

ตรวจคำขอปลอม, replay, injection, rate limit, file security, concurrency และ observability ในระดับที่เหมาะกับ prototype ที่เตรียมใช้งานจริง

## Test areas

- auth/session/CSRF/cookie flags
- permission and RLS negative tests
- IDOR ด้วย room/tenant/bill/dorm IDs ปลอม
- duplicate/idempotency/replay
- rate limit ของ login, upload, webhook, SlipOK
- Zod input boundary, SQL/HTML injection, oversized payload
- private file MIME/size/path traversal/signed URL expiry
- concurrency: room allocation, staff cap, billing issue, slip approval, quota consume
- audit append-only และ request correlation
- logs ไม่เปิด secret/PII เกินจำเป็น

## Acceptance Criteria

- ไม่มี P0/P1 security defect
- ทุก mutation ที่สำคัญมี permission + audit + idempotency
- failure ไม่เปิดข้อมูลข้ามหอ
- retry ไม่สร้าง bill/payment/receipt/notification ซ้ำ
- metrics/health/logs ใช้ debug incident ได้

## External

BurpSuite/load/backup tests ที่รันใน AI Studio ไม่ได้ให้รายงาน `EXTERNAL VERIFICATION REQUIRED` พร้อมขั้นตอนรัน ห้ามรายงาน PASS เอง

## Next

เปิด TASK-017 เมื่อ security/resilience evidence ครบ
