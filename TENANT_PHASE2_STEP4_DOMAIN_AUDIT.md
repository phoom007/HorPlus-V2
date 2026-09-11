# HORPLUS-V2 — TENANT PHASE 2 STEP 4: REGISTRATION DOMAIN AUDIT & LIFECYCLE CORRECTION

> **Notice**: Real source-code audit conducted on branch `review/tenant-ui-baseline-20260904` of `d:\HorPlus-V2`.  
> In accordance with instructions: **NO CODE HAS BEEN MODIFIED**. This report is submitted for Product Owner review and confirmation.

---

## 1. Executive Summary & Core Architectural Finding

The audit confirms that the codebase has mature, high-fidelity implementations for both **Owner Quick Add** (via `ProvisionalRentalTerm` and `DailyStay`) and **Tenant Registration / Claiming** (via `TenantRegistrationService` and `TenantClaimService`).

However, **four foundational architectural divergences** exist between the actual implementation and the Product Owner's locked domain model:

1. **Owner Quick Add creates `ProvisionalRentalTerm`, not `Contract`**:
   - When an owner uses Quick Add (Monthly or Term), the server creates a `Tenant`, an `Occupancy`, and a `ProvisionalRentalTerm` (with immediate rent & deposit bills).
   - It does **not** create a row in the `contracts` table.
   - As a consequence, when an owner-created tenant attempts to claim and sign, the claim handler looks for an active `Contract` to attach the signature to and finds nothing. The agreement remains in `provisional_rental_terms`.
2. **Public Self-Registration collects signature prematurely (Before Owner Review)**:
   - In the 7-step wizard (`TenantRegisterView.tsx`), applicants sign in Step 6 before submitting.
   - When the owner approves via `approveRequest`, the owner can modify rent, deposit, and dates, but the system immediately activates the contract with the *original* signature.
   - The applicant never sees `กรุณาตรวจสอบและยืนยัน` to review and sign the owner-modified terms.
3. **Daily Rental in Wizard leaks into Long-Term Contract flow**:
   - Dedicated daily stays (`daily-stay.service.ts` & `TenantDailyRequestModal.tsx`) correctly use `DailyStay` and `DailyStayInvoice` (no contract).
   - But in `TenantRegisterView.tsx`, selecting "รายวัน" routes through `tenantRegistrationRequest` which on approval generates a full `Contract` row.
4. **Public Room Selection exposes occupied & claimable rooms in the same dropdown**:
   - `getPublicRooms` returns all rooms in the dormitory, causing occupied and claimable rooms to appear in the public dropdown alongside vacant rooms.

---

## 2. Actual Source Evidence by Area

### A. Quick Add Tenant Flow Audit

| Question | Answer | Source Evidence |
|---|---|---|
| **1. Does Quick Add create Tenant immediately?** | **YES** | `server/src/services/provisional-rental-term.service.ts:264-281`<br>`tx.tenant.create({ data: { dormitoryId, tenantNumber, firstName, displayName, phone, status: 'active' } })` |
| **2. Does Quick Add create Occupancy immediately?** | **YES** | `server/src/services/provisional-rental-term.service.ts:283-292`<br>`tx.occupancy.create({ data: { dormitoryId, roomId, tenantId, status: isFuture ? 'RESERVED' : 'ACTIVE', startedAt: ... } })` |
| **3. Does Quick Add create Contract immediately?** | **NO** | `server/src/services/provisional-rental-term.service.ts:294-326`<br>Creates `ProvisionalRentalTerm`, **not** `Contract`. `convertedContractId` is left `null`. |
| **4. Can billing work while `lineFriendId` is null?** | **YES** | `server/src/utils/deposit-billing.util.ts:204-265`<br>`createDepositBillForAgreementInTx` and `createImmediateRentBillForAgreementInTx` query only `dormitoryId`, `roomId`, and `provisionalRentalTermId`/`contractId`. Neither `lineFriendId` nor `linkedUserId` is required. |
| **5. Is "ยังไม่ผูก LINE" only a LINE status?** | **YES** | `src/pages/owner/tenants.tsx:2070-2095` (`getTenantCategory`) categorizes quick-add tenants as `'active'`.<br>`src/pages/owner/tenants.tsx:2498-2506` renders the `ยังไม่ผูก LINE` badge purely as an informational status pill on active tenants when `!isTenantLineBound(tenant)`. |

