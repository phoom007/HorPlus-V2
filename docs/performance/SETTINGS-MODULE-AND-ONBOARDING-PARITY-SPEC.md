# SETTINGS-MODULE-AND-ONBOARDING-PARITY-SPEC
## Authoritative Database Persistence, Strict UI Preservation, and Registration Parity

**Document Version**: 1.0.0  
**Date**: 2026-09-14  
**Author**: Antigravity Main Agent  
**Review Stage**: Gate A — Specification Review (BEFORE implementation)  
**Applicable Agreement**: `c:\HORPLUS-V2\HORPLUS_V2_ANTIGRAVITY_WORKFLOW_PROMPTS.md`

---

## 1. OBJECTIVE / SCOPE

### 1.1 Business Objective
1. **Connect Settings Module to Real PostgreSQL Database**:
   Integrate the user's freshly redesigned Settings UI (`src/pages/owner/settings.tsx`) with real backend REST APIs (`/dormitories/:dormitoryId`, `/billing-settings`, `/payment-settings`, `/logo`, `/signature`), eliminating mock data dependencies (`mockData.ts`) while preserving 100% of the user's visual design, layout, and interaction paradigms.
2. **Preserve Exact UI Design & Interaction Patterns (Strict Constraint)**:
   Per the PO's explicit constraint (*"ไม่ไปลบ หรือ สร้าง UI ใหม่เพิ่มนะครับ"*), do NOT delete, redesign, or create new UI components or buttons in `settings.tsx`. Every field blur (`onBlur`), dropdown/toggle switch, and explicit button ("บันทึกกฎระเบียบ & นโยบายสัตว์เลี้ยง") must retain its existing visual look and trigger real backend persistence.
3. **Resolve Component Import Errors**:
   Extract and centralize `DormitoryLogoUploader` into `src/components/settings/DormitoryLogoUploader.tsx` and import `TieredRateEditor` from `src/components/settings/TieredRateEditor.tsx`, resolving Vite rollup build failures.
4. **Registration Parity (PO Confirmed Enhancements)**:
   - In `src/pages/owner/register.tsx` (Step 5), align the 4 pet policy labels and keys with `settings.tsx`:
     1) `สุนัข (Dog)`
     2) `แมว (Cat)`
     3) `สัตว์เล็ก (กระต่าย/หนู/นก)`
     4) `สัตว์แปลก (Other)`
   - In `src/pages/owner/register.tsx` (Step 3: ค่าเช่า & ค่าน้ำไฟ), add the VAT 7% configuration section matching `settings.tsx` (toggle + category checklist) and persist it during onboarding finalize.

---

## 2. CANONICAL AUTHORITIES & REPOSITORY DATA FLOW

1. **Dormitory Profile & Rules/Pet Authority**:
   - Routes: `GET /api/v1/dormitories/:dormitoryId` and `PATCH /api/v1/dormitories/:dormitoryId`
   - Repository: `server/src/db/repositories/dormitory.repository.ts`
   - Prisma Model: `Dormitory` & `DormitoryPropertyDefaults` (`name`, `addressLine1`, `taxId`, `phone`, `petPolicy`, `rulesTemplate`, `logoObjectKey`)
2. **Billing Settings Authority**:
   - Routes: `GET /api/v1/dormitories/:dormitoryId/billing-settings` and `PATCH /api/v1/dormitories/:dormitoryId/billing-settings`
   - Repository: `server/src/db/repositories/billing-settings.repository.ts`
   - Prisma Model: `DormitoryBillingSettings` (`billingDay`, `dueDay`, `waterBillingType`, `waterRate`, `waterTierRates`, `electricityBillingType`, `electricityRate`, `electricityTierRates`, `commonFee`, `commonFeeMode`, `internetFee`, `internetFeeMode`, `parkingRate`, `parkingFeeMode`, `lateFeeType`, `lateFeeValue`, `vatSettings`)
3. **Payment Settings Authority (Sensitive Field Encryption)**:
   - Routes: `GET /api/v1/dormitories/:dormitoryId/payment-settings` and `PATCH /api/v1/dormitories/:dormitoryId/payment-settings`
   - Service: `server/src/services/sensitive-field.service.ts` (AES-256-GCM encryption for `promptPayValueEncrypted` and `bankAccountNumberEncrypted`)
4. **Logo & Signature Authorities**:
   - Logo: `POST /api/v1/dormitories/:dormitoryId/logo`, `GET`, `DELETE`
   - Signature: `POST /api/v1/dormitories/:dormitoryId/signature`, `GET` via `SignatureStorageService`
