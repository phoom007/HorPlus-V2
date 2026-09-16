# ONBOARDING REGISTRATION STABILITY, UUID SANITIZATION, AND UI PARITY SPECIFICATION (SPEC-ORS-01)

## 1. Executive Summary & Problem Statement

Users encounter four stability and UX issues during dormitory onboarding/registration and owner settings:
1. **Logo Upload & UUID Crash**:
   When uploading a dormitory logo at Step 1 of registration (`/owner/register`), the system crashes with:
   `Invalid tx.dormitory.count() invocation in server/src/services/dormitory-provisioning.service.ts:174:52`
   `Inconsistent column data: Error creating UUID, invalid character: expected an optional prefix of 'urn:uuid:' followed by [0-9a-fA-F-], found 'g' at 2`
   This is caused by non-UUID user IDs (e.g. Google OAuth user identifiers `google-oauth2|...` or synthetic `ag_user_...`) being passed to native PostgreSQL `@db.Uuid` columns (`createdByUserId`, `userId`) in `dormitory-provisioning.service.ts`, `onboarding.service.ts`, and `onboarding.routes.ts`. Because `prepareProvisionalDormitory` fails, `ensureProvisionalDormitoryId()` throws an error, causing the uploaded logo to disappear.
2. **Typography Consistency ("Prompt")**:
   Certain form elements (especially `textarea` for "ที่อยู่หอพัก") do not consistently apply the project's primary brand font ("Prompt") due to browser user-agent stylesheet defaults on form controls.
3. **Bank Account Fields Disabled State Parity**:
   When "ธนาคารที่รับโอน" (Receiving Bank) is `-- เลือกธนาคาร --` (unselected / empty string):
   - Currently, only "เลขที่บัญชีธนาคาร" (Account Number) is disabled.
   - "ชื่อบัญชีธนาคาร" (Account Name) and "QRCode ธนาคาร (ไม่บังคับ)" (`BankQrCodeUploader`) remain interactively enabled, causing inconsistent form validation.
   - **PO Decision (A1)**: When disabled, both fields must be disabled while **preserving previously entered/uploaded values** (do not clear), so the data reappears if the user reselects a bank. This must be aligned in both `register.tsx` and `settings.tsx`.
4. **Electronic Signature Persistence on Step 5**:
   When an owner draws a signature in Step 5 of registration, navigating forward/backward or refreshing the page (F5) causes the signature to disappear.
   Root cause: `src/utils/localDraftStorage.ts` explicitly wiped any `ownerSignatureUrl` starting with `data:` inside `sanitizeDraftForStorage`, causing local storage/IndexedDB to discard the drawn signature.

---

## 2. Canonical Authorities & Invariants

- **Authority 1: PO Direct Request & Confirmed Decisions**:
  - Resolve logo upload crash and underlying UUID error.
  - Enforce "Prompt" font across all text areas, inputs, and labels ("ที่อยู่หอพัก").
  - Disable "ชื่อบัญชีธนาคาร" and "QRCode ธนาคาร" when bank is unselected, retaining entered/uploaded values without clearing them.
  - Persist drawn signature across navigation and F5 reload.
- **Authority 2: Existing UUID Sanitization Pattern**:
  - `sanitizeActorUserIdToUuid` in `server/src/services/idempotency.service.ts` deterministically strips `ag_user_` / `ag_` prefixes or hashes non-UUID strings to standard UUID strings.
- **Authority 3: Security & Isolation Invariants (SEC-01 through SEC-08)**:
  - Multi-tenant dormitory isolation and RLS context preserved.
  - BigInt satang integer arithmetic preserved everywhere.
  - Approved Thai copywriting ("ระบบตรวจสลิป", "ช่าง / แม่บ้าน", "ผู้จัดการ", "เจ้าของหอพัก") preserved.

---

## 3. Acceptance Criteria

