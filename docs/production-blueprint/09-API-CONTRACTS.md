# 09. API Contracts

Base path: `/api/v1`

## 1. Envelope

Success:

```json
{
  "data": {},
  "meta": { "requestId": "..." }
}
```

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "ข้อมูลไม่ถูกต้อง",
    "fieldErrors": {},
    "requestId": "..."
  }
}
```

ห้ามส่ง stack trace, SQL, token หรือ provider secret

## 2. Common Headers

- session cookie
- `X-CSRF-Token` สำหรับ mutation
- `Idempotency-Key` สำหรับ create/financial/send operations
- `If-Match` หรือ `version` สำหรับ optimistic update
- dormitory selector ส่งได้เป็น hint แต่ server ต้อง resolve membership

## 3. Required Resource Groups

### Identity

- `POST /auth/google/bootstrap`
- `POST /auth/liff`
- `GET /session`
- `POST /logout`
- `POST /logout-all`

### Dormitory/Property

- `GET /dormitories`
- `POST /dormitories`
- CRUD `/dormitories/:id/buildings`
- CRUD `/dormitories/:id/rooms`
- defaults preview/apply endpoints

### Membership

- list/create/revoke memberships
- role fixed OWNER/MANAGER/TECH
- create must enforce 10 total atomically
- recovery requires dedicated endpoint/step-up

### Tenant Registration

- public LIFF form config
- available rooms
- draft/submit
- owner/manager review/edit/approve/reject
- owner-created tenant

### Contract/Deposit

- create/preview/sign/approve/activate
- installment preview/update
- deposit charge/payment/credit/refund
- move-out preview/confirm

### Meter/Bill

- meter readings bulk
- draft preview/generate
- issue/void
- revert unissued meter draft
- adjustments/refunds

### Payment/Receipt

- upload intent/confirm
- SlipOK status
- manual review with reason
- cash payment
- receipt print data

### LINE

- integration draft/check/connect/disconnect
- quota/current
- message preview/send/status
- webhook endpoint separated from authenticated API

### Subscription

- offers
- trial/promo validate/redeem
- invoice/upload/payment status
- entitlement/current

## 4. Authorization Conventions

- 401: no/invalid identity
- 403: identity valid but no permission
- 404: resource unavailable in authorized scope
- 409: duplicate/state/version/limit conflict
- 422: business validation
- 429: rate limit or message quota with distinct error code

## 5. Idempotency

ใช้กับ:

- dormitory provision
- contract activate
- bill generate/issue
- payment create/approve
- receipt issue
- LINE send
- platform package activate

same key+same payload → same response  
same key+different payload → 409

## Acceptance Criteria

- OpenAPI/route implementation/status/error codeตรงกัน
- endpoint ทุกตัวระบุ actor/permission/idempotency/audit
- unknown privileged fields ถูก reject
- list pagination/filter bounded
- cross-dorm resource IDs ไม่เปิดข้อมูล

