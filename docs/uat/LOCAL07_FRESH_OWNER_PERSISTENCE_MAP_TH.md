# แผนที่การบันทึกข้อมูลและตรวจสอบความถูกต้องของระบบลงทะเบียนหอพักใหม่ (Fresh Owner Persistence Map)

**รหัสเอกสาร:** `LOCAL07_FRESH_OWNER_PERSISTENCE_MAP_TH.md`  
**สถานะการตรวจสอบ:** `PENDING USER REVIEW` (รอ Product Owner ตรวจสอบผลลัพธ์ผ่านหน้าจอจริง)  
**ชุดข้อมูลทดสอบ:** HorPlus LOCAL-07 Deterministic Dataset (`fresh-owner`)  
**เป้าหมายสภาพแวดล้อม:** PostgreSQL 5455 / Redis 6380 (`horplus_wave1d_fasttrack_test`)  

---

## 1. วัตถุประสงค์ (Purpose)

เอกสารฉบับนี้จัดทำขึ้นเพื่อให้ Product Owner (PO) สามารถตรวจสอบความถูกต้องของการบันทึกข้อมูล (Data Persistence) จากขั้นตอนการลงทะเบียนหอพักใหม่ (Owner Onboarding Workflow: ขั้นตอนที่ 1 ถึง 6) ได้อย่างละเอียดครบถ้วนทุกฟิลด์ โดยแสดงความเชื่อมโยงตั้งแต่:
1. **ข้อมูลที่กรอกในหน้า Onboarding**
2. **Service / API ที่ประมวลผล** (`DormitoryProvisioningService`, `SignatureStorageService`, `SensitiveFieldService`)
3. **ตารางและคอลัมน์ในฐานข้อมูล (Database Schema)**
4. **หน้าจอที่แสดงผลข้อมูลดังกล่าว (UI Screens)**
5. **ความสามารถในการแก้ไขย้อนหลังในหน้าตั้งค่า (Settings)**
6. **ผลกระทบไปยังส่วนงานต่อเนื่อง (Downstream Impact)** เช่น การออกใบแจ้งหนี้, สัญญาเช่า, และการคิดค่าบริการ
7. **สถานะการตรวจรับแบบ Manual** (`PENDING USER REVIEW`)

---

## 2. ตารางแมปปิ้งข้อมูลการลงทะเบียน (Detailed Persistence Map)

### ขั้นตอนที่ 1: ข้อมูลพื้นฐานหอพัก (Property Information)

