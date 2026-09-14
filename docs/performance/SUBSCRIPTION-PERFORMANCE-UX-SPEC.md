# Specification: Subscription Performance, Asset Optimization & Zero-Jitter UX

This specification defines the frontend and integration performance hardening for the HorPlus-V2 Owner Subscription menu (`src/pages/owner/subscription.tsx` and `src/pages/owner.tsx`), targeting zero visual jitter (CLS = 0), elimination of background render loops, full local asset bundling, and complete pricing consistency.

---

## 1. Problem Statement

During manual verification, PO testing, and browser network inspection, the following performance and UX defects were identified:
1. **Background Re-render Leakage**:
   The billboard carousel timer (`setInterval` every 3,500ms) runs continuously even when the user is inside the Payment subview (`isPaymentViewOpen === true`), triggering re-evaluation of image elements and parent renders.
2. **Free Trial Duration & Overview Card Price Inconsistency**:
   - In the payment subview duration selector, the "1 เดือน" pill button shows `฿189` despite the total amount showing `฿0` for trial-eligible dormitories.
   - On the overview pricing card, the 1-month PRO card displayed `฿189` when not explicitly checking trial eligibility across all plan states.
3. **Whole-Page Jitter / Flicker on Back / Close (X)**:
   When the user clicks "กลับ" (Back) or the close button "X", a split-second layout shift occurs because `main#owner-main-content` in `owner.tsx` switches between `p-0 overflow-hidden` and `p-4 md:p-6 overflow-y-auto` one frame after the subview unmounts (React `useEffect` delay).
4. **External Asset Dependency & Mock Thai QR Vector**:
   The official Thai QR Payment brandmark was previously replaced with an inline mockup rather than the authentic official SVG asset served directly from the local project (`public/images/Thai_QR_Logo.svg`).
5. **Generic Billboard Images vs. Official HorPlus Campaign Creatives**:
   Billboards loaded external Unsplash stock images instead of the dedicated local HorPlus banners (`C:\Horplus-V2\1.jpg` to `4.jpg`).
6. **Redundant Quote API Requests**:
   The quote synchronization lacked query-key deduplication (`useRef`), causing repeated POST calls on identical parameter states.

---

## 2. Product Owner Authorities & Decisions

This specification is authorized by and traces directly to the following PO inputs:
- **PO Request 8**:
  - Requirement 1: "กล่อง 'แพ็กเกจปัจจุบัน' เมื่อกด กลับ แล้วจะเห็นกล่องนี้ขยับครับ ซึ่งควรปรับให้กล่องไม่เปลี่ยนขนาดตอนกด กลับ / x"
  - Requirement 2: "ถ้าหอพักนั้น ยังไม่ได้ใช้สิทธิ์ horplus pro ฟรี 1 เดือน... พอมาดูในเมนูต่อแพ็กเกจ กดเข้าไปจะเห็น ราคา 0 บาท ให้แนปสลิป ซึ่งควรให้ 0 บาทนั้น ไม่ต้องแนปสลิปครับ ให้เลือกแล้วต่ออายุได้เลย เพราะยังไม่ใช้สิทธิ์"
- **PO Request 10**:
  - Observation: "ผมสังเกตุว่ามีการขอโหลดข้อมูลจาก server ตลอดเวลา เช่น ดึงรูป , และ กล่องมีการเปลี่ยนแปลง จนผู้ใช้งานเห็นได้ชัดว่า ดูไม่ลื่นไหล..."
