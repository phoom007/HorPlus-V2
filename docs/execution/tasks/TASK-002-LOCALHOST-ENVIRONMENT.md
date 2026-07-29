# TASK-002 — Localhost Environment

สถานะเริ่มต้น: `LOCKED UNTIL TASK-001 PASS`  
Gate: `G1`  
Prerequisite: TASK-001 PASS

## เป้าหมาย

ทำให้ clone ใหม่เปิด Frontend, Backend, PostgreSQL และ Redis ได้พร้อมกันด้วยคำสั่งมาตรฐาน และตรวจ health ได้

## ขอบเขต

- แก้ root Vite port จาก 3000 ให้เป็น 5173 หรือรับค่าจาก env
- ให้ API อยู่ที่ 3000 และ CORS ชี้ 5173
- ตรวจ `.env.example`, `server/.env.example`, Docker Compose และ README
- เพิ่ม/ปรับ health/readiness check เท่าที่จำเป็น

ห้ามเพิ่ม business feature หรือผูก credential จริง

## ขั้นตอน

1. ตรวจ port conflict ปัจจุบัน
2. แก้ script/config ให้ canonical ตาม `../04-LOCALHOST-STARTUP.md`
3. สร้าง local env จาก example โดยไม่ commit secret
4. เปิด PostgreSQL/Redis และตรวจ logs
5. เปิด API/Web แยก terminal
6. ตรวจ liveness/readiness และ CORS preflight
7. หยุดแล้ว restart เพื่อพิสูจน์ repeatability

## Tests

```bash
npm run db:up
curl -fsS http://localhost:3000/health/liveness
curl -fsS http://localhost:3000/health/readiness
npm run lint
npm run build
```

Manual: เปิด `http://localhost:5173`, ตรวจ route Owner/Tenant/Demo และ error state เมื่อ API หยุด

## Acceptance Criteria

- Web 5173 และ API 3000 ไม่ชนกัน
- readiness แจ้ง DB/Redis failure อย่างถูกต้อง
- CORS อนุญาตเฉพาะ origin local ที่กำหนด
- clone/setup instructions ทำตามได้โดยไม่เดาคำสั่ง
- ไม่มี secret ใน diff

## Next

เปิด TASK-003 เมื่อ `../04-LOCALHOST-STARTUP.md` ทุกข้อผ่าน

## หยุดถาม

ถ้าต้องเลือก port/hosting ที่ขัดกับ Architecture Lock หรือจำเป็นต้องติดตั้ง service ภายนอก ให้หยุดถาม