5. **UI & Workspace Context**:
   - Container: `src/pages/owner.tsx` passes `dormitoryId={validDormId}` into `<OwnerSettings />`.
   - Settings Page: `src/pages/owner/settings.tsx`.
   - Registration Page: `src/pages/owner/register.tsx`.

---

## 3. LOCKED BEHAVIORS & BOUNDARIES

1. **Security & RBAC**:
   - Preserve CSRF token verification via `X-CSRF-Token` header.
   - Preserve role permissions: `dormitory:update`, `billing_settings:update`, `payment_settings:update`.
   - Preserve dormitory tenant isolation (`requireDormitoryContextMiddleware`).
2. **Approved Thai Copywriting**:
   - Preserve all existing Thai titles, placeholders, chip labels, and toast messages ("กำลังบันทึก...", "บันทึกแล้ว", "อัปโหลด QRCode ธนาคารสำเร็จ", "บันทึกกฎระเบียบ & นโยบายสัตว์เลี้ยง").
3. **No Added/Deleted UI Elements**:
   - Strictly no new master save button, no deletion of existing cards, no restyling of grid/colors.

---

## 4. ACCEPTANCE CRITERIA

| Criterion ID | PO Source | Description | Planned Verification |
|---|---|---|---|
| **SET-01** | Q1 = ก | **Authoritative Settings Data Persistence**: Settings in `settings.tsx` loads from and saves to real PostgreSQL backend endpoints (`/dormitories/:id`, `/billing-settings`, `/payment-settings`, `/logo`, `/signature`). Zero reliance on `mockData.ts`. | Automated Vitest + curl verification of backend persistence. |
| **SET-02** | Q2 = ก | **UI Layout & Interaction Fidelity**: 100% of user's new visual design, cards, tabs, chips, and colors in `settings.tsx` are preserved without deletion or addition. Field blurs, toggle switches, and explicit buttons trigger real API saves. | Component render tests checking elements, blur handlers, and toast transitions. |
| **SET-03** | Q3 = ก | **Active Dormitory Context in `owner.tsx`**: `OwnerSettings` receives `dormitoryId={validDormId}` from `owner.tsx`, invalidating queries on change and updating header display upon save. | Component interaction tests and React Query cache invalidation verification. |
| **SET-04** | Q4 = ก | **Component Import Resolution & Build Health**: `DormitoryLogoUploader` is extracted to `src/components/settings/DormitoryLogoUploader.tsx`, resolving Vite rollup build error. Both `register.tsx` and `settings.tsx` import it cleanly. | `npm run build` succeeds with exit code 0. |
| **SET-05** | User addition | **Register Step 5 Pet Policy 4-Label Parity**: In `register.tsx`, the 4 pet options display exact matching labels: `สุนัข (Dog)`, `แมว (Cat)`, `สัตว์เล็ก (กระต่าย/หนู/นก)`, `สัตว์แปลก (Other)`. | Unit test verifying rendered options and checked state in register.tsx. |
| **SET-06** | User addition | **Register Step 3 VAT 7% Calculation**: In `register.tsx` (Step 3), render VAT 7% toggle and category checklist matching Settings, and persist in finalize payload. | Unit test verifying toggle, categories, and onboarding payload mapping. |
| **SET-07** | Q1 = ก | **Backend & Prisma Schema Support for `vatSettings`**: Add `vatSettings Json? @map("vat_settings")` to `DormitoryBillingSettings`, update schema, migration, and DTOs. | Prisma schema validation, migration check, and route integration tests. |

---

## 5. TARGETED VERIFICATION PLAN

1. **Prisma & Migration**:
   - Update `server/prisma/schema.prisma` with `vatSettings Json? @map("vat_settings")` in `DormitoryBillingSettings`.
   - Run `npx prisma db push` or create migration to ensure database table is synchronized.
2. **Backend Routes & DTOs**:
   - In `server/src/routes/dormitory.routes.ts`, include `vatSettings` in `publicBillingDTO` and `PATCH /billing-settings`.
   - Update `OnboardingBillingInputSchema` in `server/src/types/onboarding-validation.ts`.
3. **Frontend Adapter & Services**:
   - Implement `src/services/billing-settings.service.ts` for `GET` and `PATCH` `/dormitories/:id/billing-settings`.
   - Verify `src/services/dormitory.service.ts` and `src/services/payment-settings.service.ts`.
   - Extract `src/components/settings/DormitoryLogoUploader.tsx`.
4. **Automated Tests**:
   - Unit tests for Settings persistence, blur handlers, and pet/rules save in `src/tests/owner-settings-persistence.test.tsx`.
   - Unit tests for Registration pet policy and Step 3 VAT in `src/tests/owner-register-vat-and-pets.test.tsx`.
   - Build checks: `npm run build` and `npm --prefix server run build`.
