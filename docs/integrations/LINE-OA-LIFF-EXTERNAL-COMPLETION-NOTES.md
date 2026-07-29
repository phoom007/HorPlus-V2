# LINE OA / LIFF / SlipOK — External Completion Notes

ไฟล์นี้ใช้เมื่อ Core code พร้อมและมี Sandbox/Production credential จริง งานเหล่านี้ไม่ควรบังคับให้ AI Studio ใช้ Secret

## 1. Per-dorm LINE OA Setup

ต่อหอพัก:

- Messaging API channel
- Channel secret
- Channel access token/refresh strategy
- LINE Login channel/LIFF app
- LIFF endpoint allowlist
- opaque webhook URL
- Rich Menu ที่แยก role/tenant behavior ตาม server session

ห้ามคัดลอก credential หอหนึ่งไปอีกหอ

## 2. Credential Test

- connection check ไม่ log secret
- invalid/expired token → status ชัด
- rotate token โดยไม่เสีย binding
- disconnect หยุด send และบอก impact
- connect later guard ทำงานเมื่อกด feature

## 3. Webhook Test

- valid signature accepted
- invalid/missing signature rejected
- duplicate event ignored
- out-of-order follow/unfollow handled
- reply messageไม่คิด quota
- webhook resolves dormitory internally

## 4. LIFF Test

- Owner/Manager/Tech route ตาม assignment
- one LINE identity with memberships across dorms shows authorized selector
- Tenant unapproved sees registration/review state
- approved sees own portal
- moved-out/revoked role denied after revalidation
- LINE WebView cookie/redirect works on iOS/Android

## 5. Push and Quota

- Free 30/Paid 300
- multi-recipient counts successful recipient
- partial failure releases reservation
- provider rate limit retry
- month boundary Asia/Bangkok
- reconcile provider result with delivery ledger

## 6. SlipOK

Tenant domain:

- receiver is dormitory account
- amount/reference/time match
- duplicate guard
- N/A/error/timeout manual Owner/Manager review

Platform domain:

- receiver is HorPlus account
- total equals selected duration offer
- verified/Admin review only then activate

## 7. Staging Evidence

บันทึก:

- test case ID/time/environment
- redacted provider request/response hash
- delivery/payment IDs
- outcome/retry
- screenshot เฉพาะที่ไม่เปิด secret/PII

## 8. Production Checklist

- production endpoints/allowlist
- secret manager and rotation owner
- alert webhook/provider failure
- DLQ/reconciliation runbook
- rate/quota limit
- PDPA/privacy notice
- rollback/disconnect plan