#### Current Behavior:
Quick Add creates an active `Tenant`, an active/reserved `Occupancy`, a `ProvisionalRentalTerm`, marks the room `occupied`/`reserved`, and creates the initial deposit & rent bills in the database. LINE binding is `null`.

#### Expected Behavior:
Quick Add creates `Tenant`, `Occupancy`, authoritative rental agreement (`Contract` or recognized agreement), `Room = OCCUPIED`, and allows immediate billing without LINE.

#### Gap:
Agreements created via Quick Add reside in `provisional_rental_terms` rather than `contracts`. When other pages or claim flows strictly query `tx.contract`, they do not find the agreement unless provisional terms are handled or converted.

---

### B. Owner-Created Tenant Claim Flow Audit

| Question | Answer | Source Evidence |
|---|---|---|
| **1. Does claim create duplicate Tenant?** | **NO** | `server/src/services/tenant-registration.service.ts:1321-1349` (`completeTenantClaim`) & `server/src/services/tenant-claim.service.ts:511-516` (`claimTenant`)<br>Both execute `tx.tenant.update({ where: { id: candidate.id }, ... })`. No second tenant row is created. |
| **2. Does claim recreate Contract?** | **NO** | Neither service creates a new contract during claim. |
| **3. Does claim recreate Occupancy?** | **NO** | Existing `Occupancy` is preserved. |
| **4. Does claim only update LINE/account binding?** | **YES** | `tenantClaimService.claimTenant` updates `linkedUserId = userId` and adds `DormitoryMember` (role `TENANT`).<br>`tenantRegistrationService.completeTenantClaim` updates `lineFriendId`, fills missing personal info (citizen ID, emergency contacts, co-occupants, pets, vehicles), and sets `status = 'active'`. |
| **5. Is signature handled correctly?** | **PARTIAL GAP** | In `tenant-registration.service.ts:1400-1411`, it attempts:<br>`const contract = await tx.contract.findFirst({ where: { tenantId, roomId, status: 'active' } });`<br>Because Quick Add created a `ProvisionalRentalTerm` and no `Contract`, `contract` is `null`! The uploaded signature is not linked to any agreement, and `provisionalRentalTerm` is not converted to `Contract`. |

---

### C. Public Self-Registration Audit

| Question | Answer | Source Evidence |
|---|---|---|
| **1. Is signature collected before or after owner final approval?** | **BEFORE (Gap)** | `src/components/tenant/TenantRegisterView.tsx:747` & `server/src/services/tenant-registration.service.ts:112-114`<br>Signature is enforced in Step 6 of public submission (`SIGNATURE_REQUIRED`). When owner approves in `approveRequest` (`line 762`), the stored signature is stamped onto the contract without tenant re-confirmation. |
| **2. Are financial fields editable in the correct stage?** | **PARTIAL GAP** | Applicant proposes rent/deposit in Step 3. Owner can override rent/deposit in `ApproveRegistrationDto` (`lines 758-760`).<br>**Gap**: If owner changes rent from 4,000 to 4,500, contract is immediately created and activated without applicant ever seeing the modified terms or signing the final numbers. |
| **3. Is revision flow preserving previous data?** | **YES** | `server/src/services/tenant-registration.service.ts:1003-1025` (`resubmitTenantRegistrationRequest`) & `TenantRegisterView.tsx:685-736`<br>Revising an application pre-populates fields from `acceptanceSnapshot`, accepts updates, and resets status to `pending_owner_approval`. |
| **4. Does rejection keep history?** | **YES** | `server/src/services/tenant-registration.service.ts:945-985` (`rejectTenantRegistrationRequest`)<br>Appends `{ comment, rejectedAt, rejectedByUserId }` to `acceptanceSnapshot.revisionHistory`. |