- **PO Request 12 (PO Grill-Me Confirmations)**:
  - **Q1 = ก**: Duration pill button "1 เดือน" displays `฿0` when `subInfo.isTrialEligible === true`; 1-month PRO overview card displays `฿0` with trial claim CTA.
  - **Q2 = ก**: Official `Thai_QR_Logo.svg` downloaded and stored locally in `public/images/Thai_QR_Logo.svg` and loaded via `<img src="/images/Thai_QR_Logo.svg" alt="Thai QR Payment" />` (Zero external CDN).
  - **Q3 = ก**: Synchronous layout state synchronization on Back / Close (X) click handlers, eliminating the 1-frame container padding/overflow shift.
  - **Q4 = ก + Text Customization**: Move `1.jpg` through `4.jpg` to `public/billboards/`, delete originals from root, and set exact Thai copy:
    - Slide 1: หัวข้อ "หอพลัส+ เปิดทดลองฟรี 3 เดือน", รายละเอียด "ตรวจสลิปอัตโนมัติ แจ้งเตือน LINE ทำสัญญา ออกบิล แจ้งซ่อม ครอบคลุมครบวงจร", ป้าย "ทดลองฟรี 3 เดือน"
    - Slide 2: หัวข้อ "ราคาแพ็กเกจ HORPLUS โปรโมชั่นประจำปี 2569", รายละเอียด "โปรโมชั่นพิเศษ PRO 1 เดือน 0 บาท และแพ็กเกจรายปีสุดคุ้มสำหรับเจ้าของหอพัก", ป้าย "โปรโมชั่นปี 2569"
    - Slide 3: หัวข้อ "ระบบบริหารจัดการหอพักอัจฉริยะครบวงจร", รายละเอียด "ดูภาพรวมยอดค้างชำระ สถิติรายรับรอบปี และบริหารจัดการผู้เช่าได้ทุกอุปกรณ์", ป้าย "ฟังก์ชันครบวงจร"
    - Slide 4: หัวข้อ "กรอกโค้ด \"HORPLUS\" ทดลอง PRO ฟรี 2 เดือน", รายละเอียด "รับสิทธิ์ใช้งานฟังก์ชัน PRO ฟรี 2 เดือนทันที จำกัด 100 สิทธิ์แรกเท่านั้น", ป้าย "โค้ดพิเศษจำกัดสิทธิ์"
- **PO Request 13 (PO Confirmed Trial Stacking & Display Consistency)**:
  - **Authority 1**: Overview card & `GET /subscription/current` must return `isTrialEligible: true` whenever the user and dormitory have not yet claimed/used the initial 1-month trial, regardless of whether the current plan is FREE or PRO.
  - **Authority 2**: When committing a zero-pay trial claim for a dormitory that already possesses an active PRO subscription (`expiresAt > now` and status not CANCELLED/EXPIRED), the system must **stack** +1 calendar month (+30 days) onto the existing expiration date (`subExpiresAt = addCalendarMonths(existingSub.expiresAt, 1)`), preserving the original `startedAt` and active `status`. Active remaining days must never be reset to 30 days.
- **PO Request Round 5 & 6 (PO Confirmed Non-blocking Celebration Toast & Fireworks on Dashboard)**:
  - **PO Round 5 Request**: "เมนูต่อสิทธิ์ เมื่อกดปุ่ม รับสิทธิ์ฟรี 1 เดือน ให้แสดง overlay พุล สั้นๆ เพื่อให้แสดงในหน้า owner/dashboard"
  - **PO Round 6 Request**: "ฉันไม่อยากแบบ popup ครับ เอาแบบ toast+fade สั้นๆ กลางจอ ด้านบน 3-4 วิ และเอฟเฟคพุล พอ /grill-me"
  - **PO Grill-Me Confirmations (Round 6)**:
    - **Q1 = ก**: Toast style: Minimal frosted glass card with emerald border at top-center (`fixed top-6 left-1/2 -translate-x-1/2 z-50`). No dark modal backdrop blocking the screen (`pointer-events-none` on overlay container and canvas), allowing immediate interaction with the dashboard behind it. Background canvas fireworks particles burst across the screen with `pointer-events-none`.
    - **Q2 = ข**: Animation & Dismissal: Smooth fade-in, stays for 3.5 seconds total, then smooth fade-out automatically without an 'x' close button on the toast.
    - **Q3 = ก**: Copywriting: Compact 2 lines: Header: "🎉 ยินดีด้วย! คุณได้รับสิทธิ์ใช้งานฟรี 1 เดือน" + Subtext: "อัปเกรดเป็น HORPLUS PRO เรียบร้อยแล้ว". Non-modal accessibility semantics (`role="status"`, `aria-live="polite"`).

---

## 3. Scope of Changes

