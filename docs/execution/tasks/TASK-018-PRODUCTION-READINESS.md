# TASK-018 — Production Readiness & Go/No-Go

สถานะเริ่มต้น: `LOCKED UNTIL TASK-017 PASS`  
Gate: `G17`  
Prerequisite: TASK-017 PASS

## เป้าหมาย

จัดทำหลักฐานและ runbook ให้ตัดสินใจได้ว่าระบบพร้อมเข้าสู่ staging/production หรือยัง โดยไม่ประกาศ production readiness จาก localhost เพียงอย่างเดียว

## Checklist

### Application

- build artifact/reproducible install
- environment/secret contract
- database migration and rollback/recovery
- background jobs/LINE quota reset
- file storage private bucket/presigned URL
- rate limit/error envelope/audit

### External

- Google Auth/OIDC staging
- LINE OA/LIFF per dorm webhook signature
- SlipOK success/reject/timeout
- storage, email/notification หากมี
- domain/CORS/HTTPS

### Operations

- health/readiness/metrics/log retention
- alerting and incident runbook
- backup/restore drill
- migration release/rollback plan
- data deletion/export/privacy handling
- capacity/load/concurrency evidence

## Go criteria

- ไม่มี P0/P1
- Task 001–017 มี PASS/evidence หรือ external item ระบุ owner/date ชัด
- Core cross-portal journeys ผ่าน
- security/backup/restore ผ่านในสภาพแวดล้อมที่เหมาะสม
- Product owner อนุมัติ Go แยกจาก agent

## No-Go criteria

- backend lint/build/test ไม่ผ่าน
- cross-portal mismatch
- RLS/permission leak
- payment/receipt duplication
- migration recovery ไม่ชัด
- external credential behavior ยังไม่ทดสอบแต่ถูกประกาศว่า production ready

## Deferred หลัง Gate 17

- Public Dormitory Directory/SEO/Website Builder
- LINE quota top-up/add-on
- payment gateway อื่น
- advanced developer ecosystem
