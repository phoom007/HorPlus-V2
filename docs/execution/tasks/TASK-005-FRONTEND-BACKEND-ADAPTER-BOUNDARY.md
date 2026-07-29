# TASK-005 — Frontend/Backend Adapter Boundary

สถานะเริ่มต้น: `LOCKED UNTIL TASK-004 PASS`  
Gate: `G4`  
Prerequisite: TASK-004 PASS

## เป้าหมาย

ทำให้ Owner Portal และ Tenant Portal ใช้ API/Domain contract เดียวกันใน production path โดยยังรักษา Demo Mode ที่แยกชัดเจน

## ตรวจและแก้

1. ทำ inventory ของ `src/types.ts`, API adapters, demo repositories และ page loaders
2. กำหนด DTO/status formatter กลางสำหรับ tenant, contract, bill, payment, receipt, maintenance
3. ให้ frontend ส่ง command ที่มี ID และ validated input; server คำนวณ amount/status
4. แยก `src/demo/*` ออกจาก production router/state
5. เอา `localStorage` ออกจาก source of truth ของ API mode
6. ทำ loading/error/empty/permission state ให้เหมือน contract
7. ห้ามใช้ `window.location.reload()` เป็น navigation หลัก

## Tests

- adapter contract tests กับ mock API
- same fixture rendered ใน Owner และ Tenant
- hard reload/re-login แล้วข้อมูลไม่ย้อนกลับ local state
- unauthorized route และ API 401/403
- network error ไม่ทำให้ UI แสดงข้อมูลเก่าเป็นข้อมูลจริง

## Acceptance Criteria

- มี production adapter เพียงเส้นทางที่ชัดเจน
- Demo reset ยังผ่าน root tests
- Owner/Tenant ใช้ canonical IDs/status จาก backend
- ไม่มี business calculation สำคัญซ้ำเฉพาะ page
- API response mismatch แสดง error ไม่ silently fallback เป็นข้อมูล mock

## Next

เปิด TASK-006 เมื่อ adapter contract และ root regression ผ่าน

## หยุดถาม

ถ้าต้องลบ demo route หรือเปลี่ยน user-facing route ที่ล็อกไว้ ให้หยุดถาม
