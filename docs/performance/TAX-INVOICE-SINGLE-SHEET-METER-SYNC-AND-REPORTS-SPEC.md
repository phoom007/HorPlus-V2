# Specification: Single-Sheet Tax Invoice, Meter Status Synchronization, Itemized (+VAT), Owner Reports & Anti-Wrapping Layout

**Document ID**: `SPEC-TIS-01`  
**Status**: APPROVED BY PO (via Grill-Me Decisions Q1-Q5)  
**Target Version**: HorPlus-V2 v2.8.0  
**Branch**: `main`

---

## 1. PO Sources & Confirmed Requirements

1. **User Requests**:
   - "ปรับ 1.ให้งวดนั้น ถ้าเดือนนั้นเปิด vat ให้ปุ่ม 'ใบเสร็จรับเงิน' ในชำระแล้ว เขียนเป็น 'ใบกำกับภาษี' , และแสดงเอกสารพิมพ์ให้ตรงกัน 1 ใบ"
   - "2.เมนูจดมิเตอร์ สถานะ ปุ่มสีเขียว ควรเขียนว่า 'ชำระแล้ว' ไม่ใช่ขึ้น 'รอชำระ' แปลว่าข้อมูลในการทดสอบยังไม่ทำงานได้เหมือนจริง"
   - "3.เอกสารที่พิมพ์ รายการ ควรเขียนระบุ (+VAT) ด้วย ถ้ารายการนั้นมี vat จริง และคำนวณเลขให้ตรงกับที่คำนวณของแต่ละรายการให้ถูกต้อง"
   - "4.ในเมนูรายงานสถิติ owner/reports ยังไม่คำนวณ vat เข้าไปจริงเลย ควรทำให้แสดงค่า vat ได้ถูกต้องถ้าเดือนนั้นเก็บ vat จริง และใน excel,csv จะได้แสดง vat กับผลลัพท์ที่ถูกต้องด้วย"
   - "5.ข้อความใน 'จำนวนเงินรวมทั้งสิ้น (Total Net Amount):' ควรเขียนเป็นบรรทัดเดียวครับ ตอนนี้มันยาวจนต่อบรรทัดใหม่ครับ ปรับด้วย"
   - "Q1=ก , Q2=ก , Q3=ก ตรวจสอบให้ดีด้วยว่า ปรื้นแล้วไม่เพี้ยน เขียนคำไม่ตัดบรรทัด ตำแหน่งแสดงได้เหมาะสม , Q4=ก Q5=ก"

2. **Confirmed PO Decisions (Grill-Me Round 1)**:
   - **Q1 = ก**: ในเดือนที่เปิดใช้งาน VAT ให้เปลี่ยนปุ่มในการ์ดห้องที่ชำระแล้ว (`/owner/payments`) เป็น **"ใบกำกับภาษี"** และเมื่อกดดู/สั่งพิมพ์ ให้แสดงเอกสารแผ่นเดียวเป็น **"ใบกำกับภาษี (TAX INVOICE)" 1 ใบ** (ส่วนเดือนที่ไม่เปิด VAT จะเป็นปุ่ม "ใบเสร็จรับเงิน" และพิมพ์แผ่นเดียวเป็น "ใบเสร็จรับเงิน (RECEIPT)")
   - **Q2 = ก**: ปรับให้เมื่อห้องพักมีบิลที่ชำระแล้ว (`monthlyUtilityBillStatus === 'paid'` หรือ `isMuPaid = true`) ทั้งปุ่มสวิตช์และข้อความใต้ปุ่มในเมนูจดมิเตอร์ (`/owner/meters`) จะต้องเป็น **สีเขียว "ชำระแล้ว"** เสมอ
   - **Q3 = ก**: ในตารางรายการของเอกสารพิมพ์ ให้ระบุ `(+VAT)` ต่อท้ายชื่อรายการที่มี VAT และแสดงราคา/จำนวนเงินของแต่ละรายการเป็นยอดรวม VAT เพื่อให้ผลรวมตัวเลขในตารางคำนวณตรงกับยอดบิลสุทธิ โดยพิมพ์แล้วไม่เพี้ยน ไม่ตัดคำขึ้นบรรทัดใหม่ ตำแหน่งแสดงผลเหมาะสม
   - **Q4 = ก**: ปรับให้ระบบรายงานสถิติ (`/owner/reports`) รวมยอดคำนวณ VAT ในยอดเรียกเก็บและยอดรายรับจริง, เพิ่มแถวสรุป `"ภาษีมูลค่าเพิ่ม 7% (ภ.พ.30)"` ในไฟล์ CSV Section 2 ให้ตรงกับ Excel, และคำนวณคอลัมน์ VAT ในตารางข้อมูลดิบ Section 3 ทั้ง .xlsx และ .csv
   - **Q5 = ก**: ขยายความกว้างและกำหนดคำสั่ง CSS `white-space: nowrap;` ให้ข้อความ `"จำนวนเงินรวมทั้งสิ้น (Total Net Amount):"` อยู่บนบรรทัดเดียวกันสวยงาม

---

## 2. Acceptance Criteria

### TIS-01: Single-Sheet Document Generation & Dynamic Button Parity
- ใน `src/pages/owner/payments.tsx`:
  - แท็บ "3 ชำระแล้ว": หากรอบบิลที่เลือก หรือใบเสร็จ/บิลนั้น มีการเปิดใช้งาน VAT (`isVatActive === true` หรือ `vatSettings?.enabled === true`) ข้อความปุ่มต้องแสดงเป็น **"ใบกำกับภาษี"**
  - หากรอบบิลหรือบิลนั้นไม่ได้เปิด VAT ข้อความปุ่มต้องแสดงเป็น **"ใบเสร็จรับเงิน"**
