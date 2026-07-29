# TASK-001 — Repository Audit & Baseline

สถานะเริ่มต้น: `OPEN`  
Gate: `G0`  
Prerequisite: ไม่มี

## เป้าหมาย

ทำให้ทีมรู้สถานะจริงของ repository, docs, scripts, routes, migrations และ tests ก่อนแก้โค้ด โดยไม่เดาจากชื่อไฟล์หรือเอกสารเก่า

## อ่านก่อน

- `../../REQUIREMENTS-LOCK.md`
- `../../production-blueprint/01-CURRENT-STATE-AUDIT.md`
- `../03-BASELINE-CURRENT-STATE.md`
- `../11-DEFECT-REGISTER.md`

## ขั้นตอน

1. ตรวจ `git status`, commit, package scripts และ Node/npm versions
2. ตรวจโครงสร้าง `src`, `server/src`, `server/prisma`, tests และ current routes
3. ค้นหาค่าต้องห้าม/legacy เช่น `FINANCE`, `STAFF`, `Shared OA`, `Tenant Google`, `Grace`, monthly price
4. รัน root และ API baseline commands
5. จัดกลุ่ม defect เป็น P0/P1/P2 และผูกกับ Task
6. ห้ามแก้ feature; แก้ได้เฉพาะเอกสาร baseline หากผลตรวจต่างจากเอกสาร

## คำสั่งขั้นต่ำ

```bash
git status --short --branch
node --version
npm --version
npm run lint
npm run build
npm test
npm run lint:api
npm run build:api
npm run test:api
```

## Acceptance Criteria

- มี baseline output ที่ทำซ้ำได้
- รายการ P0/P1 ใน `11-DEFECT-REGISTER.md` ตรงกับโค้ดจริง
- ระบุไฟล์/บรรทัดของ defect สำคัญ
- ไม่แก้ test เพื่อปิดบัง baseline

## Handoff

ใช้แบบฟอร์มใน `../12-TEST-EVIDENCE-HANDOFF.md` และเปิด `TASK-002` ได้เมื่อ audit/report ครบ

## หยุดถาม

ถ้าพบ requirement ในโค้ด/เอกสารที่ขัด Requirements Lock และไม่ใช่ implementation gap ให้หยุดถามเจ้าของผลิตภัณฑ์
