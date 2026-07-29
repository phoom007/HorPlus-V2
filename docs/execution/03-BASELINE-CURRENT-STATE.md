# Execution 03 — Baseline ที่ตรวจซ้ำได้

วันที่ตรวจ: 25 กรกฎาคม 2026  
Repository: `horplus-v2`  
Commit ที่ตรวจ: `e4ac131 Replace all old files with new version`

## ผลตรวจปัจจุบัน

| Command | ผล |
|---|---|
| `npm run lint` | PASS |
| `npm run build` | PASS; มี warning bundle > 500 kB |
| `npm test` | PASS — 2 files, 16 tests |
| `npm run lint:api` | FAIL — TypeScript contract errors จำนวนมาก |
| `npm run build:api` | FAIL — error ชุดเดียวกับ API lint |
| `npm run test:api` | FAIL — 88/92 ผ่าน, 4 ล้ม |

## Backend P0 ที่ยืนยันได้

- `prisma.js` export และ import ของ repository/service ไม่ตรงกัน
- `AuthenticatedAuthContext` ขาด `dormitoryId`/`role` ที่ callers ใช้
- Express `Request` ยังไม่มี type augmentation ของ `user`
- import บางไฟล์ลงท้าย `.ts` ซึ่ง build config ไม่อนุญาต
- `AuditLogParams` ไม่ตรงกับ callers (`dormitoryId`, `metadata`)
- LINE repository interface ขาด method ที่ services เรียก
- provider payload ใช้ optional field ไม่ตรง entity type
- Date/Decimal/nullability ของ route → service ไม่ตรงกัน
- announcement recipient/audience ขาด tenant/dormitory context ใน type
- maintenance เรียก repository method ที่ไม่มี

## Test ที่ล้ม 4/92

1. Maintenance cost คาด `'450'` แต่ได้ `'450.00'`
2. Announcement เรียก `quotaService.consumeQuota` ที่ mock/service ไม่มี
3. Announcement quota insufficient จึงไม่คืน `LINE_MESSAGE_QUOTA_INSUFFICIENT`
4. Notification quota warning ไม่ถูกสร้างตาม threshold

## ข้อสรุป

สถานะนี้เป็น baseline เท่านั้น ไม่ใช่ Production Ready และไม่อนุญาตให้เริ่ม Task 005 ขึ้นไปจนกว่า Task 004 จะปิด P0 compile/test ได้

Agent ห้ามแก้ตัวเลขหรือเปลี่ยน test expectation เพียงเพื่อให้ PASS โดยไม่ตรวจ contract/domain ที่ Requirements Lock กำหนด
