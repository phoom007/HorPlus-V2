# Execution 06 — Demo Dataset Contract

## จุดประสงค์

Demo seed ใช้สำหรับ localhost/UAT และ cross-portal test เท่านั้น ห้ามใช้เป็นข้อมูลจริงหรือผูก Credential ภายนอก

## ข้อมูลขั้นต่ำ

สร้างข้อมูลอย่างน้อย:

- Dormitory A และ Dormitory B เพื่อทดสอบ isolation
- Owner, Manager, Tech ของ Dormitory A
- Tenant active, tenant pending, tenant move-out และ co-tenant
- Building อย่างน้อย 2 แห่ง ห้องว่าง/ไม่ว่าง/จองอนาคต
- Contract ที่ active และ ended
- Meter readings, Draft bill, Issued bill, Partially paid, Paid, Voided
- Payment evidence, rejected slip, approved slip และ receipt
- Maintenance assigned/unassigned และ announcement recipient
- LINE quota ใกล้เต็มและ quota เพิ่ง reset
- Audit events ที่เชื่อมกับทุก flow

## กฎ seed

- ใช้ deterministic IDs หรือเก็บ mapping สำหรับ test
- password/secret เป็นค่า mock ที่ชัดเจน
- seed ต้อง idempotent หรือ reset ก่อน seed
- ห้ามใช้ `localStorage` เป็นฐานข้อมูลของ API test
- ห้าม seed ค่าเก่าที่ Requirements Lock ยกเลิก

## Acceptance Criteria

- test ใช้ seed แล้วอ้างอิง ID ผ่าน fixture ไม่ใช้ชื่อจับคู่
- Owner ของ Dormitory A อ่าน/แก้ Dormitory B ไม่ได้
- reset + seed ซ้ำให้ผลเท่ากัน
- ข้อมูลชุดเดียวกันถูกเห็นจาก Owner และ Tenant ตามสิทธิ์
