# HorPlus-Version 2 — เอกสารหลักสำหรับแทนที่ `/docs` เดิม

เวอร์ชันข้อกำหนด: `2026-07-25 / FINAL-LOCK-A + HYBRID-LOCALHOST-EXECUTION`  
สถานะ: **Approved for implementation**  
เจ้าของผลิตภัณฑ์อนุมัติด้วยคำว่า `OK` แล้ว

เอกสารชุดนี้เป็น Source of Truth สำหรับพัฒนา HorPlus-V2 จาก Prototype ไปสู่ระบบที่รันบน localhost และยกระดับไปสู่ Production Readiness ได้จริง ให้สำรองแล้วลบ `/docs` เดิมทั้งโฟลเดอร์ จากนั้นนำ `docs/` ชุดนี้ไปวางแทน ห้ามผสมไฟล์เก่า เพราะมีข้อกำหนดที่ถูกยกเลิกแล้ว เช่น 5 บทบาท, ห้องแบบไม่จำกัด, Shared LINE OA, Tenant Google Login, Grace Period 7 วัน และราคาต่อเดือน

**จุดเริ่มต้นของ AI Agent:** อ่าน `execution/00-START-HERE.md` ก่อน แล้วทำ `execution/tasks/TASK-001-REPOSITORY-AUDIT.md` เท่านั้น ห้ามกระโดดไปทำ Feature อื่นเอง

## ลำดับความสำคัญ

เมื่อข้อมูลขัดกัน ให้ใช้ลำดับต่อไปนี้:

1. `REQUIREMENTS-LOCK.md`
2. `production-blueprint/18-ARCHITECTURE-DECISION-LOCK.md`
3. เอกสาร Security Contract
4. เอกสาร Production Blueprint หมายเลข `00–20`
5. ADR
6. โค้ดปัจจุบัน

โค้ดปัจจุบันที่ขัดกับเอกสารถือเป็น **Implementation Gap** ไม่ใช่เหตุผลให้เปลี่ยนข้อกำหนด

## เริ่มอ่านจากตรงไหน

| ลำดับ | เอกสาร | ใช้ทำอะไร |
|---|---|---|
| 1 | `REQUIREMENTS-LOCK.md` | กฎธุรกิจและคำตอบสุดท้ายที่ห้ามตีความใหม่ |
| 2 | `production-blueprint/00-EXECUTIVE-SUMMARY.md` | ภาพรวมระบบและขอบเขต |
| 3 | `production-blueprint/01-CURRENT-STATE-AUDIT.md` | สิ่งที่มีจริงใน repository และช่องว่าง |
| 4 | `production-blueprint/15-IMPLEMENTATION-ROADMAP.md` | ลำดับงานที่ agent ต้องทำ |
| 5 | เอกสารเฉพาะ Domain | รายละเอียด Data, API, Security และ Acceptance Criteria |
| 6 | `production-blueprint/19-BLUEPRINT-CONSISTENCY-AUDIT.md` | ตรวจไม่ให้ข้อกำหนดเก่ากลับมา |
| 7 | `execution/01-MASTER-EXECUTION-ROADMAP.md` | ลำดับ Task ตั้งแต่ localhost ถึง Production Readiness |
| 8 | `execution/02-GATE-PROTOCOL.md` | กติกา PASS/FAIL/BLOCKED และหลักฐาน |
| 9 | `execution/07-CROSS-PORTAL-CONSISTENCY-CONTRACT.md` | กติกาบังคับให้ Owner/Tenant ใช้ข้อมูลชุดเดียวกัน |
| 10 | `execution/tasks/TASK-001-REPOSITORY-AUDIT.md` | งานแรกที่อนุญาตให้เริ่ม |

## แผนผังเอกสาร

