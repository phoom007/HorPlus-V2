# Execution 04 — Localhost Startup Contract

## เป้าหมายพอร์ต

| Component | Canonical local URL | หมายเหตุ |
|---|---|---|
| Frontend | `http://localhost:5173` | Vite |
| Backend API | `http://localhost:3000` | Express; `API_BASE_PATH=/api/v1` |
| PostgreSQL | `localhost:5432` | PostgreSQL 16 |
| Redis | `localhost:6379` | Redis 7 |

ปัจจุบัน root script ใช้ Vite port 3000 ขณะที่ backend ใช้ port 3000 เช่นกัน งาน Task-002 ต้องแก้ให้ไม่ชนกันและต้องอัปเดต README/.env ให้สอดคล้อง

## Prerequisite

- Node.js >= 22
- npm >= 10
- Docker + Docker Compose
- Git

## คำสั่งมาตรฐาน

```bash
npm ci
npm --prefix server ci
cp server/.env.example server/.env
npm run db:up
npm --prefix server run prisma:validate
npm --prefix server run prisma:generate
npm --prefix server run prisma:migrate:deploy
```

เปิด terminal แยก:

```bash
npm run dev:api
npm run dev
```

ตรวจ:

```bash
curl -fsS http://localhost:3000/health/liveness
curl -fsS http://localhost:3000/health/readiness
```

## Environment Rules

- ห้าม commit secret จริง
- `CORS_ORIGINS` ต้องเป็น `http://localhost:5173` ใน local
- `DATABASE_URL` และ `REDIS_URL` ต้องชี้ local service ที่ seed ได้
- mock provider ต้องติดป้ายชัดเจนและไม่ถูกใช้เป็น production adapter
- เปลี่ยน port ต้องแก้ `.env.example`, Docker/README และ test fixture พร้อมกัน

## Acceptance Criteria

- Clone ใหม่ทำตามคำสั่งแล้ว Web/API/DB/Redis เปิดได้
- readiness แยก liveness ได้ และแสดง dependency failure อย่างปลอดภัย
- restart container/API แล้วข้อมูล seed ยังอยู่
- หยุดระบบด้วย `npm run db:down` ได้โดยไม่ลบ volume โดยไม่ตั้งใจ
- ถ้าสภาพแวดล้อมไม่มี Docker ให้รายงาน `EXTERNAL VERIFICATION REQUIRED`