---

### D. Status Mapping Audit

| Role | Domain Requirement | Current Source Mapping | Match Status |
|---|---|---|---|
| **Owner** | พักอาศัย (Active) | `src/pages/owner/tenants.tsx:2284`<br>Tab: `พักอาศัย ({activeTenants.length})` | ✅ ALIGNED |
| **Owner** | รอตรวจสอบ (Pending) | `src/pages/owner/tenants.tsx:2273`<br>Tab: `รอตรวจสอบ ({pendingTotalCount})`<br>Cards: `รออนุมัติคำขอผู้เช่า`, `กรุณาตรวจสอบอีกครั้ง` | ✅ ALIGNED |
| **Owner** | เลิกเช่าแล้ว (Inactive) | `src/pages/owner/tenants.tsx:2294`<br>Tab: `เลิกเช่าแล้ว ({inactiveTenants.length})` | ✅ ALIGNED |
| **Tenant** | ลงทะเบียนผู้เช่า | `src/components/tenant/TenantRegisterView.tsx:873`<br>Default wizard status pill & claim header | ✅ ALIGNED |
| **Tenant** | รออนุมัติคำขอผู้เช่า | `src/components/tenant/TenantRegisterView.tsx:784`<br>Submission success badge | ✅ ALIGNED |
| **Tenant** | กรุณาตรวจสอบและยืนยัน | `src/components/tenant/TenantRegisterView.tsx:866`<br>Rendered when unbound room is selected before verification | ⚠️ PARTIALLY ALIGNED (Missing in post-owner-approval signing stage) |
| **Tenant** | กรุณาตรวจสอบอีกครั้ง | `src/components/tenant/TenantRegisterView.tsx:856`<br>Rendered in header & banner when `status === 'revision_requested'` | ✅ ALIGNED |
| **Tenant** | ใช้งานได้แล้ว | `src/components/tenant/TenantRegisterView.tsx` | ❌ MISSING (Shows "ลงทะเบียนและยืนยันสิทธิ์สำเร็จ!" instead of canonical status label) |

---

### E. Room Availability Audit

| Question | Answer | Source Evidence |
|---|---|---|
| **1. Is room marked occupied after Quick Add?** | **YES** | `server/src/services/provisional-rental-term.service.ts:669-676`<br>`tx.room.update({ where: { id: roomId }, data: { status: 'occupied', currentTenantId: tenant.id } })` (or `'reserved'` if `startDate > today`). |
| **2. Is occupancy created?** | **YES** | `server/src/services/provisional-rental-term.service.ts:283-292`<br>`tx.occupancy.create(...)` created with `status: isFuture ? 'RESERVED' : 'ACTIVE'`. |
| **3. Does public room selection hide occupied rooms?** | **NO (Critical Gap)** | `server/src/services/tenant-registration.service.ts:1042-1045`<br>`prisma.room.findMany({ where: { dormitoryId, deletedAt: null } })` fetches **all** rooms without filtering `status === 'vacant'`.<br>`TenantRegisterView.tsx:1010-1014` renders every room in the `<select>` dropdown, showing `มีผู้เช่าอยู่` or `รอผูก LINE`. |
| **4. Does unbound LINE tenant incorrectly appear as available?** | **PARTIAL GAP** | In `getPublicRooms`, `isVacant` is `false` for unbound rooms. However, because `getPublicRooms` returns all rooms, an unbound room still appears in the public select options as `ห้อง 102 - รอผูก LINE (ยืนยันสิทธิ์)`. A public stranger can select this room and attempt to submit an application. |

---

### F. Daily Rental Audit