| # | ฟิลด์ข้อมูล (Field) | ค่าทดสอบที่บันทึก (Seeded Value) | เซอร์วิสที่บันทึก (Service/API) | ตารางและคอลัมน์ในฐานข้อมูล (DB Table & Column) | หน้าจอที่แสดงผล (Display Screen) | แก้ไขได้ใน Settings? | ผลกระทบต่อเนื่อง (Downstream Impact) | สถานะตรวจรับ (Manual Review Status) |
|---|---|---|---|---|---|---|---|---|
| 1.1 | **ชื่อหอพัก** | `หอพัก HorPlus UAT Fresh Owner` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.name` (VARCHAR) | Header ทุกหน้า, `/owner/dashboard`, `/owner/settings` | ✅ แก้ไขได้ (`/owner/settings/general`) | หัวบิลใบแจ้งหนี้, ใบเสร็จรับเงิน, หัวสัญญาเช่า | `PENDING USER REVIEW` |
| 1.2 | **ประเภทที่พัก** | `apartment` (อพาร์ทเม้นท์/หอพัก) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.type` (VARCHAR) | `/owner/settings/general` | ✅ แก้ไขได้ | การจัดหมวดหมู่รายงาน | `PENDING USER REVIEW` |
| 1.3 | **นโยบายผู้พัก** | `mixed` (รวม ชาย-หญิง) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.gender_policy` (VARCHAR) | `/owner/settings/general` | ✅ แก้ไขได้ | การคัดกรองห้องพัก | `PENDING USER REVIEW` |
| 1.4 | **ที่อยู่เลขที่/ถนน** | `99/1 ถนนสุขุมวิท ซอย 55` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.address_line1` (VARCHAR) | `/owner/settings/general`, ท้ายใบแจ้งหนี้/ใบเสร็จ | ✅ แก้ไขได้ | ที่อยู่ผู้ให้เช่าในสัญญาเช่าและใบเสร็จ | `PENDING USER REVIEW` |
| 1.5 | **ตำบล / แขวง** | `คลองตันเหนือ` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.subdistrict` (VARCHAR) | `/owner/settings/general` | ✅ แก้ไขได้ | ที่อยู่เอกสารภาษี/ใบเสร็จ | `PENDING USER REVIEW` |
| 1.6 | **อำเภอ / เขต** | `วัฒนา` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.district` (VARCHAR) | `/owner/settings/general` | ✅ แก้ไขได้ | ที่อยู่เอกสารภาษี/ใบเสร็จ | `PENDING USER REVIEW` |
| 1.7 | **จังหวัด** | `กรุงเทพมหานคร` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.province` (VARCHAR) | `/owner/settings/general` | ✅ แก้ไขได้ | ที่อยู่เอกสารภาษี/ใบเสร็จ | `PENDING USER REVIEW` |
| 1.8 | **รหัสไปรษณีย์** | `10110` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.postal_code` (VARCHAR) | `/owner/settings/general` | ✅ แก้ไขได้ | ที่อยู่เอกสารภาษี/ใบเสร็จ | `PENDING USER REVIEW` |
| 1.9 | **เบอร์โทรศัพท์หอพัก** | `0819998888` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.phone` (VARCHAR) | Header/Footer เอกสาร, `/owner/settings` | ✅ แก้ไขได้ | ช่องทางติดต่อบนใบแจ้งหนี้และ LINE Bot | `PENDING USER REVIEW` |
| 1.10 | **อีเมลติดต่อ** | `contact.fresh@horplus-uat.local` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitories.email` (VARCHAR) | `/owner/settings/general` | ✅ แก้ไขได้ | การส่งการแจ้งเตือนระบบ | `PENDING USER REVIEW` |

---

### ขั้นตอนที่ 2: ตั้งค่ารอบบิลและค่าน้ำ-ค่าไฟ (Billing & Utilities Defaults)

