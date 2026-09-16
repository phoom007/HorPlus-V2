# SETTINGS-CSRF-AND-REGISTRATION-UX-PARITY-SPEC

## Document Control
- **Title**: Settings CSRF Stability, Bank QR Code Uploader & Numbered Rules Parity Specification
- **Stage**: Gate A / Architecture & Quality Assurance
- **Author**: Lead Software Architect & Agent
- **Target Systems**: HorPlus-V2 Client (`src/pages/owner/settings.tsx`, `src/pages/owner/register.tsx`, `src/components/settings/BankQrCodeUploader.tsx`, `src/constants/presetRules.ts`) & Server (`server/src/types/onboarding-validation.ts`)

---

## 1. Executive Summary & Problem Analysis

### 1.1 Issue 1: CSRF Error Banner in Settings (`CSRF Token ไม่ถูกต้องหรือหมดอายุแล้ว`)
- **Root Cause**: In `src/pages/owner/settings.tsx`, mutation calls to `/api/v1/billing-cycles/:id/rate-snapshot` and `/api/v1/billing-cycles/by-code/:cycleCode/rate-snapshot` (lines 961 and 1156) use native browser `fetch(...)` without:
  1. `credentials: 'include'` (session cookies `horplus_session` and `horplus_csrf` were omitted or not guaranteed).
  2. `'X-CSRF-Token'` header.
  In `server/src/routes/billing-cycle.routes.ts`, `PUT /:id/rate-snapshot` calls `verifyCsrf(req, res)`. Since `req.headers['x-csrf-token']` is missing, the request is rejected with HTTP 403 `CSRF_INVALID` (`CSRF Token ไม่ถูกต้องหรือหมดอายุแล้ว`), displaying a red banner in the UI.
- **Specification**:
  - Extract CSRF token from `document.cookie` (`horplus_csrf` or `csrf-token`) and fallback to `sessionStorage.getItem('horplus_csrf')`.
  - Pass `credentials: 'include'` and header `'X-CSRF-Token': csrfToken` on all rate-snapshot mutations in `settings.tsx`.
  - Pass `credentials: 'include'` on `fetchCycleRateSnapshot` GET requests.
  - In `router/guards.tsx`, ensure `payload.csrfToken` is stored in `sessionStorage` upon session resolution as a fallback.

### 1.2 Issue 2: Bank Account QR Code Uploader in Registration Step 4
- **Root Cause**: In `src/pages/owner/register.tsx` Step 4 ("ขั้นตอนที่ 4: มัดจำ & บัญชี"), card "1 ข้อมูลบัญชีธนาคาร" contains Bank Name, Account Number, and Account Name, but lacks the Bank QR Code upload container present in `settings.tsx`.
- **Specification**:
  - Create a reusable `BankQrCodeUploader.tsx` (or direct parity component) containing:
    - Label `QRCode ธนาคาร (ไม่บังคับ)`
    - File upload input (`image/*`), drag & drop support, client-side compression via `compressImage(rawDataUrl, 800, 800, 0.75)`.
    - Upload button with dashed border, `Upload` icon, and Thai text `"อัปโหลดรูปภาพ QRCode"`.
    - Thumbnail preview when uploaded with `"มีรูป QRCode แล้ว"` and trash icon (`Trash2`) to remove.
    - Full-screen modal overlay for enlarged QR code viewing with dark backdrop blur and close button (`X`).
  - Store `bankQrCode` in `formData.paymentAccount.bankQrCode`.
  - Pass `bankQrCode: formData.paymentAccount?.bankQrCode || null` in the onboarding finalization payload.
  - In `server/src/types/onboarding-validation.ts`, update `OnboardingPaymentInputSchema` to allow `bankQrCode: z.string().trim().optional().nullable()`.

### 1.3 Issue 3: Rules & Terms Numbering ("1, 2, 3") & 100% Text Parity
- **Root Cause**:
  1. In `src/pages/owner/register.tsx` Step 5 ("แบบฟอร์มข้อตกลงสัญญา & ระเบียบโครงการ"), `PRESET_DORM_RULES` prefixes rule items with bullet points (`• `), displaying as `• ...` in the contract rules textarea.
  2. The 10 preset rules in `register.tsx` and `settings.tsx` (`PRESET_RULES`) have slight textual differences instead of being 100% identical.
