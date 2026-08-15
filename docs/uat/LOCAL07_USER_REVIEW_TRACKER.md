# HorPlus LOCAL-07 — ตารางติดตามผลการตรวจสอบโดยผู้ใช้งาน (User Review Tracker)

> **สถานะโดยรวม (Overall Status):** `LOCAL-07 — USER MANUAL UAT READY / IN PROGRESS` *(NOT SEALED — อยู่ระหว่างรอการประเมินจาก Product Owner)*

---

## 📊 ตารางติดตามผลการทดสอบรายฟีเจอร์ (Feature Review Matrix)

| รหัสทดสอบ | ฟังก์ชันงานที่ต้องตรวจสอบ (Feature Area) | รายละเอียดการทดสอบ | ข้อมูลทดสอบที่ใช้ | สถานะการตรวจสอบ | ผลการประเมินโดย Product Owner |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **UAT-01** | **Fresh Owner Registration & Persistence** | ตรวจสอบว่าหอพักใหม่ที่เพิ่งจบ Onboarding บันทึกครบทุกฟิลด์ และไม่หลุดสถานะหลังกดรีเฟรช | `หอพัก HorPlus UAT Fresh Owner` (4 ห้องว่าง) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-02** | **Settings & Property Defaults** | แก้ไขค่าน้ำ ค่าไฟ วันที่ตัดรอบบิล และข้อมูลบัญชีธนาคารในหน้าตั้งค่า แล้วบันทึก | เมนู Settings (Fresh / Comp Owner) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-03** | **Dashboard KPIs & Accuracy** | ตรวจสอบตัวเลขสรุป 18 ห้อง, ว่าง 5, เข้าพัก 11, ยอดเรียกเก็บ ฿65,899, ยอดค้าง ฿23,905 | แดชบอร์ดรอบบิล ก.ค. 2569 | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-04** | **Multi-Building Rate Override** | ตรวจสอบว่าอาคาร B คิดค่าน้ำ ฿20 และค่าไฟ ฿8 ต่างจากอาคาร A (น้ำ ฿18, ไฟ ฿7) | อาคารชาญวิทย์ (A) vs อาคารสมบูรณ์ (B) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-05** | **Co-Occupant Surcharges** | ห้อง 104 มีผู้พักร่วม 3 คนเกินโควต้า ระบบคิดค่าบริการเพิ่ม ฿600 ในบิลถูกต้อง | ห้อง 104 (นายวิชัย มั่งมี) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-06** | **Meter Readings & Utility Billing** | ตรวจสอบการคำนวณค่าน้ำ-ค่าไฟจากผลต่างมิเตอร์เดือน มิ.ย. เทียบ ก.ค. | 11 ห้องที่มีการจดมิเตอร์ | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-07** | **Paid Bill & Receipt Issuance** | บิลที่ชำระแล้ว 7 ห้อง แสดงสถานะ Paid, มีหลักฐานชำระ, และออกใบเสร็จ `RCP-202607-001` ถึง `007` | ห้อง 101, 103, 201, 202, 301, 303, B101 | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-08** | **Unpaid Bill & Overdue Handling** | บิลค้างชำระ 4 ห้อง แสดงยอดค้างและมีปุ่มส่งการแจ้งเตือน | ห้อง 102, 104, 203, 302 | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-09** | **Contract Renewal Workflow** | การขอต่อสัญญา (ห้อง 201 รออนุมัติ) และสัญญาต่อเนื่องที่อนุมัติแล้ว (ห้อง 202) | ห้อง 201 (มานี) & ห้อง 202 (ปิติ) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-10** | **Move-out & Settlement Refund** | การย้ายออก หักค่าความเสียหาย ฿1,500 จากมัดจำ ฿4,800 คงเหลือยอดคืนเงินประกัน ฿3,300 | ห้อง 204 (นายวีระ กล้าหาญ) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-11** | **Tenant Portal Experience** | ผู้เช่าล็อกอินดูข้อมูลห้อง บิลเดือนปัจจุบัน ประวัติใบเสร็จ และแจ้งซ่อม | นายสมชาย ใจดี (ห้อง 101) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-12** | **Staff RBAC Security Boundaries** | ผู้จัดการ (Manager) ดูแลบิลและรายงานได้ / ช่าง (Tech) ดูแลงานซ่อมและจดมิเตอร์ได้เท่านั้น | นางสาวปราณี (Manager) & นายสุรชัย (Tech) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-13** | **Maintenance Ticket Flow** | งานแจ้งซ่อมแอร์ห้อง 206 อยู่ในสถานะ In Progress / มอบหมายช่างสุรชัย | ห้อง 206 (แอร์มีน้ำหยด) | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-14** | **Announcements Broadcast** | ประกาศเรื่องล้างถังพักน้ำ และแจ้งปรับปรุงอินเทอร์เน็ตแสดงผลในพอร์ทัล | ประกาศหอพัก 2 รายการ | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |
| **UAT-15** | **Export Capabilities (CSV & PDF)** | ส่งออกรายงานรายเดือนเป็น UTF-8 CSV และสร้าง PDF สัญญาเช่าภาษาไทย | หน้ารายงาน และหน้าสัญญาเช่า | `PENDING USER REVIEW` | [ ] ผ่าน &nbsp; [ ] ต้องแก้ไข |

---

## 📌 สรุปข้อคิดเห็นและข้อเสนอแนะเพิ่มเติมจาก Product Owner (PO Feedback Notes)

```markdown
[พื้นที่สำหรับ Product Owner บันทึกข้อเสนอแนะและสิ่งที่ต้องการปรับปรุงเพิ่มเติม]
- 
- 
- 
```

---
*เอกสารนี้ได้รับการเตรียมพร้อมสมบูรณ์เพื่อสนับสนุนการทดสอบจริง — HorPlus LOCAL-07 Sandbox*
