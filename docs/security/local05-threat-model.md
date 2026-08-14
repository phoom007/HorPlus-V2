# HORPLUS LOCAL-05: FORMAL THREAT MODEL & ARCHITECTURE SECURITY ANALYSIS

**Document Version:** 1.0.0  
**Phase:** LOCAL-05 Security & Resilience Audit  
**Date:** 2026-08-14  
**Target Repository:** HorPlus-V2  

---

## 1. Executive Summary

This formal Threat Model defines the security boundaries, asset classifications, adversary profiles, attack surfaces, defensive controls, and residual technical risk boundaries for HorPlus-V2 in accordance with the Phase LOCAL-05 requirements.

HorPlus is a multi-tenant dormitory property management system serving Property Owners, Property Managers, Technicians (TECH), and Dormitory Tenants.

---

## 2. Protected Assets & Sensitivity Classification

| Asset ID | Asset Name | Description & Storage | Confidentiality | Integrity | Availability |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **AST-01** | **Tenant PII** | National ID (encrypted via `SensitiveFieldService` AES-256-GCM), full name, telephone, emergency contacts, ID card photos. | **HIGH** | **HIGH** | MED |
| **AST-02** | **Staff & User Identities** | Google Subject IDs, emails, roles, active memberships, session bindings. | **HIGH** | **HIGH** | **HIGH** |
| **AST-03** | **Dormitory Boundaries** | Multi-tenant tenant boundary isolation (Dormitory A vs Dormitory B). | **CRITICAL** | **CRITICAL** | **HIGH** |
| **AST-04** | **Contracts & Lease Chains** | Lease terms, start/end dates, monthly rent, security deposits, scheduled renewals. | **HIGH** | **CRITICAL** | **HIGH** |
| **AST-05** | **Bills & Payment Records** | Billing cycles, line items, totals, payment slips, verification audits, receipts. | **HIGH** | **CRITICAL** | **HIGH** |
| **AST-06** | **Settlements & Deposits** | Termination settlement calculations (Direction A: Refund, B: Payment, C: Zero). | **HIGH** | **CRITICAL** | **HIGH** |
| **AST-07** | **Meter Readings** | Water & electric previous/present readings, consumption math, rate configurations. | MED | **HIGH** | **HIGH** |
| **AST-08** | **Access Grants & Tokens** | Task009 single-use bearer grant links (SHA-256 hashed), quota slots (max 10). | **CRITICAL** | **CRITICAL** | **HIGH** |
| **AST-09** | **User Sessions & Auth** | AES-256 encrypted session tokens (`horplus_session`), `tokenVersion`, Redis state. | **CRITICAL** | **CRITICAL** | **HIGH** |
| **AST-10** | **Notification & Outbox** | Outbox events, in-app staff/tenant notices, delivery status, swipe-to-dismiss states. | MED | **HIGH** | **HIGH** |
| **AST-11** | **Security Audit Logs** | Immutable structured JSON log events for operational actions and security events. | MED | **HIGH** | MED |
| **AST-12** | **Cryptographic Secrets** | `SESSION_ENCRYPTION_KEY`, `CSRF_SIGNING_KEY`, `FIELD_ENCRYPTION_KEY`. | **CRITICAL** | **CRITICAL** | **HIGH** |

---

## 3. Trust Boundaries