- `production-blueprint/00–20`: Blueprint หลัก พร้อม Acceptance Criteria
- `production-blueprint/adr`: การตัดสินใจสถาปัตยกรรมที่ล็อกแล้ว
- `security/SECURITY-CONTRACTS.md`: ข้อตกลง RLS, Authorization, File และ Webhook
- `integration/FRONTEND-BACKEND-INTEGRATION-MAP.md`: สัญญาเชื่อมต่อหน้าเว็บกับ API
- `integrations/LINE-OA-LIFF-EXTERNAL-COMPLETION-NOTES.md`: งานภายนอกที่ต้องทำเมื่อมี Credential จริง
- `HORPLUS-PRODUCTION-BLUEPRINT-CONSOLIDATED.md`: ฉบับรวมสำหรับค้นหา/อัปโหลดให้ AI agent
- `execution/`: คู่มือควบคุมการทำงานแบบ Hybrid ตั้งแต่ตรวจสภาพจริงจนถึง UAT/Production Readiness
- `execution/tasks/`: งานเรียงลำดับทีละ Task ทุกงานมี prerequisite, test, acceptance, evidence และ next task

## กฎสำหรับ AI Agent

1. อ่านเอกสารที่เกี่ยวข้องครบก่อนแก้โค้ด
2. ทำทีละ Phase ตาม Roadmap และไม่ขยาย Public Website/SEO ก่อน Core System ผ่าน
3. ห้ามเปลี่ยน Product Decision เอง ถ้าพบคำถามใหม่ที่กระทบราคา สิทธิ์ เงิน หรือข้อมูล ให้หยุดและถามเจ้าของผลิตภัณฑ์
4. ห้ามประกาศ `PASSED` หากทดสอบจริงไม่ได้ ให้ใช้ `EXTERNAL VERIFICATION REQUIRED`
5. ทุกงานต้องมี Migration, Authorization, Audit, Error State, Test และ Rollback/Recovery ที่เหมาะสม
6. ห้ามเชื่อ `dormitoryId`, role, ราคา, ยอดเงิน, quota หรือสถานะจาก Client โดยตรง
7. เอกสารนี้ออกแบบให้ใช้ได้ทั้ง Google AI Studio และ agent ภายนอก โดยแยกระดับการตรวจสอบไว้ชัดเจน
8. ต้องผ่าน Cross-Portal Consistency Gate ทุกครั้ง: Owner และ Tenant ต้องเห็นสถานะ/ยอด/เลขที่/ประวัติจากข้อมูลกลางเดียวกัน
9. ถ้า Gate ใดไม่ผ่าน ให้หยุดที่ Gate เดิม แก้หรือรายงาน BLOCKED ก่อน ห้ามทำเครื่องหมายผ่านเพื่อไป Task ถัดไป

## Definition of Done ระดับระบบ

- Owner, Manager และ Technician/Housekeeping ใช้สิทธิ์ตาม Matrix และรวมไม่เกิน 10 บัญชีต่อหอพัก
- Owner ลงทะเบียนหอแรกด้วย Google และใช้งานภายหลังผ่าน LINE OA ตามสิทธิ์
- Tenant ลงทะเบียนและเข้า Portal ผ่าน LINE OA/LIFF เท่านั้น
- Dormitory → Building → Room → Tenant → Contract → Meter → Draft Bill → Issued Bill → Payment → Receipt เชื่อมข้อมูลถูกต้อง
- Free/Paid/Trial, จำนวนห้อง, จำนวนการส่ง LINE และ Package Expiry ถูกบังคับฝั่ง Server
- SlipOK, Manual Review, Deposit, Installment, Move-out และ Bill Void มี Audit ครบ
- RLS และ Query Scope ป้องกันข้อมูลข้ามหอพัก
- Build/Lint/Test ผ่านในระดับที่สภาพแวดล้อมรองรับ และรายการที่ต้องทดสอบภายนอกถูกระบุชัด
- ทุก Core Flow ผ่านการทดสอบ Owner → Backend → Database → Tenant และย้อนกลับ Tenant → Backend → Owner
