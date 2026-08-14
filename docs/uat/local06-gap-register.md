# HorPlus Gap Register & Acceptance Verification (LOCAL-06)

This document tracks all functional, security, and integration gaps identified across Waves LOCAL-01 through LOCAL-05 and certifies their complete closure for LOCAL-06.

---

## Gap Register Table

| Gap ID | Severity | Role | Domain / Page | Reproduction Summary | Expected Behavior | Actual Behavior Prior to Fix | Root Cause | Resolution & Verification | Regression Test | Final Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **GAP-001** | HIGH | TENANT | Co-Occupants / Profile | Adding co-occupants from tenant portal threw schema constraint error | Co-occupants should save and persist to `tenant_co_occupants` table | HTTP 500 DB schema mismatch | Unmapped columns in co-occupant insert payload | Fixed in LOCAL-01: added proper adapter mapping and validation | `tests/e2e/local01-tenant-onboarding-cooccupants.spec.ts` | RESOLVED (PASS) |
| **GAP-002** | HIGH | OWNER / TENANT | Contract Renewal & Settlement | Terminating contract did not reconcile deposit damage charges | Net deposit refund/charge calculation and settlement record created | Contract ended without settlement audit trail | Missing settlement transaction service | Fixed in LOCAL-02: implemented authoritative `settlements` service & UI modal | `tests/e2e/local02-contract-settlement-renewal.spec.ts` | RESOLVED (PASS) |
| **GAP-003** | MEDIUM | OWNER / TECH | Outbox & Staff Retry | Outbox event delivery failed on first attempt if worker was cold | Outbox worker should retry with exponential backoff and isolate failures | Outbox event remained locked in PENDING | Missing retry scheduler and error isolation | Fixed in LOCAL-03: added transactional outbox retry worker & failure isolation | `tests/e2e/local03-notification-outbox-operations.spec.ts` | RESOLVED (PASS) |
| **GAP-004** | HIGH | MULTI-ROLE | Cross-Portal Lifecycle | Tenant slip upload did not immediately update Owner Checking queue | State change should propagate in real-time and persist across F5 reload | Required manual browser restart | Desynchronized state polling | Fixed in LOCAL-04: wired live data synchronization and state reconciliation | `tests/e2e/local04-cross-portal-lifecycle.spec.ts` | RESOLVED (PASS) |
| **GAP-005** | CRITICAL | SYSTEM | Security & Resilience | Rate limiter could be bypassed with query strings; Redis failure crashed requests | Rate limiter keys normalized on `req.path`; Redis fail-closed fallback | Key explosion via query params; unhandled Redis disconnect | Express proxy key generation; unhandled redis connection error | Fixed in LOCAL-05: normalized path keys, fallback rate limiter, failure-isolated scheduler | `tests/e2e/local05-security-resilience.spec.ts` | RESOLVED (PASS) |
| **GAP-006** | LOW | TECH | RBAC Navigation | Tech role saw restricted menu items in sidebar | Tech role sidebar filtered to only Dashboard, Meters, Maintenance | All menus rendered without role filter | Client sidebar lacked role filter | Fixed in LOCAL-05/06: implemented fail-closed role-based menu filtering | `tests/e2e/local06-master-local-uat.spec.ts` | RESOLVED (PASS) |
| **GAP-007** | MEDIUM | OWNER | Property Defaults Concurrency | Simultaneous edits to property defaults overwrote each other silently | Optimistic locking with version check & conflict modal | Silent overwrite (last write wins) | Missing version column in defaults table | Fixed in Wave 1G: added version column, OCC preview, and conflict resolution modal | `tests/e2e/wave1g-property.spec.ts` | RESOLVED (PASS) |
| **GAP-008** | MEDIUM | OWNER | Contract Overwrite Guard | Creating contract for occupied room silently replaced active contract | Forced replacement warning modal requiring explicit confirmation | Accidental contract replacement | Missing active contract precondition check | Fixed in Wave 1: implemented forced replacement guard modal & snapshot archiving | `tests/e2e/local06-master-local-uat.spec.ts` | RESOLVED (PASS) |

---

## Gap Summary

- **Total Tracked Gaps**: 8
- **Resolved Gaps**: 8
- **Open Blocker Gaps**: 0
- **Regression Test Coverage**: 100% automated test coverage across all resolved items
- **Acceptance Verdict**: ALL GAPS CLOSED — READY FOR MASTER LOCAL SIGN-OFF
