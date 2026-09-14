# Technical Specification: Maintenance UI/UX Polish & Multi-Role UAT Readiness

## Document Metadata
- **Spec ID**: MAINTENANCE-UX-AND-MULTI-ROLE-UAT-SPEC
- **Module**: Maintenance Management (`/owner/maintenance`) & Multi-Role Access Verification
- **Status**: Draft (Gate A Review)
- **Author**: Antigravity Main Agent
- **Target Version**: HorPlus-V2

---

## 1. Background & PO Intent

During PO manual UAT of the Staff ("ช่าง / แม่บ้าน") persona:
1. **Font Inconsistency (Issue 1)**: In `owner/maintenance`, form labels, text, and inputs render with default system fonts (e.g. Segoe UI / Tahoma) instead of HorPlus's primary brand font family **Prompt** (`--font-sans`).
2. **Cost Input Sanitization (Issue 2)**: The "ค่าอะไหล่วัสดุรวม (บาท)" input allowed non-numeric characters (e.g. `E1` due to HTML5 number exponential notation) and permitted messy leading zeros (`0123`). Per PO decision (Q1=ข), the field must accept strictly numeric characters `0-9` with at most one decimal point and up to 2 decimal places, with leading zeros normalized (`0123` -> `123`, `0123.5` -> `123.5`, `0.5` -> `0.5`, single `0` remains `0`).
3. **Image Clear Button Stacking Leak (Issue 3)**: In the repair progress/detail view and create modal, the red "ล้างรูปภาพ" (clear image) button has `z-40`, whereas the fixed viewport bottom footer has `z-30`. When scrolling, the clear button bleeds through and floats right on top of the footer action buttons. Per PO decision (Q3=ก), the footer must be elevated to `z-50`, the clear button lowered to `z-10` within its local container, and content bottom padding ensured.
4. **Multi-Role UAT for Owner & Manager (Issue 4)**: Per PO decision (Q4=ก), the agent must verify that both **เจ้าของหอพัก** (Owner) and **ผู้จัดการ** (Manager) roles operate correctly, run automated regression tests, and provision fresh direct access links for each role on the Comprehensive Manor dormitory (18 rooms) so the PO can conduct manual UAT without manual credential/cookie configuration.

---

## 2. Acceptance Criteria (Observable Outcomes)

### MUX-01: Global Typography Alignment ("Prompt" Font Family)
- In `src/index.css`, enforce global typography inheritance:
  ```css
  html, body, #root, input, textarea, select, button {
    font-family: var(--font-sans);
  }
  ```
- In `src/pages/owner/maintenance.tsx`:
  - Explicitly declare `font-sans` on all root containers, modal wrappers, overview cards, form containers, labels, headers, and inputs.
  - Eliminate system font fallback leaks (Segoe UI / Tahoma) across all maintenance sub-views.

### MUX-02: Cost Input Sanitization & Leading Zero Normalization
- In `src/pages/owner/maintenance.tsx`:
  - The "ค่าอะไหล่วัสดุรวม (บาท)" input utilizes controlled sanitization:
    - Block exponential characters (`e`, `E`), plus/minus signs (`+`, `-`), and letters.
    - Permits strictly digits `0-9` and at most one decimal point `.`.
    - Restricts decimal precision to at most 2 decimal digits (`^\d*(\.\d{0,2})?$`).
    - Normalizes leading zeros on integer part: `0123` becomes `123`, `0123.50` becomes `123.50`, while preserving valid `0` and `0.xx` prefixes (e.g. `0.50`).
    - An empty field allows clearing to empty placeholder `"0.00"`.
  - State `cost` correctly stores the numeric value for backend persistence (or `0` when empty).

### MUX-03: Image Clear Button Stacking Context & Fixed Footer Z-Index Isolation
- In `src/pages/owner/maintenance.tsx`:
  - Bottom fixed action bars (`<footer>`) in both Create Repair Modal and Progress/Detail View are elevated to `z-50` (or `z-[60]`).
  - Red "ล้างรูปภาพ" button is scoped to `z-10` within its local `relative overflow-hidden` thumbnail container.
  - Scrolling the page past the viewport bottom cleanly hides the image preview and "ล้างรูปภาพ" button beneath the opaque fixed footer without visual punch-through or overlapping buttons.
  - Bottom padding (`pb-28` to `pb-36`) ensures all scrollable content is fully reachable above the fixed footer.

### MUX-04: Multi-Role UAT Readiness (Owner & Manager Direct Access)
- Extend `scripts/generate-direct-grant.mjs` to deterministically create active Direct Access Grants for:
  1. `OWNER` (เจ้าของหอพัก)
  2. `MANAGER` (ผู้จัดการ)
  3. `STAFF` (ช่าง / แม่บ้าน)
- Target dormitory: `COMP_DORM` (`20000001-0000-4000-8000-000000000002` — หอพัก HorPlus UAT Comprehensive Manor, 18 rooms).
- Verify role behavior:
  - `OWNER`: All 11 navigation tabs accessible, full read/write privileges on rooms, bills, payments, contracts, maintenance, reports, users, settings.
  - `MANAGER`: Operational tabs accessible (rooms, bills, payments, maintenance, announcements, reports); settings appropriately scoped.
  - `STAFF`: Strict RBAC maintained (meters & maintenance only).
- Run and pass automated unit and integration tests covering maintenance UI and role permissions before presenting UAT links.

---

## 3. Targeted Test Plan
1. **Frontend Unit Tests (`src/tests/maintenance-ux-and-multirole.test.tsx`)**:
   - Verify cost input sanitization with test cases: `'E1'`, `'0123'`, `'0123.45'`, `'0.75'`, `'-50'`, `'abc'`.
   - Verify footer z-index is `z-50` and clear image button is `z-10`.
   - Verify global font class presence on maintenance containers.
2. **Regression Tests**:
   - `npx vitest run src/tests/direct-access-grant-staff-workspace.test.tsx`
   - `npx vitest run src/tests/owner-ui-ux-refinements.test.tsx`
3. **Build Verifications**:
   - `npm run build` (Frontend)
   - `npm --prefix server run build` (Backend)
