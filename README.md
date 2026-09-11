# HorPlus-V2 🏢

ระบบบริหารจัดการหอพักและอพาร์ตเมนต์แบบครบวงจร (Dormitory Management System)  
รองรับการจัดการห้องพัก ผู้เช่า การจดมิเตอร์น้ำ-ไฟ การออกบิลและใบเสร็จ สัญญาเช่า ระบบแจ้งซ่อม ประกาศหอพัก การเชื่อมต่อ LINE OA พร้อมระบบจำลองการทดสอบ **UAT Sandbox** สำหรับบทบาทต่างๆ ในระบบ

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

- **Frontend**: [React 19](https://react.dev/), [Vite](https://vitejs.dev/), [TailwindCSS v4](https://tailwindcss.com/), [TanStack Query v5](https://tanstack.com/query/latest), [Lucide React Icons](https://lucide.dev/)
- **Backend API**: [Node.js](https://nodejs.org/), [Express](https://expressjs.com/), [TypeScript](https://www.typescriptlang.org/), [Prisma ORM v5](https://www.prisma.io/)
- **Database & Cache**: [PostgreSQL 16](https://www.postgresql.org/) (Docker พอร์ต `15555`), [Redis 7](https://redis.io/) (Docker พอร์ต `6380`)
- **Testing & Tooling**: [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/)

---

## 📋 1. สิ่งที่ต้องเตรียมและติดตั้งล่วงหน้า (Prerequisites)

ก่อนเริ่มใช้งาน กรุณาติดตั้งโปรแกรมพื้นฐานดังต่อไปนี้บนเครื่องคอมพิวเตอร์ของคุณ:

1. **Git**  
   - ใช้สำหรับโคลนและจัดการซอร์สโค้ด  
   - ดาวน์โหลด: [https://git-scm.com/downloads](https://git-scm.com/downloads)

2. **Node.js (LTS Version)**  
   - แนะนำเวอร์ชัน **v20.x** หรือ **v22.x LTS** (มาพร้อมกับ `npm`)  
   - ดาวน์โหลด: [https://nodejs.org/](https://nodejs.org/)  
   - ตรวจสอบการติดตั้งผ่าน Terminal / PowerShell:
     ```bash
     node -v
     npm -v
     ```

3. **Docker Desktop**  
   - ใช้สำหรับเปิดฐานข้อมูล PostgreSQL และ Redis  
   - ดาวน์โหลด: [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)  
   - *คำแนะนำสำหรับผู้ใช้ Windows*: ในระหว่างติดตั้ง ให้เลือกเปิดใช้งาน **WSL 2 Backend** และตรวจสอบให้ Docker Desktop เปิดทำงานอยู่เสมอเมื่อเริ่มทดสอบระบบ

---

## 🚀 2. ขั้นตอนการติดตั้งโปรเจกต์ (Installation)

### 2.1 โคลน Repository
เปิด Terminal / PowerShell แล้วรันคำสั่ง:
```bash
git clone https://github.com/phoom007/HorPlus-V2.git
cd HorPlus-V2
```

### 2.2 ติดตั้ง Dependencies
ติดตั้งแพ็กเกจสำหรับ Frontend (Root) และ Backend API:
```bash
# ติดตั้ง dependencies ฝั่ง Frontend
npm install

# ติดตั้ง dependencies ฝั่ง Backend
npm --prefix server install
```

---

## ⚙️ 3. การตั้งค่า Environment Variables (`.env`)

ระบบ HorPlus-V2 แยกไฟล์คอนฟิกออกเป็น 2 ส่วน คือที่ Root โฟลเดอร์ และที่โฟลเดอร์ `server/`

### 3.1 ไฟล์ที่ Root: `.env`
สร้างไฟล์ `.env` ที่โฟลเดอร์หลักของโปรเจกต์ (`HorPlus-V2/.env`) โดยสามารถคัดลอกตัวอย่างค่าตั้งต้นนี้ไปใส่ได้ทันที:

```env
# HorPlus-V2 Local Development Environment Variables
NODE_ENV=development
PORT=3000
API_BASE_PATH=/api/v1
LOCAL07_DB_PORT=15555
DATABASE_URL=postgresql://horplus:hp_57751dc96f8a736f233cb573086544fa@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public
DIRECT_URL=postgresql://horplus:hp_57751dc96f8a736f233cb573086544fa@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public
REDIS_URL=redis://127.0.0.1:6380
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
BODY_LIMIT=1mb
SHUTDOWN_TIMEOUT_MS=10000

# Auth & Session Configuration
GOOGLE_CLIENT_ID=horplus-dev-google-client-id.apps.googleusercontent.com
SESSION_ENCRYPTION_KEY=a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90
SESSION_TTL_SECONDS=86400
SESSION_COOKIE_NAME=horplus_session
CSRF_SIGNING_KEY=c1d2e3f4a5b60718293c4d5e6f7a8b90
CSRF_COOKIE_NAME=horplus_csrf
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
TRUST_PROXY=false

# Field Encryption
FIELD_ENCRYPTION_KEY=fedcba9876543210fedcba9876543210
FIELD_ENCRYPTION_KEY_VERSION=1

# Storage & File Configuration
STORAGE_PROVIDER=local
PUBLIC_SLIP_BASE_URL=http://localhost:3000/api/v1/public/slips
```

### 3.2 ไฟล์ที่ Backend: `server/.env`
สร้างไฟล์ `.env` ในโฟลเดอร์ `server/` (`HorPlus-V2/server/.env`):

```env
# Server Environment Configuration Blueprint
NODE_ENV=development
PORT=3001
API_BASE_PATH=/api/v1
LOCAL07_DB_PORT=15555
DATABASE_URL=postgresql://horplus:hp_57751dc96f8a736f233cb573086544fa@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public
DIRECT_URL=postgresql://horplus:hp_57751dc96f8a736f233cb573086544fa@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public
PGUSER=horplus
PGPASSWORD=hp_57751dc96f8a736f233cb573086544fa
PGHOST=127.0.0.1
PGPORT=15555
PGDATABASE=horplus_wave1d_fasttrack_test
HORPLUS_APP_DB_USER=horplus_app
HORPLUS_APP_DB_PASSWORD=hp_57751dc96f8a736f233cb573086544fa
REDIS_URL=redis://127.0.0.1:6380
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
BODY_LIMIT=1mb
SHUTDOWN_TIMEOUT_MS=10000

# Google Identity Verification
GOOGLE_CLIENT_ID=horplus-test-google-client-id

# Session Encryption & Cookie Settings
SESSION_ENCRYPTION_KEY=a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90
SESSION_TTL_SECONDS=86400
SESSION_COOKIE_NAME=horplus_session

# CSRF Token Protection
CSRF_SIGNING_KEY=c1d2e3f4a5b60718293c4d5e6f7a8b90
CSRF_COOKIE_NAME=horplus_csrf

# Security Cookie Flags
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
TRUST_PROXY=false

# Field Encryption
FIELD_ENCRYPTION_KEY=fedcba9876543210fedcba9876543210
FIELD_ENCRYPTION_KEY_VERSION=1
```

> 💡 **ทำไมต้องเป็นพอร์ต 15555?**  
> บน Windows ระบบ Hyper-V และ WSL 2 มักจะจองพอร์ตแบบสุ่มในช่วง `15405 - 15504` หรือพอร์ต 5432 ทำให้ Docker ไม่สามารถผูกพอร์ตได้ ระบบจึงตั้งค่าพอร์ต PostgreSQL ไว้ที่ **15555** เพื่อป้องกันการชนกับพอร์ตต้องห้ามของ Windows โดยสิ้นเชิง

---

## 🗄️ 4. การเปิดฐานข้อมูลและการสร้างข้อมูลทดสอบ (Database & Fixtures)

### 4.1 สตาร์ท PostgreSQL และ Redis บน Docker
ตรวจสอบให้แน่ใจว่า **Docker Desktop** เปิดอยู่ จากนั้นรันคำสั่ง:
```bash
npm run uat:infra:up
```
ตรวจสอบสถานะคอนเทนเนอร์:
```bash
npm run uat:infra:status
```
*(จะพบ `horplus-v2-db-1` บนพอร์ต `15555` และ `horplus-v2-redis-1` บนพอร์ต `6380` อยู่ในสถานะ `Up (healthy)`)*

### 4.2 สร้างตารางและ Seed ข้อมูลทดสอบ UAT
คำสั่งเดียวที่จะทำการรัน Prisma Migration และใส่ข้อมูลตัวอย่าง (หอพัก, อาคาร, ห้องพัก, ผู้เช่า, มิเตอร์, บิลจำลอง, Session) ให้อัตโนมัติ:
```bash
npm run uat:refresh
```

---

## 🧪 5. การเปิดทดสอบระบบ (UAT Manual Testing)

ระบบ HorPlus-V2 มีเครื่องมือทดสอบ UAT Sandbox ที่สามารถเปิดเบราว์เซอร์และล็อกอินเข้าสู่บทบาท (Persona) ต่างๆ ได้ทันทีโดยไม่ต้องกรอกรหัสผ่านด้วยตนเอง:

### ขั้นตอนที่ 5.1: สตาร์ท Service ทั้งหมด
เปิด Terminal รันคำสั่ง:
```bash
npm run uat:start
```
*คำสั่งนี้จะทำการตรวจเช็ค Docker, สตาร์ท Backend API (พอร์ต 3001), สตาร์ท Frontend Dev Server (พอร์ต 5173) และรัน Preflight เช็คความพร้อมของระบบให้เสร็จสรรพ*

### ขั้นตอนที่ 5.2: เปิดเบราว์เซอร์เข้าทดสอบตามบทบาท (Persona)
เปิด Terminal อีกหน้าต่างหนึ่ง แล้วเลือกรันคำสั่งตามหน้าที่ที่ต้องการทดสอบ:

| คำสั่ง | บทบาท (Persona) | รายละเอียดหน้าจอที่เปิด |
| :--- | :--- | :--- |
| `npm run uat:open:owner` | **Comprehensive Owner** *(แนะนำ)* | เจ้าของหอพักหลัก (หอพักขนาดเต็ม 18 ห้อง, มีครบทุกเมนู) |
| `npm run uat:open:golden-owner` | **Golden Owner** | เจ้าของหอพัก Golden Manor (หอพักขนาด 24 ห้อง) |
| `npm run uat:open:tenant` | **Tenant Somchai** | หน้าจอผู้เช่า (นายสมชาย ห้อง 101 ดูบิล แจ้งซ่อม ประกาศ) |
| `npm run uat:open:manager` | **Staff Manager** | ผู้จัดการหอพัก (นางสาวปราณี) |
| `npm run uat:open:tech` | **Staff Tech** | ช่างเทคนิคประจำหอพัก (นายสุรชัย) |
| `npm run uat:open:register` | **Registration Owner** | หน้าสำหรับทดลองกรอกข้อมูล Onboarding หอพักใหม่ด้วยตนเอง |

> 📌 เบราว์เซอร์จะเปิดขึ้นมาในหน้า Dashboard พร้อม Session ที่เข้าสู่ระบบเรียบร้อย สามารถทดสอบการทำงาน กดบันทึก หรือแก้ไขข้อมูลได้ทันที เมื่อทดสอบเสร็จให้กด `Ctrl + C` ใน Terminal เพื่อปิด

---

## 💻 6. การรันในโหมด Development ปกติ (Alternative)

หากต้องการรันเพื่อแก้ไขโค้ดและดู Hot-Reload ทั่วไป:

```bash
# Terminal 1: รัน Backend API (พอร์ต 3001)
npm run dev:api

# Terminal 2: รัน Frontend Dev Server (พอร์ต 5173)
npm run dev
```
เปิดเข้าใช้งานผ่านเบราว์เซอร์ได้ที่: [http://localhost:5173](http://localhost:5173)

---

## 🧰 7. สรุปคำสั่งที่ใช้งานบ่อย (Useful Commands)

| คำสั่ง | หน้าที่การทำงาน |
| :--- | :--- |
| `npm run uat:preflight` | ตรวจสอบสถานะความพร้อมของ DB, Redis, API, Frontend และ Session ทั้งหมด |
| `npm run uat:refresh` | รีเซ็ตและ Seed ข้อมูลตัวอย่างสำหรับ UAT ใหม่ทั้งหมด |
| `npm run uat:infra:up` | สตาร์ทคอนเทนเนอร์ฐานข้อมูล PostgreSQL และ Redis |
| `npm run uat:infra:status` | ดูสถานะและพอร์ตของคอนเทนเนอร์ Docker |
| `npm run db:down` | ปิดคอนเทนเนอร์ฐานข้อมูลทั้งหมด |
| `npm run build` | ทดสอบ Build ฝั่ง Frontend สำหรับ Production (`vite build`) |
| `npm run build:api` | ทดสอบ Build ฝั่ง Backend API (`tsc -p tsconfig.build.json`) |
| `npm run test` | รันชุด Unit Tests ฝั่ง Frontend |
| `npm run test:api` | รันชุด Unit Tests ฝั่ง Backend API |

---

## ❓ 8. การแก้ไขปัญหาที่พบบ่อย (Troubleshooting)

1. **Docker แจ้งข้อผิดพลาด `HTTP 500: Internal Server Error` หรือ `bind: An attempt was made to access a socket in a way forbidden`**:
   - **สาเหตุ**: พอร์ตที่ระบุตกอยู่ในช่วงพอร์ตที่ Windows / Hyper-V ทำการจองไว้
   - **วิธีแก้**: ตรวจสอบให้แน่ใจว่าได้ใช้พอร์ต `15555` สำหรับฐานข้อมูลในไฟล์ `.env`, `server/.env` และ `docker-compose.windows-pilot.yml`
2. **หน้าเว็บขึ้นว่า Session หมดอายุ หรือกดเปิด UAT แล้วแจ้งเตือน Session Expired**:
   - ให้รันคำสั่ง `npm run uat:refresh` เพื่อสร้าง Session จำลองและข้อมูลทดสอบใหม่อีกครั้ง
3. **เปิดหน้าจอแล้วไม่สามารถโหลดข้อมูลจาก Backend ได้**:
   - ตรวจสอบว่า Backend API กำลังทำงานอยู่บนพอร์ต `3001` โดยทดสอบเปิด [http://127.0.0.1:3001/health/readiness](http://127.0.0.1:3001/health/readiness) (ต้องขึ้น `status: UP`)
