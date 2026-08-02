> [!NOTE]
> **[STATUS: CURRENT]**
> Refer to **[21-CURRENT-PRODUCT-RULE-LOCK.md](./21-CURRENT-PRODUCT-RULE-LOCK.md)** for absolute precedence.

# 10. File Storage and Documents

## 1. File Classes

| Class | ตัวอย่าง | Access |
|---|---|---|
| Tenant PII | บัตรประชาชน รูปผู้เช่า | Owner/Manager ตามสิทธิ์ |
| Signature | ลายเซ็นและหลักฐานสัญญา | Contract parties ตาม policy |
| Payment | สลิป | Owner/Manager + uploader status |
| Generated | Contract/Receipt PDF | Authorized scoped read |
| Public future | รูปหอพัก SEO | Deferred, แยก bucket/prefix |

Private file ห้ามมี public URL ถาวร

## 2. Upload Flow

1. request upload intent หลัง authorization
2. server สร้าง object key จาก UUID ไม่ใช้ filename
3. จำกัด size/type
4. client upload
5. confirm แล้วตรวจ magic bytes/hash/size
6. malware scan ตาม class
7. สร้าง metadata row
8. signed read URL อายุสั้นหลัง authorization

## 3. Object Key

```text
private/{dormitoryId}/{resourceType}/{resourceId}/{uuid}
```

อย่าใส่ชื่อ/เลขบัตร/เบอร์โทรใน key

## 4. Signature Evidence

Tenant canvas signature ต้องเก็บ:

- original raster/vector normalized
- SHA-256
- signedAt
- IP/user-agent hash
- LINE identity
- document template/version/hash
- consent text version

ลายเซ็นไม่ใช่แค่ base64 ใน contract row

## 5. Retention

- contract/receipt/audit เก็บตามข้อกำหนดธุรกิจ/กฎหมายที่อนุมัติภายหลัง
- failed/unconfirmed upload ลบด้วย lifecycle เช่น 7 วัน
- moved-out ไม่เท่ากับลบประวัติฝั่ง Owner
- delete request ต้องใช้ soft-delete/legal retention workflow

## 6. Encryption and Logging

- encryption at rest + TLS
- object storage service identity least privilege
- signed URL ไม่ลง log
- download audit สำหรับ PII/signature/slip

## Acceptance Criteria

- เดา object path แล้วดาวน์โหลดไม่ได้
- signed URL หมดอายุและ scope ถูกต้อง
- upload ปลอม extension ถูก reject
- cross-dorm file denied
- signature verify hash/document version ได้
- unconfirmed upload cleanup ไม่ลบไฟล์ที่ถูก attach แล้ว


