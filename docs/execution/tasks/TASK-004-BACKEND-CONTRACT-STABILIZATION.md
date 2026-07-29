# TASK-004 — Backend Contract Stabilization

สถานะเริ่มต้น: `LOCKED UNTIL TASK-003 PASS`  
Gate: `G3`  
Prerequisite: TASK-003 PASS

## เป้าหมาย

ปิด P0 compile/type/repository/service contract และทำให้ Backend lint, build และ test ผ่านโดยไม่ลด requirement

## ลำดับแก้

1. แก้ Prisma client export/import ให้เป็นรูปแบบเดียว
2. แก้ Express request augmentation (`user`, actor, dormitory context)
3. แก้ import extensions ตาม tsconfig/build output
4. ทำ canonical `AuthenticatedAuthContext` ให้มี role/dormitory/actor ที่ validated
5. รวม `AuditLogParams` และ metadata schema ให้ตรงทุก caller
6. ทำ repository interfaces ให้ตรง services หรือปรับ service ให้ใช้ contract ที่มีจริง
7. normalize `Date`, `Decimal`, `null` boundary ใน Zod → service → repository
8. แก้ LINE quota/announcement/notification contracts และ provider optional fields
9. แก้ maintenance cost serialization ให้เลือก representation เดียวตาม domain
10. ห้ามแก้ expected test เพียงเพื่อให้ผ่าน

## Commands

```bash
npm run lint:api
npm run build:api
npm run test:api
npm run lint
npm run build
npm test
```

## Acceptance Criteria

- `lint:api` และ `build:api` exit 0
- API tests 92/92 ผ่าน หรือจำนวนใหม่ที่มีหลักฐานว่าการเพิ่ม test ถูกต้อง
- root tests 16/16 ผ่าน
- ไม่มี `any` ใหม่เพื่อกด error
- error envelope และ request ID ยังเหมือนเดิม
- audit/permission/multi-tenant behavior ไม่ถูก bypass

## Regression

รัน tests ของ auth, membership, property, billing, LINE registration และ security session ทุกครั้งหลังแก้ shared contract

## Next

เปิด TASK-005 เมื่อ backend compile/test ผ่านครบ

## หยุดถาม

ถ้าการแก้ contract ทำให้ต้องเปลี่ยน public API หรือ state ที่ locked ให้หยุดถาม
