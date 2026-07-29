# Execution 10 — API/UI Ownership Map

| Domain | Backend source of truth | Frontend boundary | ห้ามวาง business rule ไว้เฉพาะ |
|---|---|---|---|
| Identity/session | `server/src/services/auth.service.ts`, session middleware | auth adapter + route guards | page component |
| Dormitory/room | repositories + services + Prisma | owner API adapter/pages | localStorage |
| Tenant/contract | tenant/contract services/routes | owner/tenant adapters | duplicated form logic |
| Meter/bill | meter/billing services | shared DTO/status formatter | tenant page |
| Payment/receipt | payment/receipt/slip services | upload/review adapters | browser-only amount |
| LINE/quota | line services/repositories | notification UI | counter calculated in UI |
| Maintenance | maintenance service | owner/tech/tenant views | role checks in JSX only |
| Audit | audit service | read-only audit page | mutation response alone |

## Rules

- Shared type/DTO ต้องมี version และ mapping ที่เดียว
- Frontend ส่ง command; backend คำนวณ/authorize/transition
- UI formatter แปลงการแสดงผลได้ แต่ห้ามเปลี่ยนความหมายของ state/amount
- Demo adapter แยกจาก production API adapter และต้องมี contract test ชุดเดียวกัน
- เปลี่ยน endpoint หรือ status ต้องอัปเดต map, tests และ state matrix ใน Task เดียวกัน
