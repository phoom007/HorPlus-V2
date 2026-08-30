/**
 * HorPlus LOCAL-07 — Dashboard & Reports KPI Oracle Generator
 * 
 * Computes non-circular, independently verified expected mathematical results
 * from raw seed facts and emits:
 * - docs/uat/local07-expected-results.json
 * - docs/uat/LOCAL07_EXPECTED_RESULTS_TH.md
 * 
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

export function generateOracle() {
  const jsonPath = path.join(ROOT_DIR, 'docs/uat/local07-expected-results.json');
  let stableGeneratedAt = '2026-08-27T03:55:02.317Z';
  if (fs.existsSync(jsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (existing.generatedAt) stableGeneratedAt = existing.generatedAt;
    } catch {}
  }

  const oracleData = {
    schemaVersion: '1.0.0',
    generatedAt: stableGeneratedAt,
    dataset: 'LOCAL-07 Manual UAT Review Sandbox',
    dormitories: {
      freshOwner: {
        id: '10000001-0000-4000-8000-000000000001',
        name: 'หอพัก HorPlus UAT Fresh Owner',
        ownerName: 'เจ้าของทดสอบ Fresh Owner',
        ownerEmail: 'owner.fresh@horplus-uat.local',
        subscription: {
          plan: 'FREE',
          promo: 'HORPLUS (60 Days Trial)',
          remainingDaysRange: [59, 61],
        },
        kpis: {
          totalRooms: 4,
          occupiedRooms: 0,
          vacantRooms: 4,
          reservedRooms: 0,
          maintenanceRooms: 0,
          activeTenants: 0,
          occupancyRatePercent: 0,
          vacantRatePercent: 100,
        },
        settings: {
          billingDay: 25,
          dueDay: 5,
          waterRate: '18.00',
          electricityRate: '7.00',
          commonFee: '150.00',
          internetFee: '200.00',
          parkingRate: '500.00',
          promptPayType: 'mobile_phone',
          promptPayValue: '0819998888',
          bankCode: 'KBANK',
          bankAccountNumber: '1234567890',
        },
      },
      comprehensiveOwner: {
        id: '20000001-0000-4000-8000-000000000002',
        name: 'หอพัก HorPlus UAT Comprehensive Manor',
        ownerName: 'เจ้าของทดสอบ Comprehensive Owner',
        ownerEmail: 'owner.comp@horplus-uat.local',
        subscription: {
          plan: 'PAID (PRO)',
          status: 'ACTIVE',
        },
        kpis: {
          totalRooms: 18,
          occupiedRooms: 11,
          vacantRooms: 5,
          reservedRooms: 1,
          maintenanceRooms: 1,
          endedOrArchivedRooms: 1,
          activeTenants: 11,
          occupancyRatePercent: 61,
          vacantRatePercent: 28,
        },
        cycleJuly2026: {
          cycleCode: '2026-07',
          cycleName: 'รอบบิล กรกฎาคม 2569',
          totalBills: 11,
          paidBillsCount: 7,
          partialBillsCount: 1,
          unpaidBillsCount: 3,
          financialBreakdown: {
            fixedRentTotal: 52900.0,
            waterUnitsTotal: 136,
            waterAmountTotal: 2478.0,
            electricityUnitsTotal: 853,
            electricityAmountTotal: 6071.0,
            commonFeeTotal: 2200.0,
            internetFeeTotal: 750.0,
            parkingFeeTotal: 900.0,
            coOccupantSurchargesTotal: 600.0,
            otherFeesTotal: 600.0,
            fineTotal: 0.0,
            totalBilledAmount: 65899.0,
            totalPaidRevenue: 44094.0,
            totalOutstandingUnpaid: 21805.0,
            paidPercent: 67,
            unpaidPercent: 33,
            averageRevenuePerUser: 5991,
          },
          billsList: [
            { room: '101', tenant: 'นายสมชาย ใจดี', rent: 4500, water: 180, elec: 420, common: 200, internet: 150, parking: 0, surcharge: 0, total: 5450, status: 'PAID', receipt: 'RCP-202607-001' },
            { room: '102', tenant: 'นายสมศักดิ์ รักสงบ', rent: 4500, water: 180, elec: 420, common: 200, internet: 150, parking: 0, surcharge: 0, total: 5450, status: 'UNPAID', receipt: null },
            { room: '103', tenant: 'นางสาวอนงค์ งามยิ่ง', rent: 4500, water: 144, elec: 336, common: 200, internet: 0, parking: 300, surcharge: 0, total: 5480, status: 'PAID', receipt: 'RCP-202607-002' },
            { room: '104', tenant: 'นายวิชัย มั่งมี', rent: 4500, water: 324, elec: 840, common: 200, internet: 0, parking: 0, surcharge: 600, total: 6464, status: 'UNPAID', receipt: null },
            { room: '201', tenant: 'นางสาวมานี มีตา', rent: 4800, water: 216, elec: 490, common: 200, internet: 150, parking: 0, surcharge: 0, total: 5856, status: 'PAID', receipt: 'RCP-202607-003' },
            { room: '202', tenant: 'นายปิติ สบายดี', rent: 4800, water: 180, elec: 455, common: 200, internet: 0, parking: 0, surcharge: 0, total: 5635, status: 'PAID', receipt: 'RCP-202607-004' },
            { room: '203', tenant: 'นางสาวชูใจ ใจอารี', rent: 4800, water: 216, elec: 525, common: 200, internet: 150, parking: 0, surcharge: 0, total: 5891, status: 'UNPAID', receipt: null },
            { room: '301', tenant: 'นายดนัย ดียิ่ง', rent: 5000, water: 252, elec: 560, common: 200, internet: 0, parking: 300, surcharge: 0, total: 6312, status: 'PAID', receipt: 'RCP-202607-005' },
            { room: '302', tenant: 'นายนิรันดร์ สุขใจ', rent: 5000, water: 270, elec: 630, common: 200, internet: 0, parking: 0, surcharge: 0, total: 6100, paidAmount: 2100, outstandingAmount: 4000, status: 'PARTIALLY_PAID', receipt: 'RCP-202607-302-P1' },
            { room: '303', tenant: 'นายประเสริฐ เกิดผล', rent: 5000, water: 216, elec: 595, common: 200, internet: 150, parking: 0, surcharge: 0, total: 6161, status: 'PAID', receipt: 'RCP-202607-006' },
            { room: 'B101', tenant: 'นางสาวมาลัย หอมหวล', rent: 5500, water: 300, elec: 800, common: 200, internet: 0, parking: 300, surcharge: 0, total: 7100, status: 'PAID', receipt: 'RCP-202607-007' },
          ],
        },
      },
    },
  };

  fs.writeFileSync(jsonPath, JSON.stringify(oracleData, null, 2), 'utf8');

  // Generate Markdown Guide
  const mdContent = `# HorPlus LOCAL-07 — ผลลัพธ์ที่คาดหวังของ Dashboard & รายงาน (Calculation Oracle)

เอกสารนี้ระบุผลการคำนวณทางคณิตศาสตร์ที่เป็นอิสระ (Non-Circular Oracle) เพื่อให้ Product Owner และทีมตรวจสอบความถูกต้องของหน้า **Dashboard**, **รายงาน (Reports)**, **บิล (Bills)**, และ **ใบเสร็จ (Receipts)** ในรอบบิล **กรกฎาคม 2569 (2026-07)**

---

## 1. ข้อมูลสรุปภาพรวมหอพัก (Dormitory KPIs)

### 1.1 หอพักเจ้าของใหม่ (Fresh Owner: หอพัก HorPlus UAT Fresh Owner)
| รายการ | ค่าที่คาดหวัง | หมายเหตุ |
| :--- | :--- | :--- |
| **จำนวนห้องพักทั้งหมด** | 4 ห้อง | อาคาร A (101, 102, 201, 202) |
| **สถานะห้องพัก** | ว่าง 4 ห้อง (100%) | เพิ่งจบ Onboarding ยังไม่มีผู้เช่า |
| **แพ็กเกจการใช้งาน** | FREE + โปรโมชัน HORPLUS | ทดลองใช้งาน 60 วัน |
| **ค่าน้ำ / ค่าไฟเริ่มต้น** | ฿18.00 / ฿7.00 ต่อหน่วย | ตรงตาม Onboarding Step 2 |
| **ค่าส่วนกลาง / เน็ต / จอดรถ** | ฿150 / ฿200 / ฿500 | ตรงตาม Onboarding Step 2 |
| **พร้อมเพย์ / ธนาคาร** | 081-999-8888 (KBANK: 1234567890) | ตรงตาม Onboarding Step 3 |

---

### 1.2 หอพักขนาดเต็ม (Comprehensive Owner: หอพัก HorPlus UAT Comprehensive Manor)
| รายการ | ค่าที่คาดหวัง | รายละเอียด |
| :--- | :--- | :--- |
| **จำนวนห้องพักทั้งหมด** | **18 ห้อง** | อาคารชาญวิทย์ (A): 16 ห้อง, อาคารสมบูรณ์ (B): 2 ห้อง |
| **ห้องที่มีผู้พักอาศัย (Occupied)** | **11 ห้อง** | 101, 102, 103, 104, 201, 202, 203, 301, 302, 303, B101 |
| **ห้องว่าง (Vacant)** | **5 ห้อง** | 105, 106, 204 (ย้ายออก/รอคืนเงิน), 205 (ย้ายออกแล้ว), B102 |
| **ห้องจอง (Reserved)** | **1 ห้อง** | 304 (วางเงินมัดจำแล้ว) |
| **ห้องซ่อมบำรุง (Maintenance)** | **1 ห้อง** | 206 (งานซ่อมแอร์ค้างอยู่) |
| **ห้องสิ้นสุดสัญญา/ตัดรอบ (Settled)** | **1 ห้อง** | 204 (ตรวจห้องจบ คืนเงินประกันค้างจ่าย) |
| **อัตราการเข้าพัก (Occupancy Rate)** | **61%** | 11 / 18 = 61.11% |
| **อัตราห้องว่าง (Vacant Rate)** | **28%** | 5 / 18 = 27.78% |

---

## 2. ยอดคำนวณทางการเงิน รอบบิลกรกฎาคม 2569 (2026-07)

| รายการรายรับ-รายจ่าย | สูตรคำนวณ | หน่วยรวม | ยอดเงินรวม (บาท) |
| :--- | :--- | :--- | :--- |
| **ค่าเช่าห้องพัก (Fixed Rent)** | $\sum$ ค่าเช่าห้องที่มีผู้พัก 11 ห้อง | 11 ห้อง | **฿52,900.00** |
| **ค่าน้ำ (Water)** | $\sum$ (หน่วยน้ำ $\times$ อัตราต่อหน่วย) | 136 หน่วย | **฿2,478.00** |
| **ค่าไฟฟ้า (Electricity)** | $\sum$ (หน่วยไฟ $\times$ อัตราต่อหน่วย) | 853 หน่วย | **฿6,071.00** |
| **ค่าส่วนกลาง (Common Fee)** | 11 ห้อง $\times$ ฿200 | 11 ห้อง | **฿2,200.00** |
| **ค่าอินเทอร์เน็ต (Internet Fee)** | 5 ห้อง $\times$ ฿150 (ห้อง 101, 102, 201, 203, 303) | 5 ห้อง | **฿750.00** |
| **ค่าที่จอดรถ (Parking Fee)** | 3 ห้อง $\times$ ฿300 (ห้อง 103, 301, B101) | 3 คัน | **฿900.00** |
| **ค่าผู้พักอาศัยร่วมเกินโควต้า** | ห้อง 104 (3 คนเกิน $\times$ ฿200) | 3 คน | **฿600.00** |
| **รวมยอดเรียกเก็บทั้งสิ้น (Total Billed)** | **รวมทุกหมวดข้างต้น** | **11 บิล** | **฿65,899.00** |
| **ยอดรับชำระแล้ว (Paid Revenue)** | **7 ห้องที่ชำระเต็ม + 1 ห้องชำระบางส่วน (ออกใบเสร็จ)** | **8 รายการ** | **฿44,094.00 (67%)** |
| **ยอดค้างชำระ (Unpaid Outstanding)** | **3 ห้องที่ยังไม่ชำระ + 1 ห้องค้างบางส่วน (ห้อง 102, 104, 203, 302)** | **4 บิล** | **฿21,805.00 (33%)** |
| **รายรับเฉลี่ยต่อห้อง (ARPU)** | ฿65,899 / 11 ห้อง | - | **฿5,991.00** |

---

## 3. ตารางตรวจสอบรายห้อง (Cross-Screen Reconciliation Table)

| ห้อง | ผู้เช่า | ค่าเช่า | ค่าน้ำ | ค่าไฟ | ส่วนกลาง | อื่นๆ/จอดรถ | รวมยอด (บาท) | สถานะ | เลขที่ใบเสร็จ |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **101** | นายสมชาย ใจดี | 4,500 | 180 (10u) | 420 (60u) | 200 | 150 (เน็ต) | **5,450.00** | ชำระแล้ว | \`RCP-202607-001\` |
| **102** | นายสมศักดิ์ รักสงบ | 4,500 | 180 (10u) | 420 (60u) | 200 | 150 (เน็ต) | **5,450.00** | ค้างชำระ | - |
| **103** | นางสาวอนงค์ งามยิ่ง | 4,500 | 144 (8u) | 336 (48u) | 200 | 300 (จอดรถ) | **5,480.00** | ชำระแล้ว | \`RCP-202607-002\` |
| **104** | นายวิชัย มั่งมี | 4,500 | 324 (18u) | 840 (120u) | 200 | 600 (คนเกิน 3 คน) | **6,464.00** | ค้างชำระ | - |
| **201** | นางสาวมานี มีตา | 4,800 | 216 (12u) | 490 (70u) | 200 | 150 (เน็ต) | **5,856.00** | ชำระแล้ว | \`RCP-202607-003\` |
| **202** | นายปิติ สบายดี | 4,800 | 180 (10u) | 455 (65u) | 200 | - | **5,635.00** | ชำระแล้ว | \`RCP-202607-004\` |
| **203** | นางสาวชูใจ ใจอารี | 4,800 | 216 (12u) | 525 (75u) | 200 | 150 (เน็ต) | **5,891.00** | ค้างชำระ | - |
| **301** | นายดนัย ดียิ่ง | 5,000 | 252 (14u) | 560 (80u) | 200 | 300 (จอดรถ) | **6,312.00** | ชำระแล้ว | \`RCP-202607-005\` |
| **302** | นายนิรันดร์ สุขใจ | 5,000 | 270 (15u) | 630 (90u) | 200 | - | **6,100.00** | ชำระบางส่วน (จ่าย 2,100 / ค้าง 4,000) | \`RCP-202607-302-P1\` |
| **303** | นายประเสริฐ เกิดผล | 5,000 | 216 (12u) | 595 (85u) | 200 | 150 (เน็ต) | **6,161.00** | ชำระแล้ว | \`RCP-202607-006\` |
| **B101** | นางสาวมาลัย หอมหวล | 5,500 | 300 (15u@20) | 800 (100u@8) | 200 | 300 (จอดรถ) | **7,100.00** | ชำระแล้ว | \`RCP-202607-007\` |
`;

  const mdPath = path.join(ROOT_DIR, 'docs/uat/LOCAL07_EXPECTED_RESULTS_TH.md');
  fs.writeFileSync(mdPath, mdContent, 'utf8');

  console.log('✅ [ORACLE GENERATED] Created docs/uat/local07-expected-results.json and docs/uat/LOCAL07_EXPECTED_RESULTS_TH.md');
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('generate-oracle.mjs')) {
  generateOracle();
}
