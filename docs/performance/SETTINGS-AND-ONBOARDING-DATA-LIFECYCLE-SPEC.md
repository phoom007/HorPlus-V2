# HorPlus-V2 — Settings & Onboarding Data Lifecycle Architecture Spec (SPEC-SOD-01)

## 1. OBJECTIVE / SCOPE
Eliminate architectural friction, split-brain state, and data loss between Dormitory Onboarding (`src/pages/owner/register.tsx`) and the Owner Settings workspace (`src/pages/owner/settings.tsx`):
1. **Dormitory Settings Persistence & Logo Streaming**:
   - Pass `dormitoryId={activeDormId}` to `<DormitoryLogoUploader>`.
   - Map `logoUrl` in backend `dormitory.repository.ts` and `GET /api/v1/dormitories/:dormitoryId`.
   - Eliminate `localStorage` mockData overrides on field blur in `settings.tsx`.
   - Permit `taxId` and `addressLine1` in `UpdateDormitoryInputSchema`.
   - Sanitize/strip non-column fields (`taxId`) in `dormitory.repository.ts` before calling `this.prisma.dormitory.update()` to prevent Prisma `Unknown argument 'taxId'` runtime crashes.
   - Enforce `font-prompt` across dormitory address textarea and settings typography.
2. **Bank Code Normalization Seam**:
   - Standardize canonical short codes (`'SCB'`, `'KBANK'`, `'BBL'`, `'KTB'`, `'TTB'`, `'BAY'`, etc.) in Database and API.
   - Backed by a shared bidirectional adapter `normalizeBankCode()` in `src/utils/bank-helper.ts`.
   - Align `<select>` in `settings.tsx` and `src/pages/owner/register.tsx` to use canonical short code values and Thai labels, preventing accidental dropdown deselection to `"-- เลือกธนาคาร --"` and subsequent false disabling of bank account fields.
3. **Registration-to-Settings Financial Data Seam Closure**:
   - Add `bankQrCode String? @map("bank_qr_code") @db.Text` to `model DormitoryBillingSettings` in `server/prisma/schema.prisma` and apply SQL migration.
   - Map `bankQrCode` in `BillingSettingsEntity`, `CreateBillingSettingsData`, `InMemoryBillingSettingsRepository`, and `PrismaBillingSettingsRepository.mapToEntity` in `server/src/db/repositories/billing-settings.repository.ts`.
   - Persist `payment.bankQrCode` during onboarding finalization (`completeOwnerOnboarding` in `dormitory-provisioning.service.ts`).
   - Return `bankQrCode` in `publicPaymentDTO` (`GET /payment-settings`).
   - Accept/persist `bankQrCode` in `PATCH /payment-settings`.
   - In `settings.tsx`, initialize `localQrCodeUrl` from `payRes.bankQrCode` and dispatch `updatePaymentSettings(activeDormId, { bankQrCode: newQr })` in `handleQrCodeChange`.
4. **Owner Profile UI Boundary Preservation**:
   - Maintain the authorized UI layout in the "ข้อมูลเจ้าของหอพัก" card (Logo, Dormitory Name, Address, Payment Settings) without injecting unauthorized name/email/phone inputs as explicitly confirmed by the PO in Q4.
5. **Automated Verification & TDD Integrity**:
   - Follow strict TDD (Red -> Green on pre-agreed seams).
   - 100% test pass rate and clean production builds.

---

