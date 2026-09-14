# Specification: Slip Verification Security Hardening

This specification defines the security architecture and defensive controls for bank slip upload and automated verification across the HorPlus-V2 platform (covering subscription payment slips and tenant billing payment evidence).

---

## Problem Statement

Bank slip uploads and automated verification are high-value financial targets. Attackers using penetration testing tools (e.g., Burp Suite, Kali Linux) and malicious automation can execute several classes of attacks:

1. **Client-Side Financial Parameter Tampering (Zero-Trust Violation)**:
   Attackers intercept HTTP requests in Burp Suite and tamper with payment fields (e.g. injecting `expectedAmount=1.00` or manipulating package pricing) hoping the server trusts client-supplied figures.
2. **Malicious File Upload & Remote Code Execution (WebShell / Polyglot)**:
   Attackers upload executable scripts disguised with image extensions (e.g., `shell.php.jpg`, SVG containing `<script>` XSS, or JPEG with embedded PHP/Bash in EXIF metadata) attempting to execute code on the server or storage.
3. **Decompression Bombs / Pixel Flood (Image DoS)**:
   Attackers upload small compressed files (e.g. 50 KB) that decompress in server memory into tens of gigabytes (e.g. 100,000 x 100,000 pixels), crashing Node.js with Out-Of-Memory (OOM) and causing server lag.
4. **API Credit Exhaustion & DoS Flooding**:
   Attackers flood the verification endpoint with rapid, repeated requests, draining paid SlipOK API quota credits and degrading system performance for legitimate dormitory owners.
5. **Single-Packet Parallel Race Conditions**:
   Using Burp Suite Turbo Intruder, attackers blast 20-50 simultaneous requests with the exact same slip in the same millisecond. Because database checks occur before records are written, parallel threads could all pass pre-checks and fire concurrent SlipOK API calls, wasting credits or causing double-activation race conditions.

---

## Solution

Implement an uncompromising defense-in-depth security boundary across the slip verification pipeline:

1. **Server-Dictated Financial Integrity (Zero-Trust)**:
   The server exclusively determines and enforces all payable amounts, package prices, and discounts via authoritative database queries. Any client-provided `expectedAmount`, `price`, or `amount` in subscription slip requests is ignored and stripped. SlipOK verification enforces exact 0-tolerance matching against the server's authoritative figure.
2. **Multi-Stage File Sanitization & Upload Hardening**:
   - **Size Limit**: Hard ceiling of **4 MB** on slip uploads (down from 10 MB).
   - **Magic Bytes Validation**: Binary inspection verifying genuine JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), or WebP (`RIFF...WEBP`) signatures. Explicit rejection of SVG, HTML, PHP, XML, ELF, MZ, and ZIP signatures.
   - **Pixel Flood / Decompression Guard**: Sharp parser configured with `limitInputPixels: 16_777_216` (16 MP) and maximum dimension bounds of **4096 x 4096 px** (and minimum 100 x 100 px).
   - **Raster Sanitization & Re-encoding**: Re-encode raw images through Sharp with high-fidelity quality (e.g., JPEG/WebP quality 95) to strip all EXIF metadata, comments, and polyglots before writing to disk storage, while maintaining 100% QR code readability for SlipOK.
3. **Two-Tier Rate Limiting & Cooldown Protection**:
   - **Tier 1 (User / Dormitory)**: Maximum 5 slip upload attempts per minute per user/dormitory.
   - **Tier 2 (IP Address)**: Maximum 15 slip upload attempts per 5 minutes per IP.
   - **Cooldown Barrier**: Mandatory 5-second cooldown between consecutive slip submissions per user/dormitory to eliminate rapid bursts.
4. **Pre-Verification Concurrency Lock (Anti-Race Condition)**:
   Compute the SHA-256 hash of the slip payload immediately upon arrival. Acquire an atomic lock (Redis / PostgreSQL Advisory Lock) on `slip_lock:${sha256}` before invoking SlipOK. If a concurrent duplicate is already processing, immediately return `409 CONCURRENT_REQUEST_IN_PROGRESS` without making any external SlipOK API calls.

---

## User Stories

