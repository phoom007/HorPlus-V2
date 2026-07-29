# ADR-002 — Database and ORM

Status: Accepted

## Decision

ใช้ PostgreSQL + Prisma โดยใช้ Decimal สำหรับเงิน, migration files เป็นแหล่ง deploy และใช้ PostgreSQL constraints/RLS เป็น defense-in-depth

## Rules

- ห้าม production `db push`
- transaction สำหรับ multi-write invariant
- raw SQL ใช้ได้เฉพาะ RLS/constraint/query ที่ Prisma ไม่รองรับ พร้อม test
- Prisma schema ไม่ถือว่า deploy จน migration ผ่าน
- runtime DB role ไม่มี `BYPASSRLS`