## 2. INSPECT FIRST & CANONICAL AUTHORITIES
- **PO Authorizations**:
  - PO User Request: Issues reported with logo upload, dormitory address font, bank dropdown, and missing onboarding payment settings in settings menu.
  - PO Confirmed Q1 = A: Standard Short Code in DB/API (`'SCB'`, etc.), `<select value="SCB">` with Thai label `"ไทยพาณิชย์ (SCB)"`, backed by `normalizeBankCode()`.
  - PO Confirmed Q2 = ก: Base64 Data URL or Image URI in `dormitory_billing_settings.bank_qr_code`, returned in `GET /payment-settings` and accepted in `PATCH /payment-settings`.
  - PO Confirmed Q3 = ก: Collapse Settings Split-Brain: eliminate `localStorage (saveDormitory)` mockData from `settings.tsx`. Pass `dormitoryId` to `DormitoryLogoUploader`, map `logoUrl` in backend DTO, allow `taxId` in `UpdateDormitoryInputSchema`, and enforce Prompt font.
  - PO Confirmed Q4: Keep existing UI in "ข้อมูลเจ้าของหอพัก" as designed; do not inject extra inputs for owner name/email/phone.
  - PO Confirmed Q5 = ก: Implement Candidates 1, 2, and 3 from architecture review.
  - PO Requested: `/tdd`.
- **Target Files**:
  - `server/prisma/schema.prisma`
  - `server/prisma/migrations/20260914160000_add_bank_qr_code_to_billing_settings/migration.sql`
  - `server/src/db/repositories/billing-settings.repository.ts`
  - `server/src/db/repositories/dormitory.repository.ts`
  - `server/src/routes/dormitory.routes.ts`
  - `server/src/types/onboarding-validation.ts`
  - `server/src/services/dormitory-provisioning.service.ts`
  - `src/utils/bank-helper.ts` (New deep module)
  - `src/services/dormitory.service.ts`
  - `src/services/payment-settings.service.ts`
  - `src/pages/owner/settings.tsx`
  - `src/pages/owner/register.tsx` (Corrected authoritative path)

---

## 3. LOCKED BEHAVIORS & BOUNDARIES
- **Security Controls (SEC-01 through SEC-08)** remain strictly preserved.
- **Tenant Isolation**: All queries and mutations must strictly enforce `dormitoryId` context.
- **Role Isolation**: Owner-only settings boundaries remain enforced (manager/staff denied access to payment settings and staff management).
- **Approved Thai Copywriting**: UI labels preserved exactly (`"โลโก้หอพัก (ไม่บังคับ)"`, `"ชื่อหอพัก *"`, `"ที่อยู่หอพัก"`, `"ตั้งค่าบัญชีรับเงิน"`, `"ไทยพาณิชย์ (SCB)"`, etc.).
- **No Unauthorized UI Additions**: No new input fields added to the "ข้อมูลเจ้าของหอพัก" section.

---

## 4. ACCEPTANCE CRITERIA
- **SOD-01: Settings Split-Brain Collapse & Dormitory Profile Persistence**
  - In `src/pages/owner/settings.tsx`, `<DormitoryLogoUploader>` receives `dormitoryId={activeDormId}`.
  - `server/src/db/repositories/dormitory.repository.ts` maps `logoUrl: model.logoObjectKey ? \`/api/v1/dormitories/\${model.id}/logo\` : null` and `hasLogo: Boolean(model.logoObjectKey)` in `findById`.
  - In `dormitory.repository.ts`, `update(id, data)` strips non-column fields like `taxId` before calling `this.prisma.dormitory.update()`, guaranteeing safe updates without Prisma runtime crashes (Addressing F-03).
  - `server/src/routes/dormitory.routes.ts` returns `logoUrl` and `hasLogo` in `GET /api/v1/dormitories/:dormitoryId`.
  - `UpdateDormitoryInputSchema` in `server/src/types/onboarding-validation.ts` allows `taxId: z.string().trim().optional().nullable()` and `addressLine1: z.string().trim().optional().nullable()`.
  - Blur handler in `settings.tsx` saves directly to `updateDormitoryProfile` without falling back to or comparing with stale `saveDormitory` mockData.
  - Dormitory address textarea strictly applies `font-prompt`.