| # | ฟิลด์ข้อมูล (Field) | ค่าทดสอบที่บันทึก (Seeded Value) | เซอร์วิสที่บันทึก (Service/API) | ตารางและคอลัมน์ในฐานข้อมูล (DB Table & Column) | หน้าจอที่แสดงผล (Display Screen) | แก้ไขได้ใน Settings? | ผลกระทบต่อเนื่อง (Downstream Impact) | สถานะตรวจรับ (Manual Review Status) |
|---|---|---|---|---|---|---|---|---|
| 2.1 | **วันตัดรอบบิล** | `25` (ทุกวันที่ 25 ของเดือน) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.billing_day` (INT) | `/owner/settings/billing`, `/owner/billing` | ✅ แก้ไขได้ (`/owner/settings/billing`) | กำหนดวันคำนวณและสร้างใบแจ้งหนี้อัตโนมัติ | `PENDING USER REVIEW` |
| 2.2 | **วันครบกำหนดชำระ** | `5` (ทุกวันที่ 5 ของเดือนถัดไป) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.due_day` (INT) | `/owner/settings/billing`, บิลแจ้งหนี้ | ✅ แก้ไขได้ | กำหนดวัน Due Date และการแจ้งเตือนยอดค้าง | `PENDING USER REVIEW` |
| 2.3 | **ระยะเวลาผ่อนผัน (วัน)** | `3` วัน | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.grace_period_days` (INT) | `/owner/settings/billing` | ✅ แก้ไขได้ | กำหนดวันเริ่มคิดค่าปรับล่าช้า | `PENDING USER REVIEW` |
| 2.4 | **รูปแบบค่าน้ำ** | `per_unit` (ตามหน่วยมิเตอร์) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.water_billing_type` (VARCHAR) | `/owner/settings/billing`, `/owner/meters` | ✅ แก้ไขได้ | วิธีคำนวณเงินค่าน้ำในใบแจ้งหนี้ | `PENDING USER REVIEW` |
| 2.5 | **อัตราค่าน้ำต่อหน่วย** | `18.00` บาท/หน่วย | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.water_rate` (DECIMAL 12,2) | `/owner/settings/billing`, หน้าจดมิเตอร์ | ✅ แก้ไขได้ | ราขาต่อหน่วยเมื่อจดเลขมิเตอร์น้ำ | `PENDING USER REVIEW` |
| 2.6 | **รูปแบบค่าไฟฟ้า** | `per_unit` (ตามหน่วยมิเตอร์) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.electricity_billing_type` (VARCHAR) | `/owner/settings/billing`, `/owner/meters` | ✅ แก้ไขได้ | วิธีคำนวณเงินค่าไฟในใบแจ้งหนี้ | `PENDING USER REVIEW` |
| 2.7 | **อัตราค่าไฟต่อหน่วย** | `7.00` บาท/หน่วย | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.electricity_rate` (DECIMAL 12,2) | `/owner/settings/billing`, หน้าจดมิเตอร์ | ✅ แก้ไขได้ | ราคาต่อหน่วยเมื่อจดเลขมิเตอร์ไฟฟ้า | `PENDING USER REVIEW` |
| 2.8 | **ค่าส่วนกลาง** | `150.00` บาท/เดือน | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.common_fee` (DECIMAL 12,2) | `/owner/settings/billing` | ✅ แก้ไขได้ | รายการเรียกเก็บอัตโนมัติในใบแจ้งหนี้ | `PENDING USER REVIEW` |
| 2.9 | **ค่าอินเทอร์เน็ต** | `200.00` บาท/เดือน | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.internet_fee` (DECIMAL 12,2) | `/owner/settings/billing` | ✅ แก้ไขได้ | รายการบริการเสริมในบิล | `PENDING USER REVIEW` |
| 2.10 | **ค่าที่จอดรถยนต์** | `500.00` บาท/เดือน | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.parking_rate` (DECIMAL 12,2) | `/owner/settings/billing` | ✅ แก้ไขได้ | รายการบริการเสริมตามสัญญาผู้เช่า | `PENDING USER REVIEW` |
| 2.11 | **ค่าปรับล่าช้า** | `100.00` บาท (fixed) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.late_fee_value` (DECIMAL 12,2) | `/owner/settings/billing` | ✅ แก้ไขได้ | การคำนวณค่าปรับเมื่อผู้เช่าจ่ายเกินกำหนด | `PENDING USER REVIEW` |

---

### ขั้นตอนที่ 3: บัญชีรับชำระเงิน (Payment Settings)

| # | ฟิลด์ข้อมูล (Field) | ค่าทดสอบที่บันทึก (Seeded Value) | เซอร์วิสที่บันทึก (Service/API) | ตารางและคอลัมน์ในฐานข้อมูล (DB Table & Column) | หน้าจอที่แสดงผล (Display Screen) | แก้ไขได้ใน Settings? | ผลกระทบต่อเนื่อง (Downstream Impact) | สถานะตรวจรับ (Manual Review Status) |
|---|---|---|---|---|---|---|---|---|
| 3.1 | **รับชำระเงินสด** | `true` (เปิดใช้งาน) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.cash_accepted` (BOOLEAN) | `/owner/settings/payment`, หน้าออกใบเสร็จ | ✅ แก้ไขได้ (`/owner/settings/payment`) | ตัวเลือกการชำระเงินเมื่อเจ้าหน้าที่รับเงินสด | `PENDING USER REVIEW` |
| 3.2 | **ประเภทพร้อมเพย์** | `mobile_phone` (เบอร์มือถือ) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.promptpay_type` (VARCHAR) | `/owner/settings/payment` | ✅ แก้ไขได้ | รูปแบบการสร้าง Thai QR Payment | `PENDING USER REVIEW` |
| 3.3 | **หมายเลขพร้อมเพย์** | `0819998888` (เข้ารหัส AES-GCM) | `SensitiveFieldService.encrypt` | `dormitory_billing_settings.promptpay_value_encrypted` (TEXT) | `/owner/settings/payment`, QR PromptPay ในบิลผู้เช่า | ✅ แก้ไขได้ | QR Code สแกนจ่ายเงินของผู้เช่า | `PENDING USER REVIEW` |
| 3.4 | **ธนาคาร** | `KBANK` (ธนาคารกสิกรไทย) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.bank_code` (VARCHAR) | `/owner/settings/payment`, หน้าชำระเงินผู้เช่า | ✅ แก้ไขได้ | โลโก้และชื่อธนาคารในใบแจ้งหนี้ | `PENDING USER REVIEW` |
| 3.5 | **ชื่อบัญชีธนาคาร** | `เจ้าของทดสอบ Fresh Owner` | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_billing_settings.bank_account_name` (VARCHAR) | `/owner/settings/payment`, หน้าชำระเงินผู้เช่า | ✅ แก้ไขได้ | ข้อมูลการโอนเงินที่แสดงให้ผู้เช่า | `PENDING USER REVIEW` |
| 3.6 | **เลขที่บัญชีธนาคาร** | `1234567890` (เข้ารหัส AES-GCM) | `SensitiveFieldService.encrypt` | `dormitory_billing_settings.bank_account_number_encrypted` (TEXT) | `/owner/settings/payment` (แสดงแบบ Masked) | ✅ แก้ไขได้ | ข้อมูลการโอนเงินที่แสดงให้ผู้เช่า | `PENDING USER REVIEW` |

---

### ขั้นตอนที่ 4: ลายเซ็นอิเล็กทรอนิกส์ผู้ให้เช่า (Owner Signature)

| # | ฟิลด์ข้อมูล (Field) | ค่าทดสอบที่บันทึก (Seeded Value) | เซอร์วิสที่บันทึก (Service/API) | ตารางและคอลัมน์ในฐานข้อมูล (DB Table & Column) | หน้าจอที่แสดงผล (Display Screen) | แก้ไขได้ใน Settings? | ผลกระทบต่อเนื่อง (Downstream Impact) | สถานะตรวจรับ (Manual Review Status) |
|---|---|---|---|---|---|---|---|---|
| 4.1 | **ไฟล์ภาพลายเซ็น (PNG)** | `signature_v1.png` (Valid non-transparent pixels) | `SignatureStorageService.saveSignature` | `owner_signatures.object_key` (VARCHAR) | `/owner/settings/signature`, สัญญาเช่า PDF | ✅ อัปโหลดใหม่ได้ (`/owner/settings/signature`) | ลายเซ็นผู้ให้เช่าท้ายสัญญาเช่าอิเล็กทรอนิกส์ และใบเสร็จรับเงิน | `PENDING USER REVIEW` |
| 4.2 | **เวอร์ชันลายเซ็น** | `1` (พร้อมสถานะ `is_current = true`) | `SignatureStorageService.saveSignature` | `owner_signatures.version`, `is_current` | `/owner/settings/signature` | ✅ อัปเดตอัตโนมัติ | ติดตาม Audit Trail ลายเซ็นในเอกสารย้อนหลัง | `PENDING USER REVIEW` |
| 4.3 | **SHA-256 Checksum** | Deterministic SHA256 Hash | `SignatureStorageService.saveSignature` | `owner_signatures.sha256` (VARCHAR 64) | ระบบ Audit ภายใน | 🔒 ระบบจัดการอัตโนมัติ | ยืนยันความถูกต้อง ไม่ถูกดัดแปลงของไฟล์ลายเซ็น | `PENDING USER REVIEW` |

---

### ขั้นตอนที่ 5: การเชื่อมต่อ LINE Official Account (LINE OA Integration)

| # | ฟิลด์ข้อมูล (Field) | ค่าทดสอบที่บันทึก (Seeded Value) | เซอร์วิสที่บันทึก (Service/API) | ตารางและคอลัมน์ในฐานข้อมูล (DB Table & Column) | หน้าจอที่แสดงผล (Display Screen) | แก้ไขได้ใน Settings? | ผลกระทบต่อเนื่อง (Downstream Impact) | สถานะตรวจรับ (Manual Review Status) |
|---|---|---|---|---|---|---|---|---|
| 5.1 | **สถานะการเชื่อมต่อ** | `isConnected = true` (จำลองการทดสอบผ่าน) | `dormitory_line_configs` | `dormitory_line_configs.is_connected` (BOOLEAN) | `/owner/settings/line-oa` | ✅ แก้ไข/เชื่อมต่อใหม่ได้ | การส่ง Push Notification ใบแจ้งหนี้และข่าวสาร | `PENDING USER REVIEW` |
| 5.2 | **Webhook Verification** | `webhook_active = true` | `dormitory_line_configs` | `dormitory_line_configs.webhook_active` (BOOLEAN) | `/owner/settings/line-oa` | ✅ ตรวจสอบได้ | การรับ Event การชำระเงินและแจ้งซ่อมจาก LINE | `PENDING USER REVIEW` |

---

### ขั้นตอนที่ 6: แพ็กเกจและการใช้โค้ดส่วนลด (Subscription Plan & Promo Code)

| # | ฟิลด์ข้อมูล (Field) | ค่าทดสอบที่บันทึก (Seeded Value) | เซอร์วิสที่บันทึก (Service/API) | ตารางและคอลัมน์ในฐานข้อมูล (DB Table & Column) | หน้าจอที่แสดงผล (Display Screen) | แก้ไขได้ใน Settings? | ผลกระทบต่อเนื่อง (Downstream Impact) | สถานะตรวจรับ (Manual Review Status) |
|---|---|---|---|---|---|---|---|---|
| 6.1 | **แพ็กเกจเริ่มต้น** | `FREE` (ฟรีแพ็กเกจ) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_subscriptions.plan_id` -> `subscription_plans.code = 'FREE'` | `/owner/settings/subscription`, Header Badge | ✅ อัปเกรดเป็น PRO ได้ (`/owner/settings/subscription`) | โควตาจำนวนห้องพัก (ไม่เกิน 10 ห้อง) และฟีเจอร์พื้นฐาน | `PENDING USER REVIEW` |
| 6.2 | **สถานะสมาชิกภาพ** | `TRIAL` (ช่วงทดลองใช้งาน) | `DormitoryProvisioningService.completeOwnerOnboarding` | `dormitory_subscriptions.status` (`TRIAL`) | `/owner/settings/subscription` | 🔒 ระบบจัดการอัตโนมัติ | เปิดให้ใช้งานฟีเจอร์ทั้งหมดได้เต็มรูปแบบ | `PENDING USER REVIEW` |
| 6.3 | **สิทธิ์ประโยชน์บัญชี** | `INITIAL_TRIAL_V1` | `account_benefit_claims` | `account_benefit_claims.benefit_key` (VARCHAR) | ระบบตรวจสอบสิทธิ์ | 🔒 ระบบจัดการอัตโนมัติ | สิทธิ์ทดลองใช้งาน 30 วันแรก | `PENDING USER REVIEW` |
| 6.4 | **โค้ดส่วนลด `HORPLUS`** | `HORPLUS` (รับฟรีเพิ่ม 60 วัน) | `PromoService.redeemCode` (Canonical PROMO-01) | `promo_redemptions.promo_code_id`, `expires_at` ขยาย 60 วัน | `/owner/settings/subscription` (แสดงวันหมดอายุรวม ~90 วัน) | 🔒 ใช้ได้ 1 ครั้งต่อหอพัก | ขยายระยะเวลาทดลองใช้งานรวมเป็น 3 เดือน (~90 วัน) | `PENDING USER REVIEW` |

