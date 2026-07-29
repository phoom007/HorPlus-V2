# ADR-009 — Idempotency

Status: Accepted

## Decision

Mutation ที่สร้างผลถาวรใช้ idempotency record + database unique constraint + transaction

## Coverage

- dormitory provision
- contract activate
- bill generate/issue
- payment submit/approve
- receipt issue
- LINE send
- package activate

same key/digest คืนผลเดิม; same key/different digest = conflict Idempotency record เก็บ response ที่ redact แล้วและมี retention ตาม domain

