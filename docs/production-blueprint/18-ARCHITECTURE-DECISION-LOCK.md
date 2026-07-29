# 18. Architecture Decision Lock

นี่คือ checklist สั้นที่ agent ต้องตรวจทุกงาน

## Stack

- React 19 + TypeScript + Vite
- Node.js + Express + Zod
- PostgreSQL + Prisma
- Redis/queue worker
- private object storage
- Cloudflare CDN/WAF หน้า Web

## Identity

- Google = first Owner registration/bootstrap
- LINE OA/LIFF = subsequent Owner/Manager/Tech และ Tenant
- Tenant Google Login = forbidden production flow

## Multi-tenancy

- dormitory-scoped rows + RLS
- transaction `SET LOCAL`
- no `BYPASSRLS`
- server-resolved actor/dormitory

## Product

- 3 roles only
- total 10 staff accounts/dorm
- room belongs to building
- unique room per building
- per-dorm LINE OA
- Free 10 rooms/30 sends
- Paid 150 rooms/300 sends
- total package prices locked
- immediate expiry restricted

## Finance

- Tenant and Platform domains separate
- Decimal money
- Draft→Issue
- no hard delete financial history
- paid bill uses adjustment/refund
- SlipOK override reason mandatory
- receipt idempotent

## Scope

- Core first
- Public Dormitory/SEO future
- AI Studio infrastructure status never inferred

## Reject Conditions

PR/agent output ต้องถูก reject หาก:

- เพิ่ม FINANCE/STAFF role
- ใช้ Shared LINE OA
- ให้ Tenant Google login
- ทำ room building optional
- ใช้ old 25/50/100/200/unlimited tiers
- เรียกราคา 189–2,999 ว่าต่อเดือน
- เพิ่ม 7-day package grace
- Tenant เห็น Draft
- Tech เห็น Finance
- เชื่อ client amount/role/dormitory