| Criterion ID | Requirement Summary | PO Source | Acceptance Verification Target |
|---|---|---|---|
| **ORS-01** | Backend UUID Sanitization in Provisioning & Onboarding | User crash report (`tx.dormitory.count`) | `dormitory-provisioning.service.ts`, `onboarding.service.ts`, and `onboarding.routes.ts` sanitize `userId` with `sanitizeActorUserIdToUuid`. No Prisma P2023 crash on Google OAuth IDs or synthetic strings. |
| **ORS-02** | Dormitory Logo Upload & Provisioning Flow Integrity | User report ("โลโก้หอพักหาย") | `ensureProvisionalDormitoryId()` succeeds. Logo upload persists to provisional dormitory and draft storage. |
| **ORS-03** | Typography & "Prompt" Font Consistency | User request ("ที่อยู่หอพัก ควรเป็น font prompt") | `src/index.css` applies `font-family: "Prompt", var(--font-sans), sans-serif !important` to `textarea, input, select, button, label`. Form controls render Prompt without fallback. |
| **ORS-04** | Bank Account & QR Code Fields Disabled State Parity | User request + PO Decision A1 | When `bankName` is empty, "ชื่อบัญชีธนาคาร" and `<BankQrCodeUploader>` are disabled with appropriate styling and placeholder. Previous values are PRESERVED in state (not wiped). Implemented in both `register.tsx` and `settings.tsx`. |
| **ORS-05** | Step 5 Signature Persistence Across Navigation & Reload | User request ("ลายเซ็นที่วาดไว้มันหาย") | `localDraftStorage.ts` retains `ownerSignatureUrl` in `sanitizeDraftForStorage`. `register.tsx` restores drawn signature to canvas upon mount / returning to Step 5. |
| **ORS-06** | Automated Test Suite & Build Verification | Quality Gate | All unit and integration tests pass cleanly; TypeScript and Vite builds compile with exit code 0. |

---

## 4. Planned Changes by Component

### Backend
1. `server/src/services/dormitory-provisioning.service.ts`:
   - Import `sanitizeActorUserIdToUuid` from `./idempotency.service.js`.
   - In `prepareProvisionalDormitory(userId, ...)`: apply `const safeUserId = sanitizeActorUserIdToUuid(userId);` before all Prisma queries (`tx.dormitory.count`, `tx.onboardingDraft.findUnique`, `tx.dormitory.create`, etc.).
   - In `completeOwnerOnboarding(params)`: apply `const safeUserId = sanitizeActorUserIdToUuid(params.userId);` across all idempotency, draft, intent, and membership queries.
2. `server/src/services/onboarding.service.ts`:
   - Import `sanitizeActorUserIdToUuid` from `./idempotency.service.js`.
   - Apply `sanitizeActorUserIdToUuid(userId)` in `getStatus`, `getDraft`, `saveDraft`, `deleteDraft`.
3. `server/src/routes/onboarding.routes.ts`:
   - Pass sanitized `userId` where applicable.

### Frontend
1. `src/utils/localDraftStorage.ts`:
   - In `sanitizeDraftForStorage(draft)`: Do NOT blank `ownerSignatureUrl` when it starts with `data:`. Retain it so local storage / IndexedDB preserves the signature across page refreshes.
2. `src/components/settings/BankQrCodeUploader.tsx`:
   - Ensure `disabled` prop styles upload button with `opacity-50 bg-slate-100 border-slate-200 cursor-not-allowed pointer-events-none text-slate-400`.
   - Disable file input and remove button when `disabled` is true.
3. `src/pages/owner/register.tsx`:
   - Step 4: Add `disabled={!formData.paymentAccount.bankName}` to "ชื่อบัญชีธนาคาร" input, with placeholder `formData.paymentAccount.bankName ? 'เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีธนาคาร)' : 'กรุณาเลือกธนาคารก่อน'`, and disabled styling.
   - Step 4: Pass `disabled={!formData.paymentAccount.bankName}` to `<BankQrCodeUploader>`.
   - Retain values when bank name is unselected (do not clear).
   - Step 5: Canvas restoration `useEffect` ensures canvas redraws `formData.ownerSignatureUrl` safely with `crossOrigin = 'anonymous'` and DOM ready check.
4. `src/pages/owner/settings.tsx`:
   - Apply identical disabled parity for `localBankAccountName` and `<BankQrCodeUploader>` when `!localBankName`.
5. `src/index.css`:
   - Enforce `font-family: "Prompt", var(--font-sans), sans-serif !important;` on `input, textarea, select, button, label, *`.

---

## 5. Test & Verification Plan

1. Backend Unit Tests:
   - Test `prepareProvisionalDormitory` and `OnboardingService` with non-UUID Google user IDs and synthetic IDs, verifying zero Prisma P2023 crashes.
2. Frontend Unit Tests:
   - Test Bank account name and QR code uploader disabled states in `register.tsx` and `settings.tsx`.
   - Test value preservation when bank selection changes to empty string.
   - Test `localDraftStorage.ts` signature preservation in `sanitizeDraftForStorage`.
   - Test canvas signature restoration in Step 5.
3. Full Build Verification:
   - `npm --prefix server run build`
   - `npm run build`
