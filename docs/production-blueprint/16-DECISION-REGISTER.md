> [!WARNING]
> **[STATUS: SUPERSEDED]**
> This document is entirely superseded. Always refer to **[21-CURRENT-PRODUCT-RULE-LOCK.md](./21-CURRENT-PRODUCT-RULE-LOCK.md)** as the absolute source of truth.

# 16. Decision Register

| ID | Decision | Status |
|---|---|---|
| DEC-001 | Node.js/Express API + PostgreSQL/Prisma | LOCKED |
| DEC-002 | PostgreSQL RLS + application permission guard | LOCKED |
| DEC-003 | Owner bootstrap Google; later role access LINE/LIFF; Tenant LINE/LIFF only | LOCKED |
| DEC-004 | LINE OA แยกต่อหอพัก | LOCKED |
| DEC-005 | roles = OWNER/MANAGER/TECH | LOCKED |
| DEC-006 | ทุก role รวมสูงสุด 10 accounts/dorm; one role/user/dorm | FINAL-A |
| DEC-007 | every room belongs to building; unique per dormitory | SUPERSEDED |
| DEC-008 | dorm→building→room defaults; contract snapshot | LOCKED |
| DEC-009 | Free 1 dorm/10 rooms/30 sends; Paid max 150/300 | LOCKED |
| DEC-010 | Paid 1/3/6/12/24 = 189/529/999/1,799/2,999 total incl VAT | LOCKED |
| DEC-011 | Trial 30 + HORPLUS 60, capacity 100 configurable | LOCKED |
| DEC-012 | Paid account max 10 dorms configurable; selector from second dorm | LOCKED |
| DEC-013 | no package grace; immediate restricted | LOCKED |
| DEC-014 | scheduled bill creates Draft; manual Issue | LOCKED |
| DEC-015 | unpaid void without hard delete; paid adjustment/refund | LOCKED |
| DEC-016 | deposit separate bill; refundable or rent-credit | LOCKED |
| DEC-017 | Owner/Manager SlipOK override with reason | LOCKED |
| DEC-018 | Package activates only after SlipOK/Admin verified | LOCKED |
| DEC-019 | LINE quota counts successful recipients; Reply free | LOCKED |
| DEC-020 | Public Dormitory/SEO deferred until core production-ready | LOCKED |

## Change Control

การเปลี่ยน decision ต้องมี:

- owner approval
- reason/business impact
- migration impact
- security/financial impact
- affected documents/tests
- effective date/version

Agent ห้ามเพิ่มบทบาท/ราคา/Grace/Public scope เอง


