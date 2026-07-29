# ADR-005 — Contract Date Boundary

Status: Accepted

## Decision

เก็บวันที่สัญญาเป็น local civil date ของ `Asia/Bangkok`; timestamp event เก็บ UTC Contract ชนกันเมื่อช่วง `[start_date, effective_end_date]` ทับกัน

## Rules

- end date เป็นวันครอบครองวันสุดท้าย
- move-out ก่อนกำหนดใช้ confirmed effective date
- future reservation เริ่มหลัง effective end ของเดิม
- scheduler แปลง boundary ด้วย timezone explicit

