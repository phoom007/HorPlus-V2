# TASK-015 — Cross-Portal Release Candidate

สถานะเริ่มต้น: `LOCKED UNTIL TASK-014 PASS`  
Gate: `G14`  
Prerequisite: TASK-014 PASS

## เป้าหมาย

รัน journey matrix ตั้งแต่ Owner สร้างหอจน Tenant ย้ายออก เพื่อพิสูจน์ว่าแต่ละหน้าทำงานต่อกันจริง ไม่ใช่เพียงแยกหน้าผ่าน

## ขั้นตอน

1. reset + seed deterministic dataset
2. รัน CP-01 ถึง CP-10 ใน `../09-CROSS-PORTAL-E2E-MATRIX.md`
3. ทำแต่ละ action ด้วย session/role ที่ถูกต้อง
4. ตรวจ API response, DB record และ UI หลัง hard reload
5. ทำ duplicate/retry และเปิดสอง tab ใน mutation สำคัญ
6. เก็บ mismatch เป็น defect โดยไม่แก้เฉพาะ UI

## Acceptance Criteria

- CP-01–CP-10 ผ่าน
- IDs/status/amount/due date/receipt/audit ตรงกัน
- ไม่มี cross-dorm data leak
- ไม่มี localStorage/mock fallback ใน production path
- P0/P1 ที่เกี่ยวกับ cross-portal ปิดครบ

## Next

เปิด TASK-016 เมื่อ release candidate journey ผ่านทุกข้อ