---

### ขั้นตอนที่ 7: โครงสร้างอาคารและห้องพักเริ่มต้น (Buildings & Rooms Structure)

| # | ฟิลด์ข้อมูล (Field) | ค่าทดสอบที่บันทึก (Seeded Value) | เซอร์วิสที่บันทึก (Service/API) | ตารางและคอลัมน์ในฐานข้อมูล (DB Table & Column) | หน้าจอที่แสดงผล (Display Screen) | แก้ไขได้ใน Settings? | ผลกระทบต่อเนื่อง (Downstream Impact) | สถานะตรวจรับ (Manual Review Status) |
|---|---|---|---|---|---|---|---|---|
| 7.1 | **ชื่ออาคารเริ่มต้น** | `อาคาร A` (รหัส: `A`, 2 ชั้น) | `DormitoryProvisioningService.completeOwnerOnboarding` | `buildings.name`, `buildings.floor_count = 2` | `/owner/rooms`, `/owner/buildings` | ✅ แก้ไข/เพิ่มอาคารได้ | การแบ่งหมวดหมู่ห้องพักในระบบ | `PENDING USER REVIEW` |
| 7.2 | **ห้องพักชั้น 1 (ห้อง 101)** | ค่าเช่า ฿4,500, เงินประกัน ฿4,500, สถานะ `vacant` | `DormitoryProvisioningService.completeOwnerOnboarding` | `rooms.room_number = '101'`, `rooms.status = 'VACANT'` | `/owner/rooms`, `/owner/dashboard` | ✅ แก้ไขได้ (`/owner/rooms/101`) | พร้อมทำสัญญาเช่าใหม่ (New Tenant Contract) | `PENDING USER REVIEW` |
| 7.3 | **ห้องพักชั้น 1 (ห้อง 102)** | ค่าเช่า ฿4,500, เงินประกัน ฿4,500, สถานะ `vacant` | `DormitoryProvisioningService.completeOwnerOnboarding` | `rooms.room_number = '102'`, `rooms.status = 'VACANT'` | `/owner/rooms`, `/owner/dashboard` | ✅ แก้ไขได้ (`/owner/rooms/102`) | พร้อมทำสัญญาเช่าใหม่ | `PENDING USER REVIEW` |
| 7.4 | **ห้องพักชั้น 2 (ห้อง 201)** | ค่าเช่า ฿4,500, เงินประกัน ฿4,500, สถานะ `vacant` | `DormitoryProvisioningService.completeOwnerOnboarding` | `rooms.room_number = '201'`, `rooms.status = 'VACANT'` | `/owner/rooms`, `/owner/dashboard` | ✅ แก้ไขได้ (`/owner/rooms/201`) | พร้อมทำสัญญาเช่าใหม่ | `PENDING USER REVIEW` |
| 7.5 | **ห้องพักชั้น 2 (ห้อง 202)** | ค่าเช่า ฿4,500, เงินประกัน ฿4,500, สถานะ `vacant` | `DormitoryProvisioningService.completeOwnerOnboarding` | `rooms.room_number = '202'`, `rooms.status = 'VACANT'` | `/owner/rooms`, `/owner/dashboard` | ✅ แก้ไขได้ (`/owner/rooms/202`) | พร้อมทำสัญญาเช่าใหม่ | `PENDING USER REVIEW` |

