# Specification: LINE OA Setup & Step 6 Navigation Parity Specification (LOA-01 to LOA-19)

This specification defines the requirements, acceptance criteria, and verification standards for:
1. **LOA-01**: Quick Add Tenant Modal LINE OA Setup Navigation Parity (`QuickAddTenantModal.tsx` -> `OwnerLineOaPage`).
2. **LOA-02**: Step 6 Alignment for Unconfigured / Not-Ready State in `OwnerLineOaPage`.
3. **LOA-03**: Connected & Ready View Transition in `OwnerLineOaPage`.
4. **LOA-04**: Modal Header & 3-Device Responsive Layout (Mobile, Tablet, Desktop, Portrait & Landscape).
5. **LOA-05**: Removal of Redundant Outer Green Card Border (De-cluttering Visual Hierarchy).
6. **LOA-06**: Immediate Webhook URL Display & Generation upon Verification Pass.
7. **LOA-07**: Concise Thai Copywriting for Labels, Placeholders & Success Messages.
8. **LOA-08**: Visible Plaintext Display & Persistence for LINE Channel Secret (`OwnerLineOaPage`).
9. **LOA-09**: Strict Webhook Readiness Verification across Badge & Modals (`LineQuotaBadge`, `LineNotificationModal`).
10. **LOA-10**: Edit LINE OA Action Button in Quota Modal Header near `X` Button (`LineQuotaBadge`).
11. **LOA-11**: Direct Setup Navigation on Webhook Pending State (Bypassing intermediate Quota Modal to show Setup View directly).
12. **LOA-12**: Status-Based Eye Icon Toggle & Last-Character Preview on Masked Input Typing/Pasting.
13. **LOA-13**: First-Click Auto-Open of LINE Developers Console Messaging API URL on Webhook Copy.
14. **LOA-14**: Interactive Styled Link for `LINE Developers Console > Messaging API` conditioned on Channel ID presence.
15. **LOA-15**: Step 6 Registration Parity in `src/pages/owner/register.tsx`.

---

## 1. Product Owner Authorities & Confirmed Decisions

Traced directly to PO Requests and confirmed `/grill-me` alignments:
- **PO Input (Image 1 & 2)**:
  1. "จากรูปที่ 1 ควรแสดง เป็นของรูปที่ 2 เลยครับ เพื่อให้ได้ตั้งค่าเชื่อม Webhook ก่อน"
  2. "จากรูปที่ 2 Icon ด้วยตาควรทำงานสลับกัน เพื่อไม่ให้ผู้ใช้งานไทม่สับสนครับ รูปตาเปิด ก็เปิดการมอง รูปขีดตา ก็ปิดการมอง"
  3. "และถ้าสถานะปิดข้อความอยู่ พอกดว่างข้อความ/พิมพ์ จะทำให้แสดงตัวสุดท้ายก่อนเห็นเป็น •••"
  4. "เมื่อกดปุ่ม "คัดลอก" ครั้งแรก จะเปิดลิงก์แท็บใหม่ https://developers.line.biz/console/channel/{LINE Channel ID}/messaging-api ให้อัตโนมัติ และถ้ากลับมาดูเว็บเดิม จะเป็นปุ่มคัดลอกธรรมดา และ ตรงข้อความ LINE Developers Console > Messaging API จะกดแล้วเปิดลิงก์แท็บใหม่ https://developers.line.biz/console/channel/{LINE Channel ID}/messaging-api เช่นกัน"