```
+---------------------------------------------------------------------------------------+
| UNTRUSTED EXTERNAL ZONE (Anonymous Internet / Public Browser Clients)                 |
+---------------------------------------------------------------------------------------+
         |
         | [HTTPS / JSON Body / Cookies]
         v
+---------------------------------------------------------------------------------------+
| TRUST BOUNDARY 1: Web Application Ingress / API Gateway (Express 4.21, CORS, CSRF)   |
| - Helmet Security Headers                                                             |
| - Rate Limiter (Auth & Sensitive endpoints)                                           |
| - Cookie Parser & Unified Actor Extraction                                            |
| - CSRF Protection (HMAC-SHA256 double-submit cookie / header verification)             |
+---------------------------------------------------------------------------------------+
         |
         | [Authenticated Session: req.auth & req.actor]
         v
+---------------------------------------------------------------------------------------+
| TRUST BOUNDARY 2: Authorization & Multi-Tenant Scoping (RBAC & Dormitory Boundary)    |
| - RequireSession / RequireAnyAuthenticatedActor Middleware                            |
| - ResolveDormitoryContext Middleware (x-dormitory-id validated against memberships)   |
| - RequireActiveDormitory Middleware                                                   |
| - Role Permissions Matrix (OWNER > MANAGER > TECH > TENANT)                           |
+---------------------------------------------------------------------------------------+
         |
         | [Domain Services & Repositories with Explicit Dormitory ID Scoping]
         v
+---------------------------------------------------------------------------------------+
| TRUST BOUNDARY 3: Data Tier (PostgreSQL 16 & Redis 7 on 127.0.0.1:5455 / 6379)        |
| - PostgreSQL with Row Level Security (horplus_app vs horplus superuser)               |
| - Advisory Transaction Locks (pg_advisory_xact_lock) for concurrency serialization    |
| - Redis Key Expiration & Distributed Locks                                            |
+---------------------------------------------------------------------------------------+
         |
         | [Deferred Adapters / Mock Local Providers]
         v
+---------------------------------------------------------------------------------------+
| TRUST BOUNDARY 4: Deferred External Service Providers                                 |
| - LINE OA / LIFF / Webhook (Local fake adapter only; no live external traffic)        |
| - SlipOK QR / Verification (Local synthetic verifier; no real credentials)            |
+---------------------------------------------------------------------------------------+
```

---

## 4. Adversary Profiles & Threat Scenarios

### ADV-01: Anonymous Internet Attacker
- **Capabilities:** Direct HTTP requests without cookies or credentials.
- **Goals:** Probe public routes (`/api/v1/tenant-registrations`, `/api/v1/auth/google`), attempt unauthenticated access to internal management routes (`/api/v1/properties`, `/api/v1/bills`), flood endpoints (DoS).
- **Primary Defenses:** Explicit 401 fail-closed on unauthenticated requests; Zod validation schema rejecting malformed/oversized inputs; IP rate-limiter; parameterized Prisma queries.