- **Specification**:
  - Create canonical shared rules definition `src/constants/presetRules.ts` with 10 canonical rules:
    1. '🤫 งดส่งเสียงดังหลัง 22:00' / 'ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.'
    2. '🚭 ห้ามสูบบุหรี่ในห้องพัก' / 'ห้ามสูบบุหรี่ บุหรี่ไฟฟ้า และสิ่งเสพติดภายในห้องพักและทางเดินโดยเด็ดขาด'
    3. '🐾 ห้ามเลี้ยงสัตว์เลี้ยง' / 'ห้ามนำสัตว์เลี้ยงทุกชนิดเข้ามาเลี้ยงภายในห้องพักและพื้นที่ส่วนกลาง'
    4. '🗑️ มัดถุงขยะทิ้งจุดกำหนด' / 'กรุณามัดถุงขยะให้เรียบร้อยและนำไปทิ้ง ณ จุดทิ้งขยะของหอพักเท่านั้น'
    5. '🚗 จอดรถในซองที่กำหนด' / 'จอดรถยนต์และจักรยานยนต์ในซองจอดที่กำหนด พร้อมติดสติ๊กเกอร์หอพัก'
    6. '⚡ ห้ามดัดแปลงระบบไฟฟ้า' / 'ห้ามดัดแปลงระบบไฟฟ้าหรือใช้เครื่องใช้ไฟฟ้าที่กินกำลังไฟสูงเกินมาตรฐาน'
    7. '🗝️ คืนกุญแจเมื่อย้ายออก' / 'เมื่อสิ้นสุดสัญญาต้องคืนคีย์การ์ดและกุญแจห้องครบตามจำนวน (หากสูญหายปรับ 500 บ.)'
    8. '👥 ห้ามคนนอกค้างคืนโดยไม่แจ้ง' / 'ห้ามบุคคลภายนอกเข้าพักค้างคืนเกิน 2 คืนโดยไม่ได้รับอนุมัติจากเจ้าของหอพัก'
    9. '🧹 รักษาความสะอาดห้องพัก' / 'ผู้เช่าต้องดูแลรักษาความสะอาดภายในห้องพัก ไม่ปล่อยให้เกิดกลิ่นหรือคราบสกปรก'
    10. '🔐 ล็อคประตูและดูแลทรัพย์สิน' / 'กรุณาล็อคประตูห้องพักทุกครั้งเมื่อออกไปข้างนอก ทางหอพักไม่รับผิดชอบกรณีทรัพย์สินสูญหาย'
  - Replace `• ` bullet formatting with strict sequential numbering `"1. ", "2. ", "3. "`.
  - When a preset rule chip is toggled off, renumber remaining lines sequentially (`1. `, `2. `...).
  - When `+ เลือกทั้งหมด 10 ข้อ` is clicked, format all 10 items as `1. ...\n2. ...\n...\n10. ...`.
  - Synchronize `settings.tsx` to use the same canonical 10 preset rules and numbering logic.

---

## 2. Acceptance Criteria (SRP-01 through SRP-03)

| ID | Title | Observable Requirement |
|---|---|---|
| **SRP-01** | Settings Rate-Snapshot CSRF & Credentials | All rate snapshot requests in `settings.tsx` must supply `credentials: 'include'` and header `'X-CSRF-Token': csrfToken`. When modified in `127.0.0.1:5173/owner/settings`, no CSRF token error banner is displayed. |
| **SRP-02** | Registration Step 4 Bank QR Code Parity | In `register.tsx` Step 4 card "1 ข้อมูลบัญชีธนาคาร", render the Bank QR Code upload container matching `settings.tsx`. Supports upload, compression, preview thumbnail, delete, and enlarged modal view. Persists in form data and final onboarding payload. |
| **SRP-03** | Rules Form Sequential Numbering & Exact Text Parity | In `register.tsx` Step 5 and `settings.tsx`, rules are formatted strictly as `"1. ", "2. ", "3. "` (never `• `). Toggling chips renumbers lines sequentially. Preset text matches 100% across registration and settings. |

---

## 3. Backward Compatibility & Locked Behaviors
- Existing 43 unit tests in `src/tests/owner-settings-and-onboarding-parity.test.tsx`, `src/tests/owner-tiered-settings-ui.test.tsx`, and `src/tests/owner-register-tiered-ui.test.tsx` must continue to pass without regressions.
- Existing visual themes, color schemes (`slate-800`, `indigo-600`, `blue-600`), and responsiveness must be preserved.