- **Confirmed Grill-Me Decisions**:
  - **Round 1 (LOA-11, LOA-12)**:
    - **Q1 = ก**: Direct setup navigation on `!isConfigured`.
    - **Q2 = ก & Preview**: Eye status icon swap & 800ms last character preview.
    - **Q3 = ก**: Default plaintext visible.
    - **Q4 = ก**: Quota modal reserved for ready status.
  - **Round 2 (LOA-13, LOA-14, LOA-15)**:
    - **Q1 = ก**: On the first click of the "คัดลอก" (Copy) button in the current modal session, the Webhook URL is copied to clipboard AND `https://developers.line.biz/console/channel/{effectiveChannelId}/messaging-api` is automatically opened in a new tab. Subsequent clicks or after returning to the tab, it behaves as a normal copy button (copies to clipboard without opening new tabs).
    - **Q2 = ก (ขีดเส้นสีเหมือนสำหรับเปิดลิงก์)**: Render `LINE Developers Console > Messaging API` with link styling (underline, link color, pointer cursor, external link icon) that opens `https://developers.line.biz/console/channel/{effectiveChannelId}/messaging-api` in a new tab when clicked.
    - **Q3 = แบบ ก แต่ถ้าไม่มี Channel ID แสดงข้อความ "LINE Developers Console > Messaging API" เป็นธรรมดาตามปกติ**: If `effectiveChannelId` is present, render the interactive link. If `effectiveChannelId` is absent/empty, render the text as normal plain text without link/underline, and clicking copy button does not open a channel URL.
    - **Q4 = ก**: Apply behavior to both `OwnerLineOaPage` (`src/pages/owner/line-oa.tsx`) and Step 6 of `register.tsx` (`src/pages/owner/register.tsx`).

---

## 2. Acceptance Criteria & Criterion IDs

