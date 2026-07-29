# TASK-009 — Staff Roles & Per-Dorm LINE OA

สถานะเริ่มต้น: `LOCKED UNTIL TASK-008 PASS`  
Gate: `G8`  
Prerequisite: TASK-008 PASS

## เป้าหมาย

ทำให้บุคลากร 3 role และ LINE OA แยกต่อหอทำงานจริง โดย enforce account cap, invitation, recovery และไม่เปิด secret

## Business rules

- roles: `OWNER`, `MANAGER`, `TECH`
- รวมทุกบัญชีไม่เกิน 10 ต่อหอ
- user หนึ่งคนมีหนึ่ง role ต่อหอ
- invitation บุคลากรหมดอายุ 7 วันและใช้ครั้งเดียว
- OA credential/webhook แยกต่อหอ; connect ตอน onboarding หรือภายหลัง

## ขั้นตอน

1. enforce account cap ด้วย transaction/constraint ไม่ใช่ UI count
2. ตรวจ permission ของ staff management เฉพาะ Owner
3. ทำ LINE OA connect/disconnect/status และ secret redaction
4. ทำ add LINE/recovery กรณี Owner สูญเสีย binding เดิม
5. ทำ webhook signature, dedupe และ audit
6. label quota เป็น `จำนวนการส่งข้อความ`

## Tests

- concurrent invite/create คนที่ 10/11
- role escalation/duplicate role
- expired/replayed invitation
- OA A/B isolation
- webhook invalid signature/replay
- recovery revoke session/binding

## Acceptance Criteria

- เพดาน 10 enforced ที่ server/database
- Manager/Tech ทำได้ตาม matrix
- public response/log ไม่มี channel secret/OA ID ที่ไม่ควรเปิด
- quota counter ไม่รวม reply messages

## Next

เปิด TASK-010 เมื่อ role/cap/OA/recovery tests ผ่าน
