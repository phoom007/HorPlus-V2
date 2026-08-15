# HorPlus LOCAL-07 — บันทึกข้อสังเกตและช่องว่างของผลิตภัณฑ์สำหรับ Product Owner (Product Review Findings)

เอกสารนี้รวบรวมข้อสังเกตเชิงเทคนิค, พฤติกรรมของฟีเจอร์, และประเด็นที่ต้องขอการตัดสินใจจาก Product Owner (Product Decision Required) ที่ค้นพบระหว่างการเตรียมระบบ Sandbox สำหรับการทดสอบ UAT ด้วยตนเอง

---

## 📌 สรุปประเด็นที่ต้องตัดสินใจ (Summary of Decisions Required)

| ลำดับ | หัวข้อการประเมิน | สถานะปัจจุบันในระบบ | การตัดสินใจที่ต้องการจาก Product Owner |
| :---: | :--- | :--- | :--- |
| **GAP-01** | **รูปแบบการส่งออกรายงาน (Export Format)** | ส่งออกเป็น **UTF-8 CSV with BOM** (เปิดภาษาไทยใน Excel ได้) ยังไม่มีไฟล์ `.xlsx` แท้ | เลือกว่า CSV เพียงพอต่อการใช้งานจริง หรือต้องการให้เพิ่มระบบสร้างไฟล์ `.xlsx` ไบนารี |
| **GAP-02** | **การดาวน์โหลดใบเสร็จรับเงิน (Receipt Export)** | แสดงผลเป็น **Printable HTML A4 View** (สั่งพิมพ์หรือ Save as PDF ผ่านเบราว์เซอร์) | เลือกว่าการสั่งพิมพ์ผ่านเบราว์เซอร์เพียงพอ หรือต้องการปุ่มดาวน์โหลดไฟล์ `.pdf` ไบนารีจากเซิร์ฟเวอร์ |
| **GAP-03** | **การเชื่อมต่อ LINE OA ในขั้นตอน Onboarding** | ในระบบจริงต้องผูก LINE OA / ใน Sandbox จำลองให้ผ่านทันที | ยืนยันรูปแบบการผูก LINE OA ว่าต้องการให้มีตัวเลือก "ข้ามไปก่อน (Skip for now)" ในเวอร์ชันจริงหรือไม่ |

---

## 🔍 รายละเอียดข้อสังเกตและช่องว่างของผลิตภัณฑ์