1. As a platform owner, I want the server to authoritatively determine all subscription fees and discounts, so that attackers cannot manipulate payment amounts via Burp Suite or client proxies.
2. As a platform owner, I want slip uploads strictly capped at 4MB, so that server network bandwidth and memory are preserved against resource exhaustion.
3. As a platform owner, I want uploaded slips validated against magic bytes, so that WebShells, SVGs, and executables masked as images are rejected immediately before file processing.
4. As a platform owner, I want image dimensions limited to a maximum of 4096 x 4096 px with input pixel limits, so that decompression bomb attacks cannot crash the Node.js server with OOM errors.
5. As a platform owner, I want image files re-encoded through Sharp to strip all EXIF, GPS, and metadata comments before disk storage, so that malicious polyglot payloads cannot be stored on the server.
6. As a platform owner, I want slip images to preserve high-fidelity QR readability during sanitization, so that legitimate SlipOK verification succeeds smoothly without degradation.
7. As a platform owner, I want a rate limit of 5 uploads per minute per dormitory and 15 uploads per 5 minutes per IP, so that automated botnets cannot flood the service and cause server lag.
8. As a platform owner, I want a 5-second cooldown between consecutive slip uploads by the same user, so that spamming or accidental double-clicking is prevented at the gateway.
9. As a platform owner, I want an atomic pre-verification concurrency lock on the slip SHA-256 hash, so that parallel requests sent via Burp Suite Turbo Intruder cannot trigger duplicate SlipOK API calls or credit waste.
10. As a dormitory owner, I want clear, friendly Thai error messages when an upload is too large, too frequent, or corrupted, so that I understand how to correct the issue without confusion.
11. As a tenant, I want bill payment slip uploads to be protected with the same upload safety standards, so that the dormitory billing system remains secure and resilient.

---

## Implementation Decisions

### 1. Zero-Trust Financial Authority
- The subscription slip route `POST /api/v1/subscription/payment/slip` accepts only:
  - `intentId` (or `packageIntentId`) OR `durationMonths`
  - Optional `promoCode`
  - Uploaded `file`
- Any `expectedAmount`, `price`, `amount`, or financial override in the request body is explicitly discarded.
- `expectedAmount` is retrieved strictly from:
  - If `intentId` provided: `SubscriptionPackageIntent.finalPayableAmount` (status must be `PENDING_PAYMENT`).
  - If `durationMonths` provided: `SubscriptionPackage.price` minus active, verified `PromoCode` discount percentage.
- The authoritative `expectedAmount` is passed directly to `subscriptionSlipVerifier.verify(...)`.
- The SlipOK response amount is compared with `expectedAmount` using decimal equality (0 discrepancy allowed).

### 2. Multi-Stage File Sanitization Pipeline
- **Multer Middleware**:
  - `limits.fileSize`: `4 * 1024 * 1024` (4 MB).
  - Returns `400 FILE_TOO_LARGE` if exceeded.
- **Binary Magic Bytes Detector**:
  - Validates first bytes for JPEG (`0xFF, 0xD8, 0xFF`), PNG (`0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A`), or WebP (`RIFF....WEBP`).
  - Inspects first 64 bytes for disallowed active vectors: `<svg`, `<?xml`, `<?php`, `<html`, `MZ`, `\x7fELF`, `PK\x03\x04`.
  - Rejects invalid files with `400 INVALID_IMAGE_FORMAT`.
- **Sharp Image Safety Verification**:
  - Sharp instantiated with `failOnError: true`, `limitInputPixels: 16_777_216`, `sequentialRead: true`.
  - Dimensions check: `width >= 100 && height >= 100` and `width <= 4096 && height <= 4096`.
  - Total pixels: `width * height <= 16_777_216`.
  - Rejects oversized images with `400 DIMENSIONS_EXCEEDED` or `PIXEL_LIMIT_EXCEEDED`.
- **High-Fidelity Re-Encoding**:
  - Auto-rotates using `.rotate()`.
  - Re-encodes to clean JPEG (quality 95) or WebP (quality 95) with all EXIF and metadata stripped.
  - The clean, sanitized buffer is stored to disk and passed to SlipOK, eliminating all hidden polyglot payloads.

### 3. Two-Tier Rate Limiting & Cooldown Protection
- Implemented as Express middleware `slipRateLimiter`:
  - **Tier 1 (User / Dormitory)**: `rate_limit:slip:user:${dormitoryId}:${userId}` -> max 5 requests / 60,000 ms.
  - **Tier 2 (IP)**: `rate_limit:slip:ip:${ip}` -> max 15 requests / 300,000 ms.
  - **Cooldown**: `cooldown:slip:${userId}` -> 5,000 ms window. If an entry exists, rejects with `429 COOLDOWN_ACTIVE` and Thai message: `กรุณารอ 5 วินาทีก่อนส่งตรวจสอบสลิปอีกครั้ง`.
- Utilizes Redis when connected (`getRedisClient()`), falling back to memory store when Redis is unavailable during isolated unit tests.

