# Execution 11 — Defect Register

สถานะเริ่มต้น: เปิดรายการจาก baseline วันที่ 25 กรกฎาคม 2026

| ID | Severity | Defect | พบที่ | ปิดเมื่อ |
|---|---|---|---|---|
| D-001 | P0 | Backend TypeScript compile ไม่ผ่านจาก context/type/import/repository contracts | API lint/build | `npm run lint:api`, `build:api` ผ่าน |
| D-002 | P0 | API tests ล้ม 4/92 ใน maintenance/announcement/quota | API test | 92/92 ผ่านโดยไม่ skip |
| D-003 | P0 | migration history ยังไม่ parity กับ Prisma models ทั้งชุด | DB | fresh + upgrade + RLS ผ่าน |
| D-004 | P0 | frontend/backend port ชนกันใน local scripts | startup | Web 5173 + API 3000 พร้อม |
| D-005 | P0 | owner/tenant data path อาจ split ระหว่าง demo/localStorage/API | cross-portal | CP matrix ผ่าน hard reload |
| D-006 | P1 | role/comment มี legacy FINANCE/STAFF | schema/types/docs | search เหลือเฉพาะ legacy note |
| D-007 | P1 | `Room.buildingId` nullable/unique key ผิดระดับ | Prisma/migration | backfill + constraint ผ่าน |
| D-008 | P1 | package/quota constants อาจใช้ค่าเก่า | plan/line | boundary tests ผ่าน |
| D-009 | P1 | บาง route ยังไม่แสดง auth/dormitory guard ในไฟล์ route | routes | security review/negative tests ผ่าน |
| D-010 | P1 | SlipOK/LINE จริงยังต้อง external verification | integrations | staging evidence หรือ explicit pending |

## กติกา

- ห้ามลบ defect โดยไม่มี evidence
- defect ที่พบใหม่ต้องมี owner Task และ severity
- P0/P1 ค้างอยู่ ห้ามประกาศ Release Candidate ผ่าน
