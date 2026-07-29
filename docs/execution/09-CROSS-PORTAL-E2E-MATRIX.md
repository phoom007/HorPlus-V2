# Execution 09 — Cross-Portal E2E Matrix

| ID | เริ่มจาก | ขั้นตอนหลัก | ตรวจ Owner | ตรวจ Tenant | Gate |
|---|---|---|---|---|---|
| CP-01 | Owner | สร้างหอ → อาคาร → ห้อง | IDs/default ถูก | ยังไม่เห็นข้อมูล private | G6–G8 |
| CP-02 | Tenant | สมัครห้องว่างผ่าน LINE → submit | เห็นคำขอเดียวกัน | เห็น SUBMITTED | G9 |
| CP-03 | Owner | แก้คำขอ → อนุมัติ | audit/contract active | เห็นเหตุผลที่แก้และเข้า portal | G9 |
| CP-04 | Owner | จด meter → สร้าง draft → issue | bill ID/ยอด | Draft ซ่อน, Issued แสดงยอดเดียวกัน | G10 |
| CP-05 | Tenant | อัปโหลด slip → Owner review | evidence เดียวกัน | REVIEWING/REJECTED/APPROVED ตรงกัน | G11 |
| CP-06 | Owner | อนุมัติ slip → receipt | payment/receipt เดียว | PAID + receipt เดียว | G11 |
| CP-07 | Owner | แจ้งซ่อม/assign Tech | assignment/audit | tenant เห็นสถานะงาน | G12 |
| CP-08 | Owner | publish announcement | recipients/quota | tenant เห็นตาม audience | G12 |
| CP-09 | Owner | move-out/final settlement | contract ended/revoke | เข้า restricted/ข้อมูลย้อนหลัง | G13 |
| CP-10 | Security | สลับ Dormitory A/B และ role | deny/empty result | deny/empty result | G14–G16 |

## วิธีรันทุก scenario

1. reset + seed
2. ทำ action ด้วย actor แรก
3. อ่าน API ด้วย actor อีกฝั่ง
4. hard reload/re-login
5. ตรวจ DB record, status, amount, audit
6. ทำซ้ำด้วย request เดิมเพื่อดู idempotency
7. เก็บ request ID/response summary โดยไม่เปิด secret

## Pass criteria

ไม่มี mismatch ของ ID, status, amount, due date, receipt number หรือ audit actor/time
