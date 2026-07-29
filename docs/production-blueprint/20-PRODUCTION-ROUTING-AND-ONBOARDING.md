# 20. Production Routing and Onboarding

## 1. Route Zones

| Zone | Actor | Production intent |
|---|---|---|
| `/register` | Guest Owner | Google bootstrap + dorm registration |
| `/auth/liff` | LINE user | exchange verified LINE identity for session |
| `/owner/*` | OWNER/MANAGER/TECH | role workspace; route permission differs |
| `/tenant/register` | LINE follower | permanent registration flow |
| `/tenant/*` | approved active Tenant | portal scoped to binding/contract |
| `/demo/*` | demo guest | isolated mock data only |
| `/public/*` | guest | existing product info only; dorm SEO deferred |

ชื่อ route จริงปรับได้ตาม router แต่ boundary ห้ามเปลี่ยน

## 2. First Owner

```text
Main menu “ลงทะเบียน”
→ Google OIDC
→ Dormitory form
→ Package/Trial
→ Dorm/Building/Room defaults
→ optional LINE OA connect
→ provision atomically
→ Dashboard
```

หอแรกเข้าตรง หอที่ 2 เป็นต้นไปแสดง selector

## 3. LINE OA Connection

- Owner เลือก `เชื่อมตอนนี้` หรือ `ภายหลัง`
- ถ้าภายหลัง กด Send LINE/Tenant LINE feature แล้วเปิด connection wizard
- verify credentials/webhook ownership ก่อน `ACTIVE`
- secret ไม่กลับไปที่ client หลัง save

## 4. Staff

- Owner สร้าง invitation role OWNER/MANAGER/TECH
- invite อายุ 7 วัน ใช้ครั้งเดียว
- accept ผ่าน LINE identity และต้องตรวจ slot เหลืออีกครั้ง
- คนที่ 11 reject แม้ invite ถูกสร้างก่อนเต็ม

## 5. Tenant Registration

ปุ่ม LINE OA ใช้ได้ถาวรจน Owner ปิดรับ:

```text
follow OA → LIFF → choose available room
→ rules/docs/co-tenant/signature
→ submit → Owner/Manager review
→ approve/edit/reject
→ approved binding → tenant portal
```

ปุ่มนี้ไม่ใช่ staff invitation token และไม่หมดอายุ 7 วัน

## 6. Owner-created Tenant

- Owner/Manager สร้าง tenant/contract draft ได้
- บันทึก deposit paid-before-LINE ได้พร้อมหลักฐาน
- ภายหลัง Tenant follow OA แล้ว claim/bind ผ่าน verification
- ห้าม bind จากชื่อ/เบอร์อย่างเดียว

## 7. Move-out Routing

เมื่อ confirm:

- tenant session/binding revoked
- tenant portal access denied
- owner history retained
- room available
- future approved reservation activate ตาม date/job

## 8. Deferred Public Dormitory Site

หน้า Landing/Pricing/Help ที่อยู่ใน prototype ไม่เท่ากับ Public Dormitory Directory ห้ามเพิ่ม SEO listing/content builder/OA public info จน Core Gate 11 ผ่าน

## Acceptance Criteria

- no Tenant Google login production route
- staff invite 7 วัน; tenant registration button no expiry
- direct/selector behavior ถูก
- optional LINE connection มี just-in-time guard
- route guard refresh/deep link ทำงาน
- demo session/data ไม่ปะปน production API

