> [!NOTE]
> **[STATUS: CURRENT]**
> Refer to **[21-CURRENT-PRODUCT-RULE-LOCK.md](./21-CURRENT-PRODUCT-RULE-LOCK.md)** for absolute precedence.

# 11. Audit Log and Observability

## 1. Audit vs Application Log

- Audit: หลักฐานการกระทำทางธุรกิจ/สิทธิ์ เก็บแบบ append-only
- Application log: วิเคราะห์ระบบ ลบ/rotate ได้ตาม retention
- Metric/trace: สุขภาพ latency/error/queue โดยไม่เก็บ PII

## 2. Mandatory Audit Events

- login/logout/recovery/session revoke
- membership create/role change/revoke และ limit rejection
- dormitory/building/room defaults/override
- tenant submit/edit/approve/reject/resubmit
- contract sign/activate/change/move-out
- meter create/edit/replacement
- bill generate/issue/void/reissue
- deposit pay/credit/refund/deduct
- payment submit/SlipOK result/manual override
- receipt issue/correct
- LINE connect/disconnect/send/quota reservation/result/reset
- subscription promo/payment/activate/expire/restrict
- sensitive file view/download

## 3. Audit Schema

```text
event_id, occurred_at, request_id
actor_type, actor_id, actor_role
dormitory_id
action, resource_type, resource_id
before_hash, after_hash, redacted_diff
reason, idempotency_key_hash
source, ip_hash, user_agent_hash
```

ห้ามเก็บ secret, full national ID, full bank account, raw token หรือ raw slip payload

## 4. Operational Signals

Metrics:

- request rate/error/latency by route family
- DB pool saturation/slow query/deadlock
- queue depth/age/retry/DLQ
- SlipOK availability/mismatch/review rate
- LINE success/failure/quota reserve leak
- bill generation count/failure
- package activation/expiry
- cross-dorm authorization denial spike

## 5. Alerts

P0:

- suspected cross-dorm access
- duplicate receipt/payment approval
- RLS missing/bypass
- database unavailable/data corruption

P1:

- webhook signature failure spike
- quota negative/reservation stuck
- bill scheduler missed
- SlipOK/LINE outage
- backup failure

## 6. Correlation

HTTP → DB transaction → outbox → worker → provider callback ต้อง trace ด้วย request/command/correlation IDs โดยไม่ใช้ provider secret เป็น ID

## Acceptance Criteria

- audit row update/delete ด้วย app role ไม่ได้
- manual override ทุกครั้งค้น actor/reason ได้
- log redaction test ผ่าน
- alert test ใช้ synthetic event ได้
- retry สร้าง audit business event ครั้งเดียวหรือมี retry metadata ไม่สร้างผลลัพธ์ซ้ำ


