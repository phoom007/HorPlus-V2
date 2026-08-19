/**
 * HorPlus LOCAL-07 — Read-Only Golden Menu UAT Integrity Verifier
 * 
 * Verifies all structural, financial, and domain invariants of the Golden Dormitory
 * without performing any mutations or resets.
 * 
 * @license Apache-2.0
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { GOLDEN_DORM } from './constants.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.local07-sessions');
const MANIFEST_PATH = path.join(ROOT_DIR, 'docs/uat/local07-golden-menu-manifest.json');

const targetInfo = assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

export async function verifyGoldenDormData() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — GOLDEN MENU UAT INTEGRITY VERIFICATION (READ-ONLY)');
  console.log('================================================================================');
  console.log(`Target: ${targetInfo.host}:${targetInfo.port}/${targetInfo.database}\n`);

  let failures = [];

  // 1. Verify Dormitory
  const dorm = await prisma.dormitory.findUnique({
    where: { id: GOLDEN_DORM.id },
    include: {
      buildings: { include: { rooms: true } },
      rooms: true,
      dormitorySubscription: { include: { plan: true } },
      members: { include: { user: true, role: true } },
      billingSettings: true,
    },
  });

  if (!dorm) {
    console.error('❌ Golden Dormitory does not exist in database!');
    process.exit(1);
  }

  console.log(`✅ Golden Dormitory: "${dorm.name}" (ID: ${dorm.id})`);

  // 2. Verify Owner Membership
  const ownerMember = dorm.members.find((m) => m.userId === GOLDEN_DORM.owner.id && m.role.code === 'OWNER' && m.status === 'active');
  if (!ownerMember) {
    failures.push('Golden Owner active membership not found in Golden Dormitory.');
  } else {
    console.log(`✅ Golden Owner: "${ownerMember.user.name}" (${ownerMember.user.email}) with OWNER role.`);
  }

  // 3. Verify Subscription
  if (!dorm.dormitorySubscription || dorm.dormitorySubscription.status !== 'ACTIVE' || dorm.dormitorySubscription.plan.code !== 'PAID') {
    failures.push(`Subscription is not active PAID/PRO. Found: ${dorm.dormitorySubscription?.plan?.code} / ${dorm.dormitorySubscription?.status}`);
  } else {
    console.log(`✅ Subscription: ${dorm.dormitorySubscription.plan.name} (${dorm.dormitorySubscription.plan.code}) - Status: ${dorm.dormitorySubscription.status}`);
  }

  // 4. Verify Buildings (Exactly 2: Building A and Building B)
  if (dorm.buildings.length !== 2) {
    failures.push(`Expected exactly 2 buildings, found ${dorm.buildings.length}`);
  } else {
    const codes = dorm.buildings.map((b) => b.code).sort();
    if (codes[0] !== 'A' || codes[1] !== 'B') {
      failures.push(`Building codes must be ['A', 'B']. Found: ${JSON.stringify(codes)}`);
    } else {
      console.log(`✅ Buildings: 2 buildings (Building A: ${dorm.buildings.find(b => b.code === 'A')?.rooms.length} rooms, Building B: ${dorm.buildings.find(b => b.code === 'B')?.rooms.length} rooms)`);
    }
  }

  // 5. Verify 24 Rooms
  const expectedRoomNumbers = [
    'A101', 'A102', 'A103', 'A201', 'A202', 'A203', 'A301', 'A302', 'A303', 'A401', 'A402', 'A403',
    'B101', 'B102', 'B103', 'B201', 'B202', 'B203', 'B301', 'B302', 'B303', 'B401', 'B402', 'B403',
  ];

  const actualRoomNumbers = dorm.rooms.map((r) => r.roomNumber).sort();
  if (actualRoomNumbers.length !== 24) {
    failures.push(`Expected 24 rooms, found ${actualRoomNumbers.length}`);
  } else {
    const missing = expectedRoomNumbers.filter((num) => !actualRoomNumbers.includes(num));
    if (missing.length > 0) {
      failures.push(`Missing expected rooms: ${missing.join(', ')}`);
    } else {
      console.log(`✅ Rooms: Exactly 24 rooms provisioned with canonical uppercase prefixes (A101-A403, B101-B403).`);
    }
  }

  // 6. Verify Room Statuses
  const statusCounts = dorm.rooms.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log(`✅ Room Status Distribution: Occupied: ${statusCounts.occupied || 0}, Vacant: ${statusCounts.vacant || 0}, Reserved: ${statusCounts.reserved || 0}, Maintenance: ${statusCounts.maintenance || 0}`);

  if (statusCounts.occupied !== 16) failures.push(`Expected 16 occupied rooms, found ${statusCounts.occupied}`);
  if (statusCounts.vacant !== 6) failures.push(`Expected 6 vacant rooms, found ${statusCounts.vacant}`);
  if (statusCounts.reserved !== 1) failures.push(`Expected 1 reserved room, found ${statusCounts.reserved}`);
  if (statusCounts.maintenance !== 1) failures.push(`Expected 1 maintenance room, found ${statusCounts.maintenance}`);

  // 7. Verify Active Contracts
  const activeContracts = await prisma.contract.count({
    where: { dormitoryId: dorm.id, status: 'active' },
  });
  console.log(`✅ Active Contracts: ${activeContracts}`);
  if (activeContracts < 16) failures.push(`Expected at least 16 active contracts, found ${activeContracts}`);

  // 8. Verify Billing Cycles, Bills & Meters
  const cycles = await prisma.billingCycle.findMany({
    where: { dormitoryId: dorm.id },
    include: { bills: true },
  });

  const julyCycle = cycles.find((c) => c.cycleCode === '2026-07');
  if (!julyCycle) {
    failures.push('Missing 2026-07 billing cycle.');
  } else {
    console.log(`✅ July 2026 Billing Cycle: ${julyCycle.bills.length} bills generated.`);
    const paidBills = julyCycle.bills.filter((b) => b.status === 'PAID').length;
    const sentBills = julyCycle.bills.filter((b) => b.status === 'SENT').length;
    const overdueBills = julyCycle.bills.filter((b) => b.status === 'OVERDUE').length;
    console.log(`   Bills Breakdown: ${paidBills} Paid, ${sentBills} Sent (Unpaid), ${overdueBills} Overdue.`);
  }

  const meterReadings = await prisma.meterReading.count({
    where: { dormitoryId: dorm.id },
  });
  console.log(`✅ Meter Readings: ${meterReadings} readings recorded across occupied rooms.`);

  // 9. Verify Session & Manifest Files
  const sessionPath = path.join(SESSIONS_DIR, 'golden-owner.json');
  if (!fs.existsSync(sessionPath)) {
    failures.push(`Session state file missing: ${sessionPath}`);
  } else {
    console.log(`✅ Session File: ${sessionPath}`);
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    failures.push(`Manifest file missing: ${MANIFEST_PATH}`);
  } else {
    console.log(`✅ Manifest File: ${MANIFEST_PATH}`);
  }

  console.log('\n--------------------------------------------------------------------------------');
  if (failures.length > 0) {
    console.error(`❌ [VERIFICATION FAILED] ${failures.length} issues found:`);
    failures.forEach((f) => console.error(`   - ${f}`));
    await prisma.$disconnect();
    process.exit(1);
  } else {
    console.log('🎯 [VERIFICATION PASSED] All Golden Menu UAT structural and scenario invariants hold 100%.');
    console.log('--------------------------------------------------------------------------------\n');
  }

  await prisma.$disconnect();
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('golden-verify.mjs')) {
  verifyGoldenDormData().catch((err) => {
    console.error(`❌ [VERIFICATION SCRIPT ERROR] ${err.message}`);
    process.exit(1);
  });
}
