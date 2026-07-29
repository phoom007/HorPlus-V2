# HorPlus-Version 2 — Backend Foundation API

Backend API foundation for HorPlus-Version 2 built with Node.js, Express, TypeScript, PostgreSQL 16, Prisma ORM 5.x, and Redis 7.

---

## 1. Requirements

- Node.js >= 22.0.0
- npm >= 10.0.0
- Docker & Docker Compose (for local PostgreSQL 16 & Redis 7)

---

## 2. Installation & Quick Start

```bash
# 1. Install backend dependencies
npm --prefix server ci

# 2. Start local PostgreSQL 16 and Redis 7 containers
npm run db:up

# 3. Generate Prisma Client
npm --prefix server run prisma:generate

# 4. Start backend API in development mode
npm --prefix server run dev
```

---

## 3. Environment Configuration

Copy `.env.example` to `.env` inside `server/` or configure process environment variables:

```dotenv
NODE_ENV=development
PORT=3000
API_BASE_PATH=/api/v1
DATABASE_URL=postgresql://horplus:horplus_dev_password@localhost:5432/horplus?schema=public
REDIS_URL=redis://localhost:6379
LOG_LEVEL=debug
CORS_ORIGINS=http://localhost:5173
BODY_LIMIT=1mb
SHUTDOWN_TIMEOUT_MS=10000
```

---

## 4. Commands

| Script | Description |
|---|---|
| `npm --prefix server run dev` | Start API server in watch mode (`tsx`) |
| `npm --prefix server run build` | Compile TypeScript into `dist/` |
| `npm --prefix server run start` | Run compiled JS from `dist/server.js` |
| `npm --prefix server run lint` | Run TypeScript type checking (`tsc --noEmit`) |
| `npm --prefix server run test` | Run Vitest unit & integration tests |
| `npm --prefix server run prisma:validate` | Validate `schema.prisma` |
| `npm --prefix server run prisma:generate` | Generate Prisma Client |

---

## 5. Health Check Endpoints

- `GET /health/liveness` - Liveness probe (200 OK)
- `GET /health/readiness` - Readiness probe (200 OK if DB & Redis UP, 503 if DOWN)
- `GET /health/metrics` - Application & process metrics

---

## 6. Architecture Boundary & Unimplemented Features

### Included in TASK 005 (Foundation)
- Express Application setup & Server bootstrap
- Environment validation with Zod
- Structured JSON logging (Pino) & Request ID tracking
- Standard Error Envelope & Global Error Handler
- PostgreSQL 16 & Prisma ORM 5.x singleton client
- Redis 7 client singleton
- Docker Compose & Cloud Run compatible Dockerfile
- Automated Vitest unit and HTTP tests
- GitHub Actions CI Workflow

### Non-Goals (Scope Boundaries for TASK 005)
- Google OIDC Authentication & Session Cookie (`TASK 006`)
- Multi-Tenant RLS membership enforcement (`TASK 006`)
- Business domain endpoints (Rooms, Tenants, Contracts, Meters, Bills, Payments, Subscription, LINE, SlipOK) (`TASK 007+`)

---

## 7. Security Notes

- Secrets are automatically redacted in startup logs and environment error outputs.
- Non-root user `nodejs` (UID 1001) is used in the multi-stage `Dockerfile`.
- Wildcard `*` CORS origins are prohibited in production mode.