| Question | Answer | Source Evidence |
|---|---|---|
| **1. Daily Rental uses `DailyStay`, NOT `Contract`?** | **DIVIDED IMPLEMENTATION** | - In `QuickAddTenantModal.tsx:609` & `daily-stay.service.ts:620`: Uses `DailyStay` and `DailyStayInvoice`. **NO Contract created.** ✅<br>- In `TenantDailyRequestModal.tsx:118` & `daily-stay.routes.ts`: Uses `DailyStay`. **NO Contract created.** ✅<br>- In `TenantRegisterView.tsx:739-779`: Selecting "รายวัน" routes through `submitTenantRegistrationRequest` (`tenantRegistrationRequest`), and owner approval creates a full `Contract`! ❌ |
| **2. ID Card optional?** | **YES** | In `QuickAddTenantModal.tsx:605-622` and `daily-stay.routes.ts:338`, ID card upload is optional (`upload.single('idCardImage')`). |
| **3. No long-term contract signature?** | **YES in DailyStay, NO in Wizard** | In `DailyStay`, no contract signature is required. In `TenantRegisterView.tsx`, Step 6 canvas signature is mandatory even for daily rentals. |
| **4. Check-in signature only?** | **YES in DailyStay subsystem** | `daily-stay.service.ts` supports check-in/check-out workflow with daily invoice settlement. |

---

## 3. Domain Gap Table

| Area | Current Implementation | Expected Domain Rule | Gap Description |
|---|---|---|---|
| **A. Agreement Model** | Quick Add creates `ProvisionalRentalTerm`. | Quick Add creates an active rental agreement / contract. | Quick Add does not create a record in `contracts`. Downstream contract-specific queries and signature attachments do not find it unless converted or handled. |
| **B. Claim Signature Binding** | `completeTenantClaim` looks up `tx.contract` to attach signature. | Claim binds signature to the tenant's active rental agreement. | Because Quick Add tenant has a `ProvisionalRentalTerm`, no `Contract` row exists. The signature is stored in storage but not attached to any agreement, and no contract is converted. |
| **C. Public Registration Signing** | Tenant signs at initial submission (Step 6). Owner later approves with possible modifications. | Tenant submits application $\rightarrow$ Owner reviews/edits $\rightarrow$ Owner approves $\rightarrow$ **Tenant reviews final terms and signs** $\rightarrow$ Activated. | Current flow has signature timing reversed: applicant signs unapproved/proposed terms. If owner modifies rent/deposit, the tenant never reviews or signs the modified contract. |
| **D. Tenant Canonical Status** | Successful registration displays "ลงทะเบียนและยืนยันสิทธิ์สำเร็จ!" | Canonical active status must be `ใช้งานได้แล้ว`. | Missing `ใช้งานได้แล้ว` canonical status badge in UI. |
| **E. Room Availability** | `getPublicRooms` returns all rooms in dormitory; occupied & claimable rooms appear in public dropdown. | Only available/vacant rooms should be open for public self-registration. Unbound rooms belong to existing tenants and should not be open to public application. | Public self-registration dropdown exposes occupied and claimable rooms to general applicants. |
| **F. Daily Rental in Wizard** | Selecting "รายวัน" in `TenantRegisterView.tsx` creates `tenantRegistrationRequest` which generates a `Contract` upon approval. | Daily Rental uses `DailyStay` and `DailyStayInvoice`, **never** `Contract`. | `TenantRegisterView.tsx` creates a long-term `Contract` for daily stays instead of delegating to `DailyStay`. |

---

## 4. Risk Level Classification