### GAP-01: รูปแบบการส่งออกรายงาน (CSV vs Binary XLSX)
- **ประเภท:** `PRODUCT GAP — USER DECISION REQUIRED`
- **ไฟล์ที่เกี่ยวข้อง:** [`src/pages/owner/reports.tsx`](file:///C:/Projects/HorPlus-V2/src/pages/owner/reports.tsx)
- **พฤติกรรมปัจจุบัน:**
  - เมนู **"รายงาน (Reports)"** มีปุ่ม **"ส่งออก CSV"** (แบ่งเป็น 2 ตัวเลือก: ส่งออกประจำเดือน และส่งออกประจำปี)
  - ระบบสร้างไฟล์ `.csv` ด้วย Javascript Blob โดยมีการแทรก UTF-8 Byte Order Mark (`\uFEFF`) ทำให้เมื่อเปิดด้วย Microsoft Excel หรือ Google Sheets ตัวอักษรภาษาไทยจะแสดงผลถูกต้อง ไม่เป็นภาษาต่างดาว
  - อย่างไรก็ตาม ระบบยังไม่ได้ติดตั้งไลบรารีสร้างไฟล์ `.xlsx` (Excel Workbook ไบนารี) เช่น `exceljs` หรือ `xlsx`
- **ทางเลือกสำหรับ Product Owner:**
  - **ตัวเลือก A (แนะนำ):** ใช้การส่งออกเป็น UTF-8 CSV ต่อไป เนื่องจากไฟล์มีขนาดเล็ก เปิดได้ทุกโปรแกรม และครอบคลุมข้อมูลครบถ้วน
  - **ตัวเลือก B:** พัฒนาเพิ่มฟังก์ชันส่งออก `.xlsx` ไบนารีแท้ในรอบถัดไป (เช่น มีการจัดสไตล์สีหัวตารางและสูตรคำนวณในตัว)

---

### GAP-02: การพิมพ์และดาวน์โหลดใบเสร็จรับเงิน (HTML Print View vs Server Binary PDF)
- **ประเภท:** `PRODUCT GAP — USER DECISION REQUIRED`
- **ไฟล์ที่เกี่ยวข้อง:** [`src/pages/owner/bills.tsx`](file:///C:/Projects/HorPlus-V2/src/pages/owner/bills.tsx), [`server/src/routes/receipt.routes.ts`](file:///C:/Projects/HorPlus-V2/server/src/routes/receipt.routes.ts), [`server/src/services/document-pdf.service.ts`](file:///C:/Projects/HorPlus-V2/server/src/services/document-pdf.service.ts)
- **พฤติกรรมปัจจุบัน:**
  - **สัญญาเช่า (Contracts):** มีระบบสร้างไฟล์ `.pdf` ไบนารีจากฝั่งเซิร์ฟเวอร์โดยตรง ผ่าน `DocumentPdfService` (ใช้ฟอนต์ Noto Sans Thai และ `@pdf-lib`)
  - **ใบเสร็จรับเงิน (Receipts):** ระบบแสดงผลเป็นหน้า HTML View ที่จัดเลย์เอาต์ขนาด A4 สวยงาม พร้อม QR Code พร้อมเพย์ และปุ่มสั่งพิมพ์ (`window.print()`) ซึ่งผู้ใช้งานสามารถกด "บันทึกเป็น PDF" ผ่านไดอะล็อกของเบราว์เซอร์ได้ทันที
  - ยังไม่มี Endpoint ส่งออกไฟล์ `.pdf` ไบนารีตรงสำหรับใบเสร็จจากเซิร์ฟเวอร์
- **ทางเลือกสำหรับ Product Owner:**
  - **ตัวเลือก A (แนะนำ):** ใช้การพิมพ์ผ่านเบราว์เซอร์ (A4 Print Layout) ต่อไป เนื่องจากประหยัดทรัพยากรเซิร์ฟเวอร์และผู้ใช้สามารถเลือกเครื่องพิมพ์ได้ยืดหยุ่น
  - **ตัวเลือก B:** พัฒนาเพิ่มการ Render ใบเสร็จเป็นไฟล์ `.pdf` ไบนารีจากเซิร์ฟเวอร์เหมือนสัญญาเช่าในรอบถัดไป

---

### GAP-03: การผูก LINE OA ในขั้นตอนลงทะเบียนหอพัก (Onboarding Step 5)
- **ประเภท:** `PRODUCT GAP — USER DECISION REQUIRED`
- **ไฟล์ที่เกี่ยวข้อง:** [`server/src/services/dormitory-provisioning.service.ts`](file:///C:/Projects/HorPlus-V2/server/src/services/dormitory-provisioning.service.ts)
- **พฤติกรรมปัจจุบัน:**
  - ใน Flow การลงทะเบียน 6 ขั้นตอนของ HorPlus Step 5 กำหนดให้ต้องตรวจสอบความพร้อมของ LINE Official Account (Channel Secret, Access Token, Webhook) จึงจะสามารถกดยืนยันสร้างหอพักได้
  - ใน LOCAL-07 Sandbox ได้ทำการจำลองสถานะ LINE OA ให้พร้อมใช้งานอัตโนมัติ เพื่อให้ทดสอบระบบได้โดยไม่ต้องมีบัญชี LINE จริง
- **คำถามสำหรับ Product Owner:**
  - ในการใช้งาน Production จริง เจ้าของหอพักควรมีตัวเลือก *"ตั้งค่า LINE OA ภายหลัง"* ได้หรือไม่ หรือต้องการบังคับให้ตั้งค่าให้เสร็จสิ้นก่อนเริ่มใช้งานหอพักเสมอ

---
*เอกสารนี้จัดทำขึ้นเพื่อความโปร่งใสทางสถาปัตยกรรมและช่วยสนับสนุนการตัดสินใจเชิงธุรกิจของ Product Owner*
