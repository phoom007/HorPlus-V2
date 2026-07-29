# TASK-017 — Localhost UAT & Responsive Regression

สถานะเริ่มต้น: `LOCKED UNTIL TASK-016 PASS`  
Gate: `G16`  
Prerequisite: TASK-016 PASS

## เป้าหมาย

ให้ผู้ทดสอบสามารถใช้ระบบบน localhost ตาม flow จริงบน mobile, LINE WebView, iPad และ desktop พร้อมหลักฐาน UAT

## ขั้นตอน

1. เปิด local stack จากคู่มือโดยไม่ใช้ข้อมูลมือ
2. ใช้ demo accounts/seed mapping
3. ทดสอบ Owner, Manager, Tech และ Tenant
4. ทำ CP journey ซ้ำผ่าน UI จริง
5. ตรวจ responsive breakpoints, keyboard/touch/signature/upload
6. ทดสอบ loading, empty, error, expired/restricted และ retry
7. บันทึก screenshot/console/network summary โดยลบ PII/secret

## UAT checklist

- login/logout/session expiry
- create dorm/building/room
- tenant registration/approval/rejection
- meter/bill/payment/receipt
- maintenance/announcement/quota
- move-out/restricted
- audit/permission/tenant isolation

## Acceptance Criteria

- critical flows ผ่านบน viewport ที่กำหนด
- ไม่มี P0/P1 bug
- Owner/Tenant ข้อมูลตรงกันหลัง refresh
- error ภาษาไทยเข้าใจได้และไม่แสดง stack trace
- UAT evidence ลงใน handoff ครบ

## Next

เปิด TASK-018 เมื่อ UAT sign-off ครบ