### Target Components & Files
- `public/images/Thai_QR_Logo.svg`: Official local Thai QR Payment vector graphic.
- `public/billboards/1.jpg` - `4.jpg`: Official local HorPlus promotional banners.
- `src/components/common/CelebrationFireworksOverlay.tsx`: Non-blocking celebratory top-center toast with smooth fade and background canvas fireworks/confetti particle system.
- `src/tests/subscription-trial-celebration.test.tsx`: Component test suite verifying top-center positioning, non-blocking pointer events, 3.5s fade lifecycle, and 2-line Thai copy.
- `src/pages/owner/subscription.tsx`:
  - Duration selector pill button price logic (`subInfo.isTrialEligible ? 0 : ...`).
  - Pricing card 1-month PRO trial presentation (`isTrialEligible ? 0 : ...`).
  - Update `subInfo.isTrialEligible` fallback at line 797 to remove `planCode === 'FREE'` constraint (`Boolean(d.isTrialEligible ?? !d.trialStartedAt)`).
  - Synchronous `onDetailViewChange(false)` in `handleClosePaymentView` and `handleReturnToHome`.
  - Official Thai QR logo image loader referencing `/images/Thai_QR_Logo.svg`.
  - `DEFAULT_BILLBOARD_ADS` updated with local `/billboards/X.jpg` and confirmed Thai copy.
  - Forward `onNavigate('dashboard', { showTrialCelebration: true })` and set `sessionStorage` flag on successful trial claim.
- `src/pages/owner.tsx`:
  - Ensure `#owner-main-content` maintains stable scrollbar-gutter and container layout.
  - Listen for `showTrialCelebration` from router state and `sessionStorage`, rendering `<CelebrationFireworksOverlay />`.
- `server/src/routes/billboard.routes.ts`:
  - Update `DEFAULT_BILLBOARD_ITEMS` to reference local `/billboards/X.jpg` and confirmed Thai copy.
- `server/src/routes/subscription.routes.ts`:
  - `GET /api/v1/subscription/current`: Compute `isTrialEligible` without requiring `isFree`, allowing active PRO dormitories to view ฿0 trial pricing if unconsumed.
- `server/src/services/subscription-intent.service.ts`:
  - `commitZeroPayIntent`: Check `isExistingProActive` (`existingSub.expiresAt > now && status !== 'CANCELLED' && status !== 'EXPIRED'`) and stack trial duration on top of `existingSub.expiresAt`, preserving `startedAt` and `ACTIVE` status.

### Locked Behaviors (DO NOT MODIFY)
1. **Security Controls (SEC-01 through SEC-08)**:
   All zero-trust server verification, magic byte checks, 4MB limits, Sharp sanitization, rate limiting, and SHA-256 pre-locks remain strictly intact.
2. **Approved Thai UI Text Fidelity**:
   All labels, badges, receipt text, and error descriptions must be preserved exactly as approved.
3. **No External Branding**:
   Slip verification engine remains referred to neutrally as "ระบบตรวจสลิป" / "ระบบตรวจสอบสลิป" (never disclose third-party names like SlipOK).
4. **Tenant Isolation**:
   Dormitory-scoped queries and cache isolation remain intact.

---

## 4. Acceptance Criteria & Criterion IDs

