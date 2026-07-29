# ADR-003 — Authentication and Session

Status: Accepted

## Decision

- Google OIDC ใช้ bootstrap Owner ครั้งแรก
- LINE OA/LIFF ใช้ Owner/Manager/Tech หลัง setup และ Tenant
- ใช้ first-party opaque server session ผ่าน secure HttpOnly cookie

## Consequences

- Tenant Google Login ไม่ใช่ production flow
- role/binding revoke ต้อง revoke/revalidate session
- cookie mutation ใช้ CSRF
- LIFF token ตรวจฝั่ง server กับ issuer/audience/nonce/replay policy