| Criterion ID | PO Source | Acceptance Requirement | Planned Verification |
| :--- | :--- | :--- | :--- |
| **LOA-01** | PO Request | In `QuickAddTenantModal`, clicking "ตั้งค่า LINE OA" closes modal and invokes `onNavigateToLineConfig()`. | Component test verifying callback. |
| **LOA-02** | PO Request | Initial credentials form in `OwnerLineOaPage` hides advanced management controls. | Component test asserting hidden panels. |
| **LOA-03** | PO Request | Management view displays quota, rotate key, event preferences, and toggle to edit credentials with cancel button. | Component test verifying view transition and cancel button. |
| **LOA-04** | PO Request | Responsive 3-device modal header without collisions, single `X` button in modal, responsive title. | DOM inspection across mobile and desktop. |
| **LOA-05** | PO Request | Form rendered in clean white card without heavy nested green outer border. | Component style assertion. |
| **LOA-06** | PO Request | Webhook URL immediately displayed in emerald field with active copy button upon test pass. | Test verifying immediate webhook presentation. |
| **LOA-07** | PO Request | Concise Thai copywriting for all labels, placeholders, and feedback messages. | Text matching tests. |
| **LOA-08** | PO Request & Q1=ก, Q4=ก | 1. In `OwnerLineOaPage`, `LINE Channel Secret` input renders plaintext (`type="text"`) by default, with optional eye toggle button to switch visibility.<br>2. `channelSecret` is NOT wiped after verification succeeds (no `setChannelSecret('')`), preserving the user's typed value in the input.<br>3. Placeholder when secret exists in DB: `(บันทึกไว้แล้ว - กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยน)`. | Component test entering secret, clicking test, asserting input still displays typed plaintext characters. |
| **LOA-09** | PO Request & Q2=ก | 1. In `LineQuotaBadge.tsx` and `LineNotificationModal.tsx`, remove lenient fallback `isReady: Boolean(data.isReady \|\| (data.connected && data.credentialsVerified))`.<br>2. Base readiness strictly on `Boolean(data.isReady)`.<br>3. When `data.connected` is true but `!data.isReady` (webhook not tested/active):<br>   - Top bar badge displays amber/slate status "รอเชื่อมต่อ Webhook" or "ยังไม่พร้อมใช้งาน", NOT "พร้อมใช้งาน".<br>   - Modal in `LineQuotaBadge` does NOT falsely display "พร้อมใช้งาน" when webhook is incomplete.<br>   - `LineNotificationModal` shows "ยังไม่พร้อมใช้งาน" with setup CTA. | Unit tests asserting that when `data.connected=true` and `data.isReady=false`, badge shows "รอเชื่อมต่อ Webhook" and does not claim readiness. |
| **LOA-10** | PO Request & Q3=ก | In `LineQuotaBadge.tsx` modal header banner, add an edit LINE OA button (`Settings` icon + "แก้ไข LINE OA" text) right next to the `X` close button. Clicking it closes the quota modal and invokes `onNavigateToLineConfig()`. | Component test asserting presence of edit button in modal header and callback invocation. |
| **LOA-11** | PO Request 1 & Q1=ก, Q4=ก | In `LineQuotaBadge.tsx`, when `!isConfigured` (including when `isPendingWebhook` is true), clicking the status pill directly invokes `onNavigateToLineConfig()` to open the LINE OA Setup Modal (Image 2), bypassing the intermediate orange warning modal (Image 1). | Component test verifying that clicking the "รอเชื่อมต่อ Webhook" pill directly triggers `onNavigateToLineConfig()`. |
| **LOA-12** | PO Request 2 & Q2=ก | 1. Eye icon status indicator: When `showSecret = true`, display `<Eye />` (รูปตาเปิด). When `showSecret = false`, display `<EyeOff />` (รูปตาขีด).<br>2. When in masked mode (`showSecret = false`), typing or pasting into the input displays the last character in plaintext for 800ms before turning into `•`. | Component test verifying icon swap, and testing that typing in masked mode shows the last character before masking. |
| **LOA-13** | PO Request & Round 2 Q1=ก, Q3=ก, Round 3 Timing | 1. Clicking "คัดลอก" on the Webhook URL for the first time copies the URL immediately (shows "คัดลอกแล้ว!" feedback), sets `hasOpenedConsoleTab = true`, and opens `https://developers.line.biz/console/channel/{effectiveChannelId}/messaging-api` in a new tab after 2 seconds (2000ms) if `effectiveChannelId` exists.<br>2. Subsequent clicks copy the URL normally without re-opening the tab.<br>3. If `effectiveChannelId` is empty, only copy to clipboard without opening tab. | Unit test verifying copy success immediately and `window.open` called after 2 seconds (2000ms), and not called on second click. |
| **LOA-14** | PO Request & Round 2 Q2=ก, Q3=ก | 1. When `effectiveChannelId` is present, the text `LINE Developers Console > Messaging API` below the Webhook URL input renders as an interactive link with underline decoration and link coloring, opening `https://developers.line.biz/console/channel/{effectiveChannelId}/messaging-api` in a new tab (`target="_blank" rel="noopener noreferrer"`).<br>2. When `effectiveChannelId` is empty, the text renders as normal plain text without link/underline. | Unit test asserting `a` tag rendering with href when channelId present, and plain span/text when absent. |
| **LOA-15** | PO Request & Round 2 Q4=ก | Parity in `src/pages/owner/register.tsx` (Step 6): Copy button auto-opens LINE console after 2 seconds on first click when Channel ID present, and helper text link renders as interactive link when Channel ID present and plain text when absent. | Unit tests in registration test suite or parity suite. |
| **LOA-16** | PO Request & Round 3 Q1=ก | Connection-Gated Console Link: `LINE Developers Console > Messaging API` link is only interactive and clickable when LINE OA is successfully connected (`config.connected` in `OwnerLineOaPage` and `formData.lineOA.isConnected` in `register.tsx`). Otherwise renders as normal plain text. | Unit tests verifying link is absent/plain when connected is false, and present with href when connected is true. |
| **LOA-17** | PO Request & Round 3 Q2=ค | Webhook Helper Copywriting: Update the instruction under Webhook URL to: `"นำ Webhook URL ไปใส่และเปิด Use Webhook ใน [LINE Developers Console > Messaging API]"` uniformly across `line-oa.tsx` and `register.tsx`. | Unit test verifying exact Thai string. |
| **LOA-18** | PO Request & Round 3 Q3=ก | Password Visibility Toggle & Last-Character Preview in Step 6: In `register.tsx`, add `Eye` / `EyeOff` toggle and 800ms last-character preview on typing/pasting into `LINE Channel Secret`, matching `line-oa.tsx`. | Unit test verifying eye toggle and typing behavior in Step 6. |
| **LOA-19** | PO Request & Round 3 Q4=ก | Immediate Credential Invalidation on Input Change: In `OwnerLineOaPage` (`line-oa.tsx`), editing either `LINE Channel ID` or `LINE Channel Secret` immediately invalidates previous connection status (`connected: false`, `isReady: false`, `credentialsVerified: false`, `webhookUrl: null`, clearing bot profile data), matching Step 6 of `register.tsx`. | Unit test verifying that typing in channelId or channelSecret resets connection and hides Webhook URL. |
| **LOA-20** | PO Request & Round 4 Q1=ก | Fallback Console Link Destination: In both `line-oa.tsx` and `register.tsx`, when LINE OA is not connected or Channel ID is empty, the `LINE Developers Console > Messaging API` text renders as an active external link pointing to root console `https://developers.line.biz/console/`. When connected with Channel ID, it links to `https://developers.line.biz/console/channel/${channelId}/messaging-api`. | Unit test verifying href changes from general console root to specific channel console on connection. |
| **LOA-21** | PO Request & Round 4 Q2=ก | Step 6 "ดูวิธีตั้งค่า LINE OA" Button & Modal: In `src/pages/owner/register.tsx`, add a "ดูวิธีตั้งค่า LINE OA" button (with `HelpCircle` icon) adjacent to "ตั้งค่าภายหลัง ->" in the header. Clicking it opens the 5-step LINE OA Setup Modal. | Component test asserting button rendering and modal open/close in Step 6. |
| **LOA-22** | PO Request & Round 4 Q3=ก & Follow-up | Channel Secret Masked Copy Block & UI Cleanliness: In both `line-oa.tsx` and `register.tsx`, manual copying (copy/cut) of masked bullets is blocked when `!showSecret`. Per PO direct instruction, remove the redundant Copy button from the Secret input field UI, keeping only the Eye toggle button with `pr-10` padding to maximize space for placeholder text. | Unit test verifying onCopy/cut blocked when masked, permitted when open, and copy button is absent from secret input. |
| **LOA-23** | PO Request & Round 5 Q1=ก | Webhook URL Label & Console Link Parity: In `OwnerLineOaPage` (`line-oa.tsx`), display `(นำ Webhook URL ไปใส่และเปิด Use Webhook ใน [LINE Developers Console > Messaging API])` in the label above the Webhook URL input, exactly matching Step 6 of `register.tsx`. The link is interactive at all times (fallback to console root when unverified, and channel messaging-api when connected). Below the input, display `* กรุณากรอก LINE Channel ID และ LINE Channel Secret ด้านบน แล้วกดทดสอบตรวจสถานะ` when not verified. | Unit test verifying Webhook label contains the interactive Console link in both unverified and verified states in `OwnerLineOaPage`. |

