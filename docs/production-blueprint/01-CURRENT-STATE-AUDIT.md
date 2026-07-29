# 01. Current State Audit

วันที่ตรวจ: 25 กรกฎาคม 2026  
Commit ที่ตรวจ: `e4ac131 Replace all old files with new version`

## 1. สิ่งที่มีใน Repository

### Frontend

- React 19, React Router 7, Vite 6, TypeScript, Tailwind
- Owner, Tenant, Demo, Onboarding และ Public prototype routes
- Demo repository/adapters และ API adapter boundary
- Modules: dashboard, rooms, tenants, contracts, meters, payments, maintenance, announcements, reports, users, settings, audit
- Vitest + happy-dom สำหรับ frontend regression

### Backend

- Express 4 + TypeScript + Zod
- Prisma 5.22 + PostgreSQL schema
- Session, CSRF, rate limit, request ID, error envelope และ permission middleware
- Service/Repository/Route สำหรับ onboarding, property, tenant, contract, meter, billing, payment, receipt, LINE, registration, tenant portal, maintenance, announcement
- Redis client และแนวทาง idempotency
- Backend tests หลาย domain

### Database

Prisma มี model สำหรับ Identity, Dormitory, Subscription, Building, Room, Tenant, Contract, Meter, Bill, Payment, Receipt และ LINE แล้ว แต่ migration ที่มีจริงเพียง:

1. `20260724000000_identity_foundation`
2. `20260724010000_property_tenant_contract`

จึงห้ามสรุปว่า schema ทั้งหมด deploy แล้ว

## 2. Critical Implementation Gaps

| ระดับ | จุดปัจจุบัน | เป้าหมาย |
|---|---|---|
| P0 | Backend `lint` และ `build` ไม่ผ่านจาก import extension, repository interface, audit params และ provider/service contract ที่ไม่ตรงกัน | ทำให้ TypeScript compile ผ่านก่อนเริ่ม feature ใหม่ |
| P0 | Backend test ล้ม 4/92: Maintenance cost format, Announcement quota method 2 เคส และ quota warning notification | แก้ contract และให้ test 92/92 ผ่าน |
| P0 | `Role.code` comment ยังมี FINANCE/STAFF | เหลือ OWNER/MANAGER/TECH และ data migration |
| P0 | `Room.buildingId` nullable | ต้อง required หลัง backfill |
| P0 | Unique room เป็น `(dormitoryId, roomNumber)` | ต้องเป็น `(buildingId, normalizedRoomNumber)` |
| P0 | `PlatformPlan.monthlyPrice` สื่อราคาต่อเดือน | ใช้ package duration + total VAT-inclusive price |
| P0 | Default LINE quota ใน schema = 300 ทุก plan | Free 30, Paid 300 |
| P0 | Migration ยังไม่ครอบคลุม Billing/LINE models | สร้าง migration และทดสอบ RLS จริง |
| P1 | บาง maintenance/announcement route ยังไม่แสดง auth middleware ใน route file | บังคับ unified actor + dormitory + permission ทุก endpoint |
| P1 | Public prototype pages อยู่ใน source | คงได้ใน Demo แต่ห้ามขยายเป็น Public Dorm SEO ก่อน Core |
| P1 | Frontend types ใช้ `buildingId?` | เปลี่ยนเป็น required และรองรับ migration error |
| P1 | Bill status ฝั่ง client ยังใช้ชุดเก่า | normalize เป็น Draft/Issued/PartiallyPaid/Paid/Overdue/Voided |
| P1 | Deposit ยังเป็นเพียง amount/status | เพิ่ม type, paid amount, separate bill/credit/refund ledger |
| P1 | Staff total account limit ยังไม่เป็น invariant ระดับ DB/transaction | enforce 10 รวมทุก role |
| P1 | Production credential flow ยังเป็น placeholder | ต่อ LINE/SlipOK ใน staging เท่านั้น |

## 3. สิ่งที่ถือว่า Prototype-ready แต่ยังไม่ Production-ready

- UI และ Demo workflow
- In-memory/localStorage demo data
- Unit tests ที่ mock repository/provider
- API contracts ที่ยังไม่ผ่าน PostgreSQL + RLS integration
- File upload ที่ยังไม่ใช้ private production storage
- LINE/SlipOK mock provider

## 4. Regression Protection

ระหว่างแก้ backend ต้องรักษา:

- Owner/Tenant navigation และ responsive layout
- Demo dataset reset และ disclosure
- Room/Tenant/Contract/Meter/Bill/Payment/Receipt flow
- Data adapter contract เพื่อสลับ Demo/API
- ภาษาไทยและ error state ที่ผู้ใช้เข้าใจได้

## 5. Verification Baseline

Agent ต้องรันอย่างน้อย:

```text
npm run lint
npm run build
npm test
npm run lint:api
npm run build:api
npm run test:api
```

จากนั้นภายนอก AI Studio:

```text
docker compose up -d postgres redis
npm --prefix server run prisma:migrate:deploy
integration + RLS + concurrency tests
```

ถ้ารันชุดภายนอกไม่ได้ ให้รายงาน `EXTERNAL VERIFICATION REQUIRED`

### ผลที่รันจริง ณ วันที่ตรวจ

| Command | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run build` | PASS พร้อมคำเตือน JS chunk ใหญ่กว่า 500 kB |
| `npm test` | PASS — 2 files, 16 tests |
| `npm run lint:api` | FAIL — TypeScript compile errors หลายกลุ่ม |
| `npm run build:api` | FAIL — error ชุดเดียวกับ API lint |
| `npm run test:api` | FAIL — 13/14 files ผ่าน, 88/92 tests ผ่าน |

กลุ่ม API compile error ที่ต้องแก้ก่อน:

- import path ลงท้าย `.ts` โดย config ไม่อนุญาต
- `AuditLogParams` ไม่ตรงกับ service callers
- LINE repository methods/interface ไม่ตรงกับ services
- provider payload optional field ไม่ตรง type
- billing/payment/room repository interface ชื่อและ method ไม่ตรง
- notification/announcement quota contract ไม่ตรง

นี่เป็นสถานะ baseline ของโค้ดเดิม ไม่ได้เกิดจากเอกสารชุดใหม่

## Acceptance Criteria

- Audit อ้างอิง code/schema/routes จริง ไม่อ้างเอกสารเก่า
- Gap ทุก P0 ถูกสร้างเป็นงานใน Roadmap
- ไม่มีการถือว่า model ใน Prisma เท่ากับ migration ที่ deploy แล้ว
- ไม่มีการย้าย Public/SEO มาแทรกก่อน Core
