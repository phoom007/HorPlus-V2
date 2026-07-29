# File Manifest

Expected replacement tree:

```text
docs/
├── README.md
├── REQUIREMENTS-LOCK.md
├── AI-AGENT-EXECUTION-RULES.md
├── HORPLUS-PRODUCTION-BLUEPRINT-CONSOLIDATED.md
├── FILE-MANIFEST.md
├── production-blueprint/
│   ├── 00-EXECUTIVE-SUMMARY.md
│   ├── 01-CURRENT-STATE-AUDIT.md
│   ├── 02-TARGET-ARCHITECTURE.md
│   ├── 03-DOMAIN-AND-DATA-MODEL.md
│   ├── 04-MULTI-TENANCY-AND-AUTHORIZATION.md
│   ├── 05-AUTHENTICATION-SESSION-SECURITY.md
│   ├── 06-SUBSCRIPTION-TRIAL-ENTITLEMENT.md
│   ├── 07-BILLING-PAYMENT-SLIPOK.md
│   ├── 08-LINE-MESSAGING-QUOTA.md
│   ├── 09-API-CONTRACTS.md
│   ├── 10-FILE-STORAGE-AND-DOCUMENTS.md
│   ├── 11-AUDIT-LOG-OBSERVABILITY.md
│   ├── 12-DATA-MIGRATION-PLAN.md
│   ├── 13-TESTING-STRATEGY.md
│   ├── 14-DEPLOYMENT-OPERATIONS.md
│   ├── 15-IMPLEMENTATION-ROADMAP.md
│   ├── 16-DECISION-REGISTER.md
│   ├── 17-RISK-REGISTER.md
│   ├── 18-ARCHITECTURE-DECISION-LOCK.md
│   ├── 19-BLUEPRINT-CONSISTENCY-AUDIT.md
│   ├── 20-PRODUCTION-ROUTING-AND-ONBOARDING.md
│   └── adr/
│       ├── ADR-001-backend-framework.md
│       ├── ADR-002-database-and-orm.md
│       ├── ADR-003-authentication-and-session.md
│       ├── ADR-004-multi-tenancy-and-rls.md
│       ├── ADR-005-contract-date-boundary.md
│       ├── ADR-006-money-and-rounding.md
│       ├── ADR-007-owner-and-tenant-onboarding.md
│       ├── ADR-008-platform-financial-domain.md
│       ├── ADR-009-idempotency.md
│       ├── ADR-010-background-jobs-and-queue.md
│       └── ADR-011-object-storage-and-region.md
├── security/
│   └── SECURITY-CONTRACTS.md
├── integration/
│   └── FRONTEND-BACKEND-INTEGRATION-MAP.md
└── integrations/
    └── LINE-OA-LIFF-EXTERNAL-COMPLETION-NOTES.md
└── execution/
    ├── 00-START-HERE.md
    ├── 01-MASTER-EXECUTION-ROADMAP.md
    ├── 02-GATE-PROTOCOL.md
    ├── 03-BASELINE-CURRENT-STATE.md
    ├── 04-LOCALHOST-STARTUP.md
    ├── 05-DATA-MIGRATION-CONTRACT.md
    ├── 06-DEMO-SEED-CONTRACT.md
    ├── 07-CROSS-PORTAL-CONSISTENCY-CONTRACT.md
    ├── 08-CROSS-PORTAL-STATE-MATRIX.md
    ├── 09-CROSS-PORTAL-E2E-MATRIX.md
    ├── 10-API-UI-OWNERSHIP-MAP.md
    ├── 11-DEFECT-REGISTER.md
    ├── 12-TEST-EVIDENCE-HANDOFF.md
    ├── 13-ROLLBACK-RECOVERY.md
    └── tasks/
        ├── README.md
        └── TASK-001 … TASK-018
```

Total expected Markdown files: 73 (40 baseline blueprint + 33 execution documents)

Installation:

1. สำรอง `/docs` เดิมหากต้องการ
2. ลบ `/docs` เดิมทั้งโฟลเดอร์
3. แตก ZIP ที่ root ของ repository เพื่อให้ได้ `/docs`
4. ตรวจว่ามีไฟล์ 73 รายการและไม่มีไฟล์เก่าค้าง
