# Specification: Owner UI/UX Refinements (Buddhist Year, Live Clock & LINE OA Setup)

This specification defines the requirements, acceptance criteria, and verification standards for three specific user experience refinements in the HorPlus-V2 Owner workspace:
1. **UX-01**: Buddhist Era (พ.ศ.) Year Uniformity in Reports (`src/pages/owner/reports.tsx`).
2. **UX-02**: Dynamic User Real-Time Clock in Announcements Mobile Simulation (`src/pages/owner/announcements.tsx`).
3. **UX-03**: Interactive LINE OA Setup State & Call-to-Action in Payments LINE Notification Modal (`src/components/LineNotificationModal.tsx`, `src/pages/owner/payments.tsx`, `src/pages/owner.tsx`).

---

## 1. Product Owner Authorities & Confirmed Decisions

Traced directly to PO Request and `/grill-me` alignment:
- **PO Input**:
  1. "เมนูรายงานสถิติ 'มูลค่าจัดเก็บรวมปี 2026' = ควรปรับเป็น 'มูลค่าจัดเก็บรวมปี 2569' ครับ เพราะปีจะเป็น พ.ศ. ให้ผู้ใช้ได้เห็น"
  2. "/owner/announcements เวลาใน preview mock '10.45' ควรแสดงเป็นเวลาจริงของผู้ใช้"
  3. "/owner/payments ปุ่ม 'แจ้งเตือนผ่าน LINE' ใน popup 'ไม่มีรายการบิลในหมวดหมู่นี้' ถ้ายังไม่เชื่อม LINE OA ควรขึ้น ICON แบบกดได้ เพื่อให้ไปตั้งค่าก่อน"
- **Confirmed Grill-Me Decisions**:
  - **Q1 = ข**: In the LINE notification popup (`/owner/payments`), when LINE OA is not connected / not ready (`!lineStatus?.isReady`), replace the center empty state with an explicit, prominent status card stating that LINE OA is not connected, with a large setup button to configure LINE OA.
  - **Q2 = ค**: In `/owner/announcements` smartphone simulation, display the user's real local time in Thai format with "น." (e.g. `21:54 น.`), dynamically updated every 10 seconds.
  - **Q3 = ก**: In `/owner/reports`, convert all overview labels and chart titles showing Christian era years (e.g. `2026`) to Buddhist Era (พ.ศ. `2569`) uniformly, including "มูลค่าจัดเก็บรวมปี 2569", "ค่าใช้จ่ายแจ้งซ่อมรวมปี 2569", and the annual revenue breakdown chart title.

---

## 2. Acceptance Criteria & Criterion IDs

| Criterion ID | PO Source | Acceptance Requirement | Planned Verification |
| :--- | :--- | :--- | :--- |
| **UX-01** | PO Req 1, Q3 = ก | In `src/pages/owner/reports.tsx`, the summary statistics cards and charts must display the Buddhist Era year (`displayYearTh`, e.g. `2569`) instead of Christian era (`selectedYear`, e.g. `2026`):<br>1. Card label: `มูลค่าจัดเก็บรวมปี ${displayYearTh}` and badge `ประจำปี ${displayYearTh}`.<br>2. Card label: `ค่าใช้จ่ายแจ้งซ่อมรวมปี ${displayYearTh}` and subtext `สรุปงานซ่อมสะสมปี ${displayYearTh}`.<br>3. Chart title: `สถิติมูลค่ารายรับรอบปี ${displayYearTh} แยกตามรายเดือน` and description `(อ้างอิงปี ${displayYearTh})`. | Component render inspection and automated tests verifying that `2569` is rendered and `2026` does not appear in these header/card labels. |
| **UX-02** | PO Req 2, Q2 = ค | In `src/pages/owner/announcements.tsx`, the mobile phone preview header must replace the static mock `10:45 AM` with a dynamic clock reflecting the user's actual local time in Thai format with `น.` (e.g., `21:54 น.`). The clock must update periodically via a 10-second interval with proper cleanup on unmount. | Component test verifying dynamic time rendering with `น.` suffix and timer lifecycle cleanup. |
| **UX-03** | PO Req 3, Q1 = ข | In `src/components/LineNotificationModal.tsx`, when `!lineStatus?.isReady` and there are no bills ready to send:<br>1. Replace the generic "ไม่มีรายการบิลในหมวดหมู่นี้" empty state with a dedicated status box: "ยังไม่ได้เชื่อมต่อ LINE Official Account", explaining that LINE OA must be configured to send notifications to tenants.<br>2. Provide a prominent button "ไปตั้งค่า LINE OA" with a Settings/Link icon that triggers `onNavigateToLineConfig()`.<br>3. Pass `onNavigateToLineConfig` from `src/pages/owner.tsx` through `src/pages/owner/payments.tsx` into `LineNotificationModal`. | Component and integration tests verifying that when `lineStatus.isReady === false`, the setup card and button appear, and clicking triggers navigation to LINE OA settings. |

---

## 3. Scope of Changes

- `src/pages/owner/reports.tsx`:
  - Replace `selectedYear` with `displayYearTh` in lines 2294, 2301, 2509, 2512.
- `src/pages/owner/announcements.tsx`:
  - Introduce `currentTimeStr` state initialized with user's local time (`HH:mm น.`).
  - Set 10-second interval to keep time live.
  - Render `currentTimeStr` in the smartphone status header instead of `10:45 AM`.
- `src/components/LineNotificationModal.tsx`:
  - Add `onNavigateToLineConfig?: () => void;` to `LineNotificationModalProps`.
  - In empty state render: check `!lineStatus?.isReady`. If true, render the unconfigured LINE OA status card with the large "ไปตั้งค่า LINE OA" action button.
- `src/pages/owner/payments.tsx`:
  - Add `onNavigateToLineConfig?: () => void;` to `PaymentsOwnerViewProps`.
  - Pass `onNavigateToLineConfig` to `<LineNotificationModal />`.
- `src/pages/owner.tsx`:
  - Pass `onNavigateToLineConfig={() => setShowDirectLineOaModal(true)}` to `<PaymentsOwnerView />`.
- Automated tests:
  - `src/tests/owner-ui-ux-refinements.test.tsx` covering UX-01, UX-02, and UX-03.
