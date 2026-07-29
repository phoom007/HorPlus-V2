# Frontend–Backend Integration Map

สถานะในตาราง:

- `EXISTS`: route/service มีใน repository
- `CHANGE`: มีแต่ contract ต้องแก้ตาม lock
- `ADD`: ยังต้องสร้าง
- `VERIFY`: ต้องทดสอบกับ PostgreSQL/RLS จริง

## 1. Identity and Workspace

| UI Flow | API | Permission | Status |
|---|---|---|---|
| Owner Google bootstrap | `POST /api/v1/auth/google` + onboarding | Guest | CHANGE: จำกัดเป็น first registration |
| Current session | `GET /api/v1/auth/session` | Session | EXISTS |
| Memberships/dorm selector | `GET /api/v1/me/memberships` | Session | CHANGE: selector from second |
| LIFF session | LIFF session routes | LINE identity | EXISTS/VERIFY |
| Owner recovery | dedicated recovery case | Owner/Admin | ADD |

## 2. Onboarding/Subscription

| UI | API | Status |
|---|---|---|
| Onboarding draft | `/api/v1/onboarding/draft` | EXISTS |
| Promo validate | `/api/v1/onboarding/promo/validate` | CHANGE: 100 atomic |
| Complete provisioning | `/api/v1/onboarding/complete` | CHANGE: defaults/package/optional OA |
| Offers | `/api/v1/public/plans` | CHANGE: duration total price |
| Package invoice/payment | platform finance endpoints | ADD |
| Current entitlement | dorm subscription endpoint | CHANGE: free/paid/expiry |

## 3. Property

| UI | API | Status |
|---|---|---|
| Building list/create/update/delete | `/api/v1/properties/buildings*` | EXISTS/VERIFY |
| Room list/detail/create/update/delete | `/api/v1/properties/rooms*` | CHANGE: building required + unique/building |
| Available rooms | `/api/v1/properties/rooms/available` | CHANGE: reservation window |
| Defaults preview/apply | dorm/building/room defaults endpoints | ADD |

## 4. Tenant/Contract

| UI | API | Status |
|---|---|---|
| Owner tenant CRUD | `/api/v1/tenants*` | EXISTS/VERIFY |
| Co-occupant | `/api/v1/tenants/:id/co-occupants` | CHANGE: name/phone only required |
| LINE tenant registration | registration routes | EXISTS/CHANGE docs/signature |
| Review approve/edit/reject | registration routes | CHANGE: diff/reason/notify |
| Contract CRUD/activate/extend/terminate | `/api/v1/contracts*` | EXISTS/CHANGE snapshot |
| Installments/deposit | contract finance endpoints | ADD |
| Move-out preview/confirm | occupancy/contract endpoints | ADD/CHANGE |

## 5. Meter/Billing

| UI | API | Status |
|---|---|---|
| Billing cycles | `/api/v1/billing-cycles*` | EXISTS |
| Meter devices/readings/replacement | `/api/v1/meters*` | EXISTS/VERIFY |
| Bill preview/generate/bulk | `/api/v1/bills/preview`, `/generate*` | EXISTS/CHANGE |
| Bill list/detail/summary | `/api/v1/bills*` | EXISTS |
| Issue Draft | `/api/v1/bills/:id/issue` | ADD |
| Void unpaid | `/api/v1/bills/:id/void` | CHANGE from cancel |
| Revert unissued from meter | dedicated endpoint | ADD |

## 6. Payment/Receipt

| UI | API | Status |
|---|---|---|
| Payment list/detail | `/api/v1/payments*` | EXISTS |
| Cash/transfer create | payment routes | EXISTS/VERIFY |
| Upload intent/confirm | payment-evidence + tenant portal | EXISTS/CHANGE storage |
| Approve/reject/manual override | payment routes | CHANGE permission/reason |
| Receipt list/print/generate | `/api/v1/receipts*` | EXISTS/VERIFY idempotency |
| Adjustment/refund | dedicated endpoints | ADD |

## 7. LINE

| UI | API | Status |
|---|---|---|
| OA setup/check/connect | integration routes | EXISTS/VERIFY external |
| Webhook | webhook route | EXISTS/VERIFY signature/raw body |
| Staff role assignment | staff-role routes | CHANGE 3 roles/10 total |
| Quota | line quota routes | CHANGE Free30/Paid300 |
| Send preview/command/status | LINE message endpoints | ADD/CHANGE outbox |
| Tenant portal | `/api/v1/tenant/*` | EXISTS/VERIFY binding |

## 8. Operations

| UI | API | Status |
|---|---|---|
| Maintenance | `/api/v1/maintenance-requests*` | EXISTS/CHANGE auth/assignment |
| Announcements | `/api/v1/announcements*` | EXISTS/CHANGE auth/audience |
| Notifications | `/api/v1/notifications*` | EXISTS/CHANGE role |
| Audit | audit query endpoints | ADD/CHANGE |

## Adapter Rules

- frontend ใช้ data contracts/adapters ไม่ import server repository
- Demo adapter แยก namespace/session จาก API adapter
- server error code map เป็น Thai UX message
- optimistic UI ใช้ได้เฉพาะ reversible non-financial action
- financial/approval/send action รอ server canonical response

## Integration Done

- ไม่มี direct localStorage เป็น source ใน API mode
- deep-link refresh session/dorm/role ถูก
- permission ซ่อน UI และ server deny จริง
- contract tests ตรวจ request/response/status/error
- every `ADD/CHANGE/VERIFY` ปิดก่อน Core Gate 11