- ใน `server/src/utils/receipt-html.util.ts`:
  - เมื่อ `isVatActive === true`: เรนเดอร์เอกสาร **1 แผ่นเดียว** หัวกระดาษเป็น **"ใบกำกับภาษี (TAX INVOICE)"** พร้อมเลขประจำตัวผู้เสียภาษีและตารางสรุปภาษี
  - เมื่อ `isVatActive === false`: เรนเดอร์เอกสาร **1 แผ่นเดียว** หัวกระดาษเป็น **"ใบเสร็จรับเงิน (RECEIPT)"**
  - การพิมพ์ (`@media print`): เอกสารจะพิมพ์ออกเป็น 1 แผ่น A4 พอดี ไม่มีการตัดขึ้นแผ่นที่สองโดยไม่จำเป็น

### TIS-02: Meter Status Switch & Label Synchronization
- ใน `server/src/services/meter.service.ts`:
  - หากห้องมีบิลที่ชำระแล้วสำหรับรอบบิลนั้น (`monthlyUtilityBillStatus === 'paid'`) และไม่มียอดค้างชำระอื่น ให้ระบุ `overallFinancialStatus: 'paid'` และ `isMonthlyUtilityPaid: true` โดยไม่ถูกบล็อกด้วยข้อผิดพลาด INVALID ของมิเตอร์ที่ยังไม่ได้ออกบิล
- ใน `src/pages/owner/meters.tsx`:
  - ในฟังก์ชัน `resolveOwnerMeterDisplayStatus`: หาก `isMuPaid === true` ให้คืนค่า `label: 'ชำระแล้ว'` และ `tone: 'success'` เสมอ
  - ผลลัพธ์: ปุ่มสวิตช์สีเขียวจะคู่กับข้อความใต้ปุ่มสีเขียว **"ชำระแล้ว"** 100%

### TIS-03: Itemized (+VAT) Annotation & Value Alignment
- ใน `server/src/utils/receipt-html.util.ts`:
  - ตรวจสอบรายการในบิลเทียบกับหมวดที่เปิด VAT ใน `vatSettings.appliedCategories` หรือแฟล็ก `isTaxable`
  - หากรายการคิด VAT ให้เติม `(+VAT)` ต่อท้ายชื่อรายการ เช่น `ค่าเช่าห้องพัก 102 (+VAT)`
  - ช่องราคา/หน่วย และจำนวนเงินของรายการนั้น ให้คำนวณรวมภาษีมูลค่าเพิ่ม (เช่น 4,500 + 315 = 4,815.00) เพื่อให้ผลรวมทุกรายการในตารางคำนวณบวกกันได้ตรงกับยอดรวมสุทธิด้านล่างอย่างแม่นยำ

### TIS-04: Owner Reports VAT Integration & Full Export Parity (.xlsx / .csv)
- ใน `src/pages/owner/reports.tsx`:
  - ในการส่งออก CSV Section 2 ("สรุปบัญชีรายรับและรายจ่ายประจำเดือน") ให้เพิ่มแถว:
    `"ภาษีมูลค่าเพิ่ม 7% (ภ.พ.30)",${monthVatTotal},-\n`
    เช่นเดียวกับไฟล์ Excel
  - ใน `extractBillDetails`: หากบิลอยู่ในรอบที่เปิด VAT แต่ยังไม่ได้บันทึก `b.vatAmount` ในฐานข้อมูล ให้คำนวณผ่าน `calculateCategoryStrictVat` โดยอัตโนมัติ เพื่อให้คอลัมน์ VAT และยอดรวมก่อน VAT ใน Section 3 ของทั้ง Excel และ CSV ถูกต้องตรงกัน
- ใน `server/src/utils/report-calculations.ts`:
  - คำนวณยอดรวมหมวดรายรับให้สะท้อนภาษีมูลค่าเพิ่มเมื่อมีการจัดเก็บ VAT จริง

### TIS-05: Total Net Amount Anti-Wrapping & Layout Stability
- ใน `server/src/utils/receipt-html.util.ts`:
  - ปรับปรุง `.totals-area` และ `.total-row`:
    - กำหนด `min-width: 440px; width: 440px; max-width: 100%;`
    - กำหนด `.total-row span:first-child { white-space: nowrap; }` และ `.total-row span:last-child { white-space: nowrap; font-variant-numeric: tabular-nums; }`
    - การันตีว่าข้อความ `"จำนวนเงินรวมทั้งสิ้น (Total Net Amount):"` จะไม่ตัดคำว่า `Amount):` ขึ้นบรรทัดใหม่ทั้งในมุมมองเบราว์เซอร์และหน้าตัวอย่างการพิมพ์ A4

---

## 3. Locked Behaviors & Security Invariants

1. **Security & Authorization**: กฎ SEC-01 ถึง SEC-08 ยังคงมีผลบังคับใช้ 100% การตรวจสอบสิทธิ์การเข้าถึงข้อมูลหอพักยังคง Fail-closed
2. **Multi-Tenant Isolation**: ข้อมูลของแต่ละหอพักแยกขาดจากกันตาม `dormitoryId`
3. **Print Layout Safety**: การจัดหน้าพิมพ์ต้องสะอาด ไม่ทับซ้อน และไม่ตกบรรทัด
4. **Backward Compatibility**: รอบบิลที่ไม่เปิด VAT ยังคงทำงานเป็นใบเสร็จรับเงินแบบดั้งเดิม 100%
