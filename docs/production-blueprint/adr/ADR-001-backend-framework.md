# ADR-001 — Backend Framework

Status: Accepted

## Decision

ใช้ Node.js + TypeScript + Express + Zod สำหรับ Production API โดยคง Service/Repository boundary

## Consequences

- สอดคล้อง code ปัจจุบัน
- API deploy แยก Web/Worker ได้
- Route ห้ามเรียก Prisma โดยตรง
- ต้องมี standard error, request ID, auth, permission, transaction และ audit middleware
- ถ้าจะเปลี่ยน framework ต้องมี benchmark, migration plan และ owner approval

