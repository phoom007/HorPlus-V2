# ADR-011 — Object Storage and Region

Status: Accepted

## Decision

ใช้ private object storage ใน region ใกล้ประเทศไทย พร้อม short-lived signed URL, encryption, lifecycle และ service identity least privilege

Google Cloud Storage `asia-southeast1` เป็นตัวเลือกที่เข้ากับ API deployment ปัจจุบัน; เปลี่ยน provider ได้ผ่าน interface หาก security/latency/backup tests เทียบเท่า

## Rules

- block public access
- object key ไม่มี PII
- authorization ก่อนออก URL
- hash/scan/metadata
- temporary upload cleanup