### ADV-02: Authenticated Tenant (Malicious or Curious)
- **Capabilities:** Holds active `TENANT` session cookie for Dormitory A.
- **Goals:** Horizontal privilege escalation (accessing Tenant B's contract, bills, profile, or co-occupant lists); vertical privilege escalation (accessing Owner/Manager APIs or mutating contracts/settlements); Cross-dormitory access to Dormitory B.
- **Primary Defenses:** `resolveTenantContext` derives tenant identity strictly from `req.auth.userId` and DB linkage (never accepts `x-tenant-id`); Tenant routes do not expose other tenants' data; RBAC middleware denies non-tenant endpoints with 403.

### ADV-03: Authenticated Technician (TECH)
- **Capabilities:** Holds active staff session with role `TECH` in Dormitory A.
- **Goals:** Access financial settings, view billing totals, alter contracts, approve settlements, create staff access grants.
- **Primary Defenses:** Granular permission checks (`permission.ts` & `unified-actor.middleware.ts`) blocking `TECH` from contracts, financial settlements, subscription, and staff grant management.

### ADV-04: Compromised Dormitory Owner A attacking Dormitory B
- **Capabilities:** Full `OWNER` privileges in Dormitory A.
- **Goals:** Forge `x-dormitory-id: dorm-b-id` to view rooms, contracts, tenant names, bills, or financial numbers of Dormitory B.
- **Primary Defenses:** `resolveDormitoryContextMiddleware` validates user membership in the target dormitory before granting access; unlinked dormitories return strict 403 Forbidden with zero PII leaks.

### ADV-05: Bearer Link Holder (Task009 Access Grant)
- **Capabilities:** Possesses single-use bearer redemption link generated for staff onboarding.
- **Goals:** Replay redeemed link, redeem expired or revoked link, brute-force grant tokens, escalate role during redemption.
- **Primary Defenses:** Cryptographic SHA-256 token hashing; URL fragment isolation (hash never sent over network); single-use atomic consumption; server-enforced role assignment matching original grant; advisory transaction locking enforcing 10-slot quota.

### ADV-06: Concurrency / Race Condition Exploiter
- **Capabilities:** Sends simultaneous overlapping HTTP requests (e.g. via `Promise.allSettled`).
- **Goals:** Double-approval of registration requests, oversubscribing room capacity, issuing duplicate bills for a single billing cycle, double-redeeming access grants past the 10-slot ceiling.
- **Primary Defenses:** PostgreSQL advisory transaction locks (`pg_advisory_xact_lock`), row-level `SELECT ... FOR UPDATE` locks, and atomic Prisma transactions.

### ADV-07: Malicious File / Input Injector
- **Capabilities:** Submits malicious filenames, overlong strings, negative financial values, malformed dates, or XSS scripts in text fields.
- **Goals:** Cross-Site Scripting (XSS), SQL injection, path traversal in local storage, backend crashes (unhandled exceptions).
- **Primary Defenses:** React virtual DOM auto-escaping; strict HTML entity sanitization on any HTML rendering contexts; Zod schema constraints; path sanitization via basename extraction; global error handler formatting clean 4xx responses without stack traces.

---

## 5. Defense-in-Depth Matrix

| Threat Category | Primary Defense Layer | Secondary Defense Layer | Verification Mechanism |
| :--- | :--- | :--- | :--- |
| **Authentication Bypass** | AES-256 session token decryption with expiration and signature check. | Active DB session lookup verifying `tokenVersion` and user active status. | Unit tests in `local05-security-resilience-audit.test.ts`. |
| **Cross-Dormitory IDOR** | `resolveDormitoryContextMiddleware` membership verification. | Entity-level `dormitoryId` filtering in all Prisma where clauses. | Playwright Journey L & automated IDOR suite. |
| **Tenant IDOR** | `resolveTenantContext` derived directly from session user ID. | Zero authority given to client headers like `x-tenant-id`. | Playwright Journey B & backend unit assertions. |
| **CSRF** | Cryptographic HMAC-SHA256 token verification on all unsafe HTTP methods. | SameSite Lax cookies and CORS origin allowlisting. | Automated CSRF mutation suite. |
| **XSS** | React standard JSX text binding (automatic HTML escaping). | HTML entity escaping on dynamic template strings (e.g. print dialogs). | E2E browser XSS payload test. |
| **SQL Injection** | Prisma ORM type-safe query generation. | Parameterized tagged templates for raw PostgreSQL queries (`$executeRaw\`). | Deep code scan & injection test cases. |
| **Race Conditions** | PostgreSQL advisory transaction locks (`pg_advisory_xact_lock`). | Unique database indexes and transactional rollbacks. | Concurrent `Promise.allSettled` integration tests. |

---

## 6. Suspected Gaps & Audit Objectives for LOCAL-05

1. **XSS in Print View:** Document-write template string in `src/pages/owner/tenants.tsx:1338` requires HTML entity escaping.
2. **Raw Unsafe Query Refactoring:** Refactor `$executeRawUnsafe` in `occupancy.service.ts` to type-safe parameterized `$executeRaw\`...\`` template tag.
3. **Session Revocation Consistency:** Adversarially verify that revoked grants, suspended users, and expired sessions immediately fail closed across all protected endpoints.
4. **CSRF Coverage:** Verify that all state-changing endpoints (POST, PUT, PATCH, DELETE) reject requests lacking valid CSRF tokens.
5. **Multi-Tenancy & Zero Leaks:** Adversarially verify that Dormitory A actors requesting Dormitory B resources receive strict 403 denials with zero leaked PII.