| Criterion ID | PO Source | Acceptance Requirement | Planned Verification |
| :--- | :--- | :--- | :--- |
| **PERF-01** | PO Req 10 | Billboard carousel timer (`setInterval`) must automatically pause when `isPaymentViewOpen === true` or document visibility is hidden. Re-rendering of Billboard must be isolated via `React.memo`, preventing re-renders of `OwnerSubscription` body. | Unit test / code inspection verifying timer pause on payment view open, and zero parent re-renders caused by carousel ticks. |
| **PERF-02** | Q1 = ก, PO Req 8, Req 12, Req 13 | If `subInfo.isTrialEligible === true`: (1) Duration pill button for 1 month must display `฿0` and indicate trial privilege. (2) Overview 1-month PRO card must display `฿0` with trial claim CTA across all plan statuses (both FREE and PRO). (3) Opening payment view pre-renders the 0-Baht trial card immediately without rendering PromptPay QR card. | Vitest / component render tests and API tests verifying that 1-month button shows ฿0, overview card shows ฿0 trial, and `GET /subscription/current` returns `isTrialEligible: true` for eligible PRO dorms. |
| **PERF-03** | Q3 = ก, PO Req 12 | Exiting payment view via "กลับ" or "X" must dispatch layout state synchronization synchronously. `<main id="owner-main-content">` must transition without a 1-frame layout shift or visible jumping of headers/containers (CLS = 0). | Component inspection and tests verifying synchronous view exit callback and container layout stability across `isPaymentViewOpen` toggles. |
| **PERF-04** | Q2 = ก, PO Req 12 | The official `Thai_QR_Logo.svg` must be served as a local asset from `/images/Thai_QR_Logo.svg`. Zero requests to `upload.wikimedia.org` or external CDNs. | Inspection and tests verifying that `<img src="/images/Thai_QR_Logo.svg" alt="Thai QR Payment" />` renders locally and no external network request is initiated. |
| **PERF-05** | PO Req 10 | `POST /subscription/quote` must be guarded by a deduplication `useRef` storing `${packageId}:${durationMonths}:${promoCode}:${dormitoryId}`. Redundant calls with identical parameters within the same session state must be prevented. | Unit test spying on `httpRequest` verifying that repeated re-renders do not fire extra quote network calls. |
| **PERF-06** | Q4 = ก, PO Req 10, Req 12 | Local billboard assets `1.jpg` to `4.jpg` must be moved to `public/billboards/` (root source files removed), and `DEFAULT_BILLBOARD_ADS` must load `/billboards/X.jpg` with PO-approved Thai headlines and descriptions. | Automated test / file verification checking existence in `public/billboards/`, absence in root, and exact copy in `DEFAULT_BILLBOARD_ADS`. |
| **PERF-07** | PO Req 13 | When claiming the 1-month free trial via `commitZeroPayIntent`, if the dormitory already has an active PRO subscription (`expiresAt > now` and status not CANCELLED/EXPIRED), the system must stack +1 calendar month onto `existingSub.expiresAt` (e.g. 112 + 30 = 142 days), preserving `startedAt` and active status. It must NEVER reset remaining active days to 30 days. For FREE or expired dormitories, expiration starts 1 month from `now`. | Automated unit test verifying that an active PRO subscription with 112 days remaining is extended to 142 days upon trial activation, with `startedAt` preserved. |
| **PERF-08** | PO Req (Round 5 & 6) & Grill-Me Alignments | Non-blocking Celebration Toast + Fade & Background Fireworks on Dashboard: When claiming the 1-month free trial (`handleClaimFreeTrial`) in `SubscriptionPage` (`subscription.tsx`), upon successful commit (`commitZeroPayIntent`), navigate immediately to `owner/dashboard` and display a non-blocking top-center celebratory toast (`fixed top-6 left-1/2 -translate-x-1/2 z-50`) with smooth fade-in and fade-out (total 3.5 seconds) along with background canvas fireworks/confetti particles (`pointer-events-none`). The screen has NO dark modal backdrop and NO blocking dialog, allowing immediate interaction with the dashboard. Toast copy: Header "🎉 ยินดีด้วย! คุณได้รับสิทธิ์ใช้งานฟรี 1 เดือน" + Subtext "อัปเกรดเป็น HORPLUS PRO เรียบร้อยแล้ว", auto-dismissing gracefully without an 'x' button. | Automated component tests verifying non-blocking pointer events, absence of modal dialog/backdrop, top-center positioning, 3.5s auto-fade lifecycle, exact 2-line Thai copy, and background canvas fireworks cleanup on unmount. |

---

## 5. Verification Plan

1. **Frontend Unit & Component Tests**:
   - Update `src/tests/subscription-performance-ux.test.tsx`:
     - PERF-01: Timer pauses when `isPaymentViewOpen === true`.
     - PERF-02: 1-month duration button displays ฿0 and trial status; overview card displays ฿0.
     - PERF-03: Exiting payment view synchronously triggers callback without 1-frame container lag.
     - PERF-04: Thai QR logo renders from local `/images/Thai_QR_Logo.svg`.
     - PERF-05: Quote API deduplication prevents repeated calls.
     - PERF-06: Billboard default ads load from `/billboards/X.jpg` with approved Thai copy.
   - Update `src/tests/subscription-trial-celebration.test.tsx`:
     - PERF-08: Non-blocking top-center toast with `pointer-events-none` across overlay and canvas, 3.5-second auto-fade lifecycle, exact 2-line Thai copywriting, non-modal accessibility attributes (`role="status"`, `aria-live="polite"`), and canvas animation frame cleanup on unmount.
2. **Build & Typecheck Gate**:
   - `npm run build` must exit 0.
   - `npm --prefix server run build` must exit 0.
