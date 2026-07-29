# Execution 08 — Cross-Portal State Matrix

| Domain | State | Owner เห็น | Tenant เห็น | ห้ามทำ |
|---|---|---|---|---|
| Registration | DRAFT | แก้/รอส่ง | แก้ต่อได้ | อนุมัติ |
| Registration | SUBMITTED | ตรวจ/แก้/อนุมัติ/ปฏิเสธ | รอตรวจ | เข้า portal เต็มรูปแบบ |
| Registration | APPROVED | active tenant/contract | เข้า portal ได้ | แก้ย้อนหลังโดยไม่ audit |
| Registration | REJECTED | เหตุผล/ประวัติ | เหตุผล/ส่งใหม่ | ลบประวัติ |
| Contract | ACTIVE | snapshot/สถานะ | เงื่อนไขเดียวกัน | เปลี่ยน snapshot ตาม default ใหม่ |
| Bill | DRAFT | แก้/issue | ไม่แสดง | ให้ Tenant ชำระ |
| Bill | ISSUED | ยอด/กำหนดจ่าย | เห็นเลขที่และยอดเดียวกัน | คำนวณใหม่คนละสูตร |
| Bill | PARTIALLY_PAID | ยอดคงเหลือ | ยอดคงเหลือเดียวกัน | สร้าง payment ซ้ำ |
| Bill | PAID | receipt/paid at | receipt/paid at เดียวกัน | แก้เป็น void |
| Bill | VOIDED | เหตุผล/ผู้ทำ | ถูกยกเลิก ไม่ค้างชำระ | ลบ record |
| Slip | UPLOADED/REVIEWING | คิวตรวจ | รอตรวจ | ถือว่าชำระแล้ว |
| Slip | APPROVED | payment/receipt | ชำระแล้ว | สร้าง receipt ซ้ำ |
| Slip | REJECTED | เหตุผล | เหตุผล/ส่งใหม่ | ซ่อน audit |
| Maintenance | ASSIGNED | ผู้รับผิดชอบ | สถานะงาน | Tech เห็นทุกหอ |
| Announcement | PUBLISHED | recipient/delivery | เห็นข้อความตาม audience | ส่งเกิน quota |

ทุกแถวต้องมี API contract และ E2E scenario ก่อนถือว่า Domain ผ่าน