---

## 3. สรุปผลการตรวจสอบและการนำทางสำหรับ Product Owner

1. **เข้าสู่ระบบ Fresh Owner โดยตรง:**
   ```bash
   npm run uat:open -- fresh-owner
   ```
2. **หน้าจอสำคัญที่แนะนำให้ตรวจรับตามแผนที่นี้:**
   - 🏠 **หน้าแรก (Dashboard):** ตรวจสอบว่ามีห้องว่าง 4 ห้อง (100% Vacant), สถานะทดลองใช้ (Trial), และไม่มีค้างชำระ
   - 🏢 **หน้าจัดการห้องพัก (`/owner/rooms`):** ตรวจสอบอาคาร A และห้อง 101, 102, 201, 202
   - ⚙️ **หน้าตั้งค่าทั่วไป (`/owner/settings/general`):** ตรวจสอบชื่อหอพัก, ที่อยู่, เบอร์โทรศัพท์ และทดลองกดแก้ไขและบันทึก
   - 💰 **หน้าตั้งค่ารอบบิล (`/owner/settings/billing`):** ตรวจสอบค่าน้ำ (฿18), ค่าไฟ (฿7), ค่าส่วนกลาง (฿150)
   - 💳 **หน้าตั้งค่ารับชำระ (`/owner/settings/payment`):** ตรวจสอบหมายเลขพร้อมเพย์ และบัญชีกสิกรไทย
   - ✍️ **หน้าตั้งค่าลายเซ็น (`/owner/settings/signature`):** ตรวจสอบรูปภาพลายเซ็นผู้ให้เช่า
   - 🎁 **หน้าแพ็กเกจสมาชิก (`/owner/settings/subscription`):** ตรวจสอบระยะเวลาทดลองใช้รวม ~90 วันจากการใช้โค้ด `HORPLUS`
