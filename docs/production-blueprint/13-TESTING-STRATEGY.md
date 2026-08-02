> [!NOTE]
> **[STATUS: CURRENT]**
> Refer to **[21-CURRENT-PRODUCT-RULE-LOCK.md](./21-CURRENT-PRODUCT-RULE-LOCK.md)** for absolute precedence.

# 13. Testing Strategy

## 1. Test Pyramid

| Layer | เป้าหมาย |
|---|---|
| Unit | calculator, state machine, entitlement, permission, normalization |
| Service | invariant + mocked repository/provider |
| API integration | Express + PostgreSQL + RLS + Redis |
| Contract | Frontend adapter ↔ API/OpenAPI |
| E2E | Owner/Manager/Tech/Tenant workflows |
| Staging external | Google, LINE, SlipOK, storage, webhook |
| Security | IDOR, CSRF, injection, replay, race, file access |

## 2. Required Scenarios

### Identity/Role

- first Owner Google registration
- one dorm direct / second dorm selector
- LINE role binding
- 10 accounts accepted; 11th concurrent rejected
- one role per user/dorm
- recovery revokes old binding/session

### Property

- same room number different building accepted
- duplicate same building rejected
- room without building rejected
- default change affects only rooms without active contract
- contract snapshot unchanged

### Tenant/Contract

- permanent LINE registration button
- incomplete required docs blocked
- room race: two applicants same room only valid outcome
- approve/edit/reject/resubmit
- signature evidence verified
- future reservation after move-out boundary

### Billing

- meter validation/replacement
- scheduled Draft hidden from Tenant
- Issue makes visible
- revert unissued draft from meter window
- unpaid void with reason
- paid void denied, adjustment/refund accepted
- installment rounding
- deposit paid-before-LINE and portal payment

### Payment

- duplicate file/reference/QR
- SlipOK match/mismatch/N/A/timeout
- Owner/Manager override reason
- Tech denied
- concurrent approve one receipt
- Tenant/Platform domain separation

### Subscription/LINE

- all duration/price pairs
- promo first 100; concurrent 101st denied
- Free 10/30; Paid 150/300
- expiry immediate restricted
- LINE mixed success count
- monthly reset Bangkok

### Move-out

- confirm at end date or earlier
- final settlement/receipt
- binding revoked
- room vacant
- Tenant old portal denied; Owner history retained

## 3. AI Studio Compatibility

AI Studio run:

- lint/build/unit/static
- adapter tests
- demo regression

External required:

- Docker/PostgreSQL/Redis
- migration/RLS/concurrency
- shutdown/worker

Staging required:

- real Google/LINE/SlipOK/object storage

## 4. Quality Gates

- P0/P1 unresolved = no production release
- flaky test = failure until quarantined with owner/reason/deadline
- coverage numberอย่างเดียวไม่พอ ต้องมี scenario matrix
- snapshots ห้ามแทน assertions ธุรกิจ

## Acceptance Criteria

- ทุก Locked Rule มีอย่างน้อยหนึ่ง positive และ negative test
- cross-dorm test ครบทุก resource family
- race test สำหรับ slot/quota/promo/bill/payment/receipt
- external test ที่ไม่ได้รันระบุ `EXTERNAL VERIFICATION REQUIRED`
- test data ไม่ใช้ production PII/secret


