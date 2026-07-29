# Execution 00 — START HERE

สถานะ: **เอกสารควบคุมการลงมือทำ**  
รูปแบบ: **Hybrid — Foundation Gates → Vertical Slices → Hardening → UAT**  
คำอนุมัติ: `OK` วันที่ 25 กรกฎาคม 2026

## เป้าหมาย

นำ repository ปัจจุบันของ HorPlus-V2 จากสถานะ Prototype ที่ Frontend ผ่าน แต่ Backend ยังไม่ผ่าน compile/test ไปสู่สถานะที่:

- เปิดระบบบน localhost ด้วยคำสั่งที่ทำซ้ำได้
- ใช้ PostgreSQL/Redis จริงใน local environment
- มี migration และ demo seed ที่สร้างข้อมูลชุดเดียวกันทุกครั้ง
- Owner, Manager, Tech และ Tenant ใช้ข้อมูลกลางผ่าน API/Domain Service
- Owner Portal และ Tenant Portal สอดคล้องกันข้ามหน้า
- ทุก Core Flow มี automated test, cross-portal E2E และหลักฐาน handoff
- มีรายการที่ต้องทดสอบด้วย Credential จริงแยกจากสิ่งที่ AI Studio ทดสอบได้

## กฎเริ่มงาน

Agent ต้องทำตามลำดับนี้เท่านั้น:

```text
อ่าน Requirements Lock
→ อ่าน Current State และ Execution Rules
→ ทำ TASK-001
→ รัน Gate
→ รายงานหลักฐาน
→ เมื่อ PASS จึงเปิด TASK ถัดไป
```

เริ่มได้เพียง `TASK-001-REPOSITORY-AUDIT.md` งานอื่นถือว่ายังไม่เปิด

## เอกสารที่ต้องอ่านก่อน Task แรก

1. `../REQUIREMENTS-LOCK.md`
2. `../production-blueprint/18-ARCHITECTURE-DECISION-LOCK.md`
3. `../production-blueprint/01-CURRENT-STATE-AUDIT.md`
4. `../AI-AGENT-EXECUTION-RULES.md`
5. `01-MASTER-EXECUTION-ROADMAP.md`
6. `02-GATE-PROTOCOL.md`
7. `07-CROSS-PORTAL-CONSISTENCY-CONTRACT.md`
8. `tasks/TASK-001-REPOSITORY-AUDIT.md`

## ลำดับ Gate

| Gate | ผลลัพธ์ที่ต้องได้ | Task |
|---|---|---|
| G0 Baseline | รู้สถานะจริงและ defect ที่ทำซ้ำได้ | 001 |
| G1 Localhost | Web/API/DB/Redis เปิดพร้อมกันได้ | 002 |
| G2 Data Foundation | Migration/seed fresh และ upgrade ผ่าน | 003 |
| G3 Backend Contract | API lint/build/test ผ่าน | 004 |
| G4 Boundary | Frontend/API ใช้ contract กลาง ไม่แยก mock | 005 |
| G5 Identity/RLS | session, role, tenant isolation ผ่าน | 006 |
| G6 Onboarding | Owner สร้างหอและ entitlement ถูกต้อง | 007 |
| G7 Property | อาคาร/ห้อง/default/snapshot ถูกต้อง | 008 |
| G8 Staff/LINE | 3 role, limit 10, OA ต่อหอถูกต้อง | 009 |
| G9 Tenant/Contract | สมัคร-อนุมัติ-แก้-ปฏิเสธ-เซ็นผ่าน | 010 |
| G10 Billing | meter → draft → issue → tenant เห็นตรงกัน | 011 |
| G11 Payment | slip/payment/receipt/override ผ่าน | 012 |
| G12 Operations | maintenance/announcement/quota ผ่าน | 013 |
| G13 Move-out | ปิดสัญญา สิทธิ์ และ Restricted Mode ถูกต้อง | 014 |
| G14 Cross-Portal RC | Full owner↔tenant journeys ผ่าน | 015 |
| G15 Hardening | security, retry, concurrency, file ผ่าน | 016 |
| G16 UAT | localhost ใช้งานตาม checklist ได้ | 017 |
| G17 Production Ready | มีหลักฐาน Go/No-Go ครบ | 018 |

## ถ้าเจอปัญหา

- Compile/test fail: อยู่ Task เดิมและเปิด/อัปเดต defect
- Database หรือ Requirements เปลี่ยน: หยุดและถามเจ้าของผลิตภัณฑ์
- รัน Docker/Google/LINE/SlipOK ไม่ได้: รายงาน `EXTERNAL VERIFICATION REQUIRED` ห้ามสรุปว่า PASS
- Owner/Tenant เห็นข้อมูลไม่ตรงกัน: Gate ไม่ผ่าน แม้ UI แต่ละหน้าจะดูถูกต้อง

## สิ่งที่ถือว่า “ส่งงาน”

ใช้ `execution/12-TEST-EVIDENCE-HANDOFF.md` เป็นแบบฟอร์มทุกครั้ง และระบุ Task ถัดไปจากไฟล์ปัจจุบันเท่านั้น
