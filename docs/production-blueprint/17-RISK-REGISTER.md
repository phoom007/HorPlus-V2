# 17. Risk Register

| ID | Risk | Severity | Mitigation / Gate |
|---|---|---:|---|
| RSK-01 | Cross-dorm data leak | Critical | RLS + scoped query + matrix test |
| RSK-02 | Client tampers amount/role/quota | Critical | Server recompute + strict schema |
| RSK-03 | Duplicate bill/payment/receipt | Critical | DB unique + idempotency + transaction |
| RSK-04 | Legacy roles retain excessive permission | High | migration mapping + report + deny by default |
| RSK-05 | Room uniqueness change breaks legacy | High | backfill building + duplicate remediation |
| RSK-06 | 11th staff created concurrently | High | row/advisory lock + transaction test |
| RSK-07 | Promo redemption exceeds 100 | Medium | atomic counter/unique redemption |
| RSK-08 | LINE quota oversubscribed | High | reservation ledger + reconciliation |
| RSK-09 | Slip reused | High | SHA/QR/reference unique guard |
| RSK-10 | SlipOK outage | Medium | retry + manual review; no auto-approve |
| RSK-11 | LINE outage/webhook replay | Medium | signature/idempotency/backoff/DLQ |
| RSK-12 | Sensitive files exposed | Critical | private storage + short signed URL + audit |
| RSK-13 | Owner loses LINE | High | multi-owner/recovery case/revoke old binding |
| RSK-14 | Paid expiry disrupts operation | Medium | advance warning + history/renewal-only restricted |
| RSK-15 | Deposit double refund/credit | High | ledger + paid balance + idempotency |
| RSK-16 | Tenant sees previous tenant data | Critical | binding+contract scope + move-out revoke |
| RSK-17 | AI Studio falsely reports infrastructure passed | Medium | verification levels and explicit external flag |
| RSK-18 | Public/SEO distracts core | Medium | roadmap gate/deferred enforcement |
| RSK-19 | Queue retry sends LINE twice | High | delivery identity/provider reconciliation |
| RSK-20 | Scale cost at >10k dorms | Medium | per-dorm metrics, stateless scale, bounded jobs |

## Release Rule

- Critical open risk = no release
- High risk requires verified mitigation or explicit owner-approved temporary control
- Accepted risk ต้องมี owner, reason, expiry/review date