### 4. Concurrency Pre-Lock on Payload SHA-256
- Upon file reception, calculate `payloadHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')`.
- Prior to calling SlipOK or processing:
  - Attempt to acquire lock: `slip_lock:${payloadHash}` with 30-second expiration.
  - Redis: `redis.set('lock:slip:' + payloadHash, reqId, 'NX', 'EX', 30)`.
  - If lock acquisition fails (result is null / already held):
    - Instantly return `409 CONCURRENT_REQUEST_IN_PROGRESS` with Thai message: `มีคำขอตรวจสอบสลิปนี้กำลังประมวลผลอยู่ กรุณารอสักครู่`.
    - No external API request to SlipOK is dispatched.
  - Release lock in `finally` block once transaction completes or fails.

---

## Canonical Authorities & Architectural Seams

- **Canonical Sources**:
  - Subscription Slip Endpoint: `server/src/routes/subscription.routes.ts`
  - Subscription Slip Verifier: `server/src/integrations/payment-verification/subscription-slip-verifier.ts`
  - Image Security Service: `server/src/services/image-security.service.ts`
  - Rate Limiter Middleware: `server/src/middleware/rate-limiter.ts`
  - Database Prisma Client: `server/src/db/prisma.ts`
  - Redis Client: `server/src/db/redis.ts`
- **Locked Behaviors**:
  - Free and Paid subscription plans and billing calculation rules are preserved.
  - Promo code `X` button behavior (dismiss UI row without revoking discount) is preserved.
  - Anti-duplicate database checks (`SubscriptionPaymentEvidence.payloadHash`) remain the immutable single-truth barrier.
  - Thai UI and error message vocabulary are preserved.
- **Do Not Modify**:
  - Do not change Prisma schema or add unapproved database columns.
  - Do not modify production pricing or room entitlement formulas.
  - Do not alter tenant-claim or access-grant authorization contracts.

---

## Acceptance Criteria

- **SEC-01 (Zero-Trust Parameters)**: Any client attempt to send `expectedAmount`, `price`, or `amount` in `POST /api/v1/subscription/payment/slip` is ignored. The server computes the fee from `SubscriptionPackage` and `PromoCode`.
- **SEC-02 (4MB Upload Limit)**: Uploads exceeding 4MB (4,194,304 bytes) are rejected with HTTP 400 (`FILE_TOO_LARGE`).
- **SEC-03 (Magic Bytes Validation)**: Uploads disguised as images (e.g. PHP, SVG, HTML, EXE, ZIP) are rejected with HTTP 400 (`INVALID_IMAGE_FORMAT`).
- **SEC-04 (Decompression Bomb Protection)**: Images exceeding 4096px in width or height, or exceeding 16 Megapixels, are rejected with HTTP 400 (`DIMENSIONS_EXCEEDED` / `PIXEL_LIMIT_EXCEEDED`).
- **SEC-05 (Image Sanitization)**: All images stored to disk are re-encoded through Sharp with EXIF stripped, while maintaining QR code clarity for SlipOK.
- **SEC-06 (Two-Tier Rate Limiting)**: More than 5 uploads/min per user or 15 uploads/5min per IP receive HTTP 429 (`RATE_LIMIT_EXCEEDED`).
- **SEC-07 (5-Second Cooldown)**: Consecutive upload attempts by the same user within 5 seconds receive HTTP 429 (`COOLDOWN_ACTIVE`).
- **SEC-08 (Concurrency Pre-Lock)**: Parallel simultaneous requests with the same slip hash reject all but the winning request with HTTP 409 (`CONCURRENT_REQUEST_IN_PROGRESS`) before calling SlipOK.

---

## Testing Decisions

- **Test Seam**: High-level integration tests via Supertest against the Express router `createSubscriptionRouter`.
- **Targeted Tests**:
  - `test/unit/subscription-slip-verifier.test.ts`: Update unit tests for dimension checks, sanitization, and lock handling.
  - `test/integration/slip-security-hardening.test.ts`: Dedicated security suite testing:
    1. Parameter tampering attempt.
    2. 4.1MB file upload rejection.
    3. SVG/PHP upload rejection.
    4. 5000x5000 image bomb rejection.
    5. Rate limiter tier 1 & tier 2 triggers.
    6. 5-second cooldown rejection.
    7. Concurrent parallel requests (race condition barrier).

---

## Out of Scope

- Client-side biometric authentication.
- Machine-learning based synthetic slip detection (handled by SlipOK bank gateway).
- Changes to tenant contract renewal or meter reading calculation.

---

## Further Notes

All security error responses adhere to standard HorPlus RFC-7807 error format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "ข้อความภาษาไทยที่ชัดเจน",
    "requestId": "req-...",
    "timestamp": "ISO-8601"
  }
}
```
