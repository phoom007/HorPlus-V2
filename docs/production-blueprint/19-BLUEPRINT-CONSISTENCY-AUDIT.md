# 19. Blueprint Consistency Audit

สถานะเริ่มต้นของเอกสารชุดนี้: **ALIGNED**

## 1. Locked Value Matrix

| Concern | Expected | Files to check |
|---|---|---|
| Roles | OWNER/MANAGER/TECH | 03,04,05,16,18,20 |
| Staff limit | total 10/dorm | Requirements,03,04,09,13 |
| Room key | building required; unique/building | 03,09,12,13 |
| Free | 1 dorm,10 rooms,30 LINE | 06,08,16 |
| Paid | max150,300 LINE | 06,08,16 |
| Price | duration total incl VAT | 06,07,16 |
| Expiry | immediate restricted | 06,13,16 |
| Tenant auth | LINE/LIFF only | 05,20 |
| OA | per dormitory | 08,20 |
| Billing | Draft hidden until Issue | 07,09,13 |
| Slip override | Owner+Manager+reason | 07,11,13 |
| Public SEO | deferred | 00,15,20 |

## 2. Automated Content Audit

ZIP validation ควร scan คำต่อไปนี้และตรวจบริบท:

- `Finance role`, `Staff role`, `Accountant`
- `Shared OA`
- `Tenant Google`
- `Grace Period 7`
- `25/50/100/200/unlimited rooms`
- `189/month`
- `buildingId optional`

การพบคำใน Current State/Risk/Reject Condition อนุญาตเมื่อระบุว่าเป็น legacy/forbidden เท่านั้น

## 3. Code Consistency Audit

ก่อน Gate ผ่าน ให้ตรวจ:

- Prisma schema + migrations
- Zod enums
- server types/constants
- permission middleware
- route guards
- frontend types/options/labels
- seed/demo data
- tests

## 4. Decision Precedence

หาก code test เดิมคาดค่าเก่า ต้องแก้ test/code ให้ตรง Requirements Lock ไม่ลดทอน requirement เพื่อให้ test ผ่าน

## Acceptance Criteria

- internal markdown links resolve
- ไม่มีไฟล์เก่าถูกวางร่วม
- matrix valuesตรงทุกไฟล์
- consolidated copy generated จากไฟล์ชุดเดียว
- file list อยู่ใน `FILE-MANIFEST.md` และรายงาน SHA-256 ของ ZIP ตอนส่งมอบ
