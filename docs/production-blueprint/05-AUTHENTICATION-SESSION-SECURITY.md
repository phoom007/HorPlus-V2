# 05. Authentication, Session and Security

## 1. Identity Flows

### Owner Bootstrap

1. เปิดเมนู `ลงทะเบียน`
2. Google OIDC Authorization Code + PKCE
3. Backend ตรวจ issuer, audience, nonce, state
4. สร้าง User + first Dormitory + Owner membership ใน transaction
5. เมื่อเชื่อม LINE OA ให้ bind Owner LINE identity กับ membership

Google Login ไม่ใช่ Tenant Login

### Staff/Owner subsequent access

- เปิดจาก LINE OA/LIFF
- Backend ตรวจ LIFF/LINE Login token กับ LINE server
- resolve `line_role_assignment`
- ออก first-party session cookie

### Tenant

- เข้า LINE OA/LIFF
- ตรวจ follower/identity/binding
- ก่อน approve เข้าหน้าลงทะเบียน; หลัง approve เข้าพอร์ทัล

## 2. Session

- opaque random session ID; เก็บ hash ฝั่ง server
- cookie `HttpOnly`, `Secure`, `SameSite=Lax` หรือเข้มกว่าตาม flow
- rotate เมื่อ login, role/binding เปลี่ยน และ step-up
- revoke all sessions เมื่อ recovery, compromise หรือ user disabled
- absolute/sliding lifetime เป็น security config ไม่เกี่ยวกับ package expiry

## 3. CSRF/XSS/CORS

- mutation cookie-authenticated ใช้ CSRF token + Origin/Referer allowlist
- CSP และ output encoding
- ห้าม render user HTML ตรง
- CORS allowlist เฉพาะ production origins
- upload response ห้ามสะท้อน filename/header ที่ไม่ sanitize

## 4. Request Tampering

Server ต้อง ignore/recalculate:

- price, subtotal, total, discount
- role/permission
- room/message quota
- bill/payment/receipt status
- deposit credit/refund
- dormitory ownership

ใช้ Zod strict schema เพื่อตัด unknown privileged fields

## 5. Rate Limit

แยก bucket:

- auth/OTP/recovery
- tenant registration
- upload/slip verification
- LINE webhook
- ordinary API
- package promo validation

Rate limit ไม่แทน quota และต้องไม่ทำให้ webhook retry สูญหาย

## 6. Secret and PII

- Secret manager สำหรับ Google, LINE, SlipOK, DB, encryption keys
- field encryption สำหรับ channel secret, access token cache, bank/PromptPay, national ID
- key version + rotation
- log ต้อง redact token, cookie, full account, national ID, slip payload

## Acceptance Criteria

- replay OIDC/LIFF/webhook ใช้ซ้ำไม่ได้
- forged dormitory/role/amount ถูกปฏิเสธหรือไม่ถูกนำไปใช้
- CSRF test ผ่านทุก mutation
- secret ไม่อยู่ใน frontend bundle/repo/log
- role revoke/recovery ทำ session เดิมใช้ต่อไม่ได้
- Tenant ไม่มี Google auth route เป็นทางเข้า production