---

## 3. Scope of Changes

1. `src/pages/owner/line-oa.tsx`:
   - Compute `consoleUrl = (config.connected && effectiveChannelId) ? 'https://developers.line.biz/console/channel/' + effectiveChannelId + '/messaging-api' : 'https://developers.line.biz/console/'`.
   - In the Webhook URL `<label>`, render `(นำ Webhook URL ไปใส่และเปิด Use Webhook ใน [LINE Developers Console > Messaging API])` matching Step 6.
   - On `LINE Channel Secret` input, block `onCopy` and `onCut` when `!showSecret`.
   - Remove Secret copy button from UI; keep single Eye toggle button with `pr-10` padding.
2. `src/pages/owner/register.tsx`:
   - Compute `consoleUrl = (formData.lineOA.isConnected && formData.lineOA.channelId?.trim()) ? 'https://developers.line.biz/console/channel/' + formData.lineOA.channelId.trim() + '/messaging-api' : 'https://developers.line.biz/console/'`.
   - Render `LINE Developers Console > Messaging API` as an `<a>` tag pointing to `consoleUrl`.
   - Add "ดูวิธีตั้งค่า LINE OA" button next to "ตั้งค่าภายหลัง ->" in Step 6 header, rendering 5-step help modal on click.
   - On `LINE Channel Secret` input, block `onCopy` and `onCut` when `!showSecret`.
   - Remove Secret copy button from UI; keep single Eye toggle button with `pr-10` padding.
3. `src/tests/line-oa-setup-step6-parity.test.tsx`:
   - Add test coverage for LOA-23 asserting label format and interactive link in `OwnerLineOaPage`.

