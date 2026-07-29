# ADR-004 — Multi-tenancy and RLS

Status: Accepted

## Decision

ใช้ shared PostgreSQL schema โดยทุก dormitory-owned row มี `dormitory_id`; บังคับ application authorization + PostgreSQL RLS ผ่าน transaction `SET LOCAL`

## Consequences

- ไม่รับ dormitory ID จาก client เป็น authority
- pooled connection ต้องมี leakage test
- cross-dorm worker ต้อง iterate explicit dormitory context
- system service role จำกัดเฉพาะ job
- RLS policy และ application query scope ต้องทดสอบทั้งคู่

