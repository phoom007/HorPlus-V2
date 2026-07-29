# 14. Deployment and Operations

## 1. Environments

| Environment | Purpose | External credentials |
|---|---|---|
| Dev/AI Studio | UI/code/unit | mock only |
| Local integration | DB/Redis/RLS | test credentials |
| Staging | end-to-end | sandbox/dedicated |
| Production | real users | production secret manager |

ห้ามใช้ production LINE/SlipOK secret ใน AI Studio

## 2. Pipeline

```text
lint → unit → build → migration validate
→ integration/RLS → image scan
→ deploy migration expand
→ deploy API/Worker/Web
→ smoke → progressive traffic
→ post-deploy reconciliation
```

## 3. Release Safety

- backward-compatible migration
- health/readiness
- canary/progressive deploy
- idempotent worker
- pause queue ก่อน breaking deployment
- feature flags สำหรับ provider integrations
- rollback code ไม่ rollback financial state ด้วย delete

## 4. Backup and Recovery

- PostgreSQL automated backup + PITR
- restore drill ตามรอบ
- object storage version/lifecycle
- encrypted backup access least privilege
- RPO/RTO กำหนดก่อน launch จากผลโหลดจริง

## 5. Scheduled Jobs

- billing draft generation
- due/overdue transition
- LINE cycle lazy/scheduled creation
- subscription expiry
- cleanup unconfirmed uploads
- reconciliation SlipOK/LINE

Jobs ใช้ timezone explicit `Asia/Bangkok`; DB timestamp เก็บ UTC

## 6. Runbooks

ต้องมี:

- DB outage/pool exhaustion
- RLS incident
- LINE outage/webhook storm
- SlipOK outage/manual review
- quota reservation stuck
- duplicate financial document
- package activation failure
- owner account recovery
- lost/corrupt object

## Acceptance Criteria

- fresh staging deploy จาก migration ศูนย์ผ่าน
- rolling deploy ไม่ทำ request/worker duplicate
- backup restore ใช้งานได้
- secret rotation LINE/SlipOK/DB documented
- rollback/recovery drill ไม่ทำ financial audit หาย

