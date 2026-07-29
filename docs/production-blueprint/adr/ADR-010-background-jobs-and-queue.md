# ADR-010 — Background Jobs and Queue

Status: Accepted

## Decision

ใช้ Redis + BullMQ-compatible queues แยก billing, LINE, SlipOK, document และ reconciliation

## Rules

- job payload ใช้ ID ไม่ใส่ secret/PII
- retry bounded exponential backoff
- dead-letter + alert
- idempotent handler
- cron timezone explicit Asia/Bangkok
- quota cycle มี lazy creation เพื่อไม่พึ่ง cron จุดเดียว