| Area | Risk Level | Rationale |
|---|---|---|
| **A. Agreement Model (Provisional vs Contract)** | **HIGH** | If an owner-created tenant needs a downloadable PDF contract or contract-based integration, none exists until `ProvisionalRentalTerm` is either converted or unified. |
| **B. Claim Signature Attachment** | **MEDIUM** | Signatures uploaded during claim are stored safely in storage, but the foreign key to `contracts.tenantSignature` is unpopulated for Quick Add tenants. |
| **C. Inverted Signature Timing in Public Registration** | **CRITICAL (Legal / Business)** | Having a tenant pre-sign before owner review means an owner can alter rent/deposit and create an active contract with a signature that agreed to different financial terms. |
| **D. Missing `ใช้งานได้แล้ว` Status** | **LOW** | Cosmetic UI badge alignment. |
| **E. Public Room Dropdown Leaking Occupied Rooms** | **HIGH** | Public applicants can see and attempt to register for occupied rooms or rooms belonging to unlinked tenants. |
| **F. Daily Stay Generating Contract in Wizard** | **HIGH** | Distorts daily billing reports, creates unwanted long-term contract records, and confuses tax/receipt generation for daily stays. |

---

## 5. Recommended Next Implementation Order

Upon Product Owner confirmation, the following execution order is recommended:

### Step 4.1: Separate Public Vacant Rooms vs Unbound Claimable Rooms (Area E)
1. In `server/src/services/tenant-registration.service.ts` (`getPublicRooms`):
   - Filter `isVacant = (r.status === 'vacant')`.
   - Provide distinct endpoints or explicit query parameters: `GET /public-rooms?mode=vacant_only` for general applicants, vs `GET /public-rooms?mode=claimable_only` for LINE OA / Claim flows.
2. In `TenantRegisterView.tsx`:
   - If user arrives via Claim entry / QR code: show only the assigned room or claimable rooms.
   - If user arrives via Public registration: show **only** vacant rooms.

### Step 4.2: Correct Public Registration Signature Timing (Area C)
1. **At initial public submission**: Applicant submits application with proposed rent/deposit and personal details **without** signing a contract. (Status: `pending_owner_approval` / `รออนุมัติคำขอผู้เช่า`).
2. **At owner review**: Owner reviews, adjusts rent/deposit/terms, and clicks `อนุมัติข้อเสนอ` (Approved Offer). Status moves to `awaiting_tenant_signature` (`กรุณาตรวจสอบและยืนยัน`).
3. **Tenant final review & signature**: Tenant receives notification / opens link, reviews the owner's final approved terms, and draws signature.
4. **Activation**: Upon tenant signature, status transitions to `active` / `ใช้งานได้แล้ว`, creating `Contract` and `Occupancy`.

### Step 4.3: Unify Quick Add Agreement & Claim Signature Attachment (Areas A & B)
1. When Quick Add creates a `ProvisionalRentalTerm`:
   - When the tenant verifies and claims via `completeTenantClaim`, convert the `ProvisionalRentalTerm` to an active `Contract` (updating `provisionalRentalTerm.convertedContractId = contract.id`, `provisionalRentalTerm.status = 'CONVERTED'`).
   - Attach the tenant's signature to `contract.tenantSignature`.
2. Existing bills linked to `provisionalRentalTermId` remain valid and can also reference `contractId`.

### Step 4.4: Isolate Daily Stay in Wizard (Area F)
1. If applicant chooses "รายวัน" in `TenantRegisterView.tsx`:
   - Divert to the minimal Daily Stay path (`TenantDailyRequestModal` or streamlined Daily Stay flow: dates, check-in/out, rate, guest info, no emergency contacts, no pet/vehicle, no long-term contract).
   - Post to `/api/v1/daily-stays/request` to create `DailyStay`.
   - On owner approval, use `dailyStayService.approveDailyStay` (generates `DailyStayInvoice`, **never** `Contract`).

### Step 4.5: Complete Canonical Status Mapping (Area D)
1. Add `ใช้งานได้แล้ว` status badge across tenant portal and post-registration screens.
2. Verify all 5 tenant-side and 3 owner-side statuses match canonical labels across all pages.

---

> **Status**: Audit completed. Awaiting Product Owner confirmation before proceeding with implementation.