- **SOD-02: Canonical Bank Code Normalizer & Dropdown Seam Parity**
  - `src/utils/bank-helper.ts` exposes `normalizeBankCode(raw: string | null | undefined): string`, `getBankDisplayName(code: string | null | undefined): string`, and `SUPPORTED_BANKS` list.
  - Bank select in `settings.tsx` and `src/pages/owner/register.tsx` uses canonical short code values (`'SCB'`, `'KBANK'`, `'BBL'`, `'KTB'`, `'TTB'`, `'BAY'`, `'GSB'`, `'KKP'`, `'TISCO'`, `'CIMB'`, `'UOB'`).
  - When payment settings load with `bankCode: 'SCB'`, dropdown selects SCB reliably. Account number, account name, and QR code sections stay enabled and interactive.
- **SOD-03: Registration-to-Settings Financial Data Seam Closure**
  - `model DormitoryBillingSettings` in `server/prisma/schema.prisma` includes `bankQrCode String? @map("bank_qr_code") @db.Text` with executed SQL migration (Addressing F-01).
  - `server/src/db/repositories/billing-settings.repository.ts` defines and maps `bankQrCode` across `BillingSettingsEntity`, `CreateBillingSettingsData`, and `mapToEntity` (Addressing F-02).
  - `completeOwnerOnboarding` in `server/src/services/dormitory-provisioning.service.ts` saves `payment.bankQrCode` to `dormitory_billing_settings.bank_qr_code`.
  - `server/src/routes/dormitory.routes.ts` (`GET /payment-settings`) returns `bankQrCode` in `publicPaymentDTO`.
  - `PATCH /payment-settings` in `dormitory.routes.ts` accepts `bankQrCode` in `PaymentSettingsUpdateSchema` and updates `bank_qr_code`.
  - `PaymentSettingsDTO` and `PaymentSettingsUpdatePayload` in `src/services/payment-settings.service.ts` include `bankQrCode?: string | null`.
  - In `settings.tsx`, `localQrCodeUrl` initializes with `payRes.bankQrCode`, displaying the uploaded QR code immediately on page load.
  - In `settings.tsx`, `handleQrCodeChange` dispatches `updatePaymentSettings(activeDormId, { bankQrCode: newQr })` for real-time cloud persistence (Addressing F-05).
- **SOD-04: Owner Profile UI Boundary Preservation**
  - The UI in the "ข้อมูลเจ้าของหอพัก" card displays strictly the authorized elements (Logo, Dormitory Name, Address, Payment Settings).
  - No unauthorized inputs for owner name/email/phone are rendered per PO Q4.
- **SOD-05: Automated Verification & TDD Integrity**
  - Unit/integration tests written test-first verifying the pre-agreed seams.
  - Frontend vitest tests and backend npm tests pass at 100%.
  - `npm --prefix server run build` and `npm run build` succeed with 0 errors.

---

## 5. TDD SEAMS & TEST PLAN
1. **Seam 1: Backend Dormitory Detail & Logo URL DTO + TaxId Prisma Guard**
   - `server/src/__tests__/unit/dormitory-profile-logo-dto.test.ts`
   - Test that `dormitoryRepo.findById` and `GET /api/v1/dormitories/:dormitoryId` return `logoUrl` and `hasLogo`.
   - Test that `dormitoryRepo.update` strips `taxId` and updates without Prisma Unknown Argument error.
2. **Seam 2: Backend Payment Settings QR Code & Billing Settings Seam**
   - `server/src/__tests__/unit/payment-settings-qr-seam.test.ts`
   - Test that `billingRepo.findByDormitoryId` and `update` map and persist `bankQrCode`.
   - Test that `GET /payment-settings` and `PATCH /payment-settings` round-trip `bankQrCode`.
   - Test that `completeOwnerOnboarding` saves `payment.bankQrCode`.
3. **Seam 3: Frontend Bank Helper & Normalizer Adapter**
   - `src/tests/bank-helper-normalizer.test.ts`
   - Test two-way normalization between Thai names, short codes, and arbitrary casing.
4. **Seam 4: Frontend Settings Page Persistence & Dropdown Stability**
   - `src/tests/owner-settings-persistence.test.tsx`
   - Test that loading SCB short code selects SCB option, fields remain enabled, QR code is populated, and blur persists via REST without mockData corruption.
