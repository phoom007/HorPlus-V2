/**
 * HorPlus LOCAL-07 — Idempotent Golden Billing Timeline Augmentation
 * 
 * Augments the Persistent Golden Dormitory with a 4-cycle billing timeline:
 * - 2026-07: Historical billing cycle (preserved with all 16 bills, payments, receipts, meters)
 * - 2026-08: Current Operational UAT cycle (with rate snapshot and meter activity; bills unissued)
 * - 2026-09: Future draft cycle (with rate snapshot; no meter activity, no bills)
 * - 2026-10: Future draft cycle (with rate snapshot; no meter activity, no bills)
 * 
 * Non-destructive & Idempotent: Never deletes existing bills or user mutations.
 * 
 * @license Apache-2.0
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { GOLDEN_DORM } from './constants.mjs';
import { CurrentCycleResolverService } from '../../server/src/services/current-cycle-resolver.ts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'docs/uat/local07-golden-menu-manifest.json');

const targetInfo = assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

export async function ensureGoldenBillingTimeline() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — GOLDEN BILLING TIMELINE AUGMENTATION');
  console.log('================================================================================');
  console.log(`Target: ${targetInfo.host}:${targetInfo.port}/${targetInfo.database}\n`);

  // 1. Verify Golden Dormitory exists (fail closed if missing)
  const dorm = await prisma.dormitory.findUnique({
    where: { id: GOLDEN_DORM.id },
    include: {
      rooms: true,
      billingSettings: true,
    },
  });

  if (!dorm) {
    throw new Error('CRITICAL ERROR: Golden Dormitory does not exist! Please run npm run uat:golden:ensure first.');
  }

  const bSettings = dorm.billingSettings;
  const defaultRates = {
    waterBillingType: bSettings?.waterBillingType || 'per_unit',
    waterRate: bSettings?.waterRate || '18.00',
    electricityBillingType: bSettings?.electricityBillingType || 'per_unit',
    electricityRate: bSettings?.electricityRate || '7.00',
    commonFee: bSettings?.commonFee || '200.00',
    commonFeeMode: bSettings?.commonFeeMode || 'fixed',
    internetFee: bSettings?.internetFee || '150.00',
    internetFeeMode: bSettings?.internetFeeMode || 'fixed',
    parkingFee: bSettings?.parkingRate || '300.00',
    parkingFeeMode: bSettings?.parkingFeeMode || 'fixed',
    lateFeeType: bSettings?.lateFeeType || 'fixed',
    lateFeeValue: bSettings?.lateFeeValue || '100.00',
    currency: 'THB',
  };

  // 2. Cycle 2026-07: Historical
  console.log('--- 1. Ensuring Cycle 2026-07 (Historical) & Rate Snapshot ---');
  const julyCycle = await prisma.billingCycle.upsert({
    where: {
      dormitory_cycle_code_unique: {
        dormitoryId: dorm.id,
        cycleCode: '2026-07',
      },
    },
    update: {},
    create: {
      dormitoryId: dorm.id,
      cycleCode: '2026-07',
      name: 'รอบบิล กรกฎาคม 2569',
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-31'),
      billingDate: new Date('2026-07-25'),
      dueDate: new Date('2026-08-05'),
      status: 'open',
    },
  });

  await prisma.billingRateSnapshot.upsert({
    where: { billingCycleId: julyCycle.id },
    update: {},
    create: {
      dormitoryId: dorm.id,
      billingCycleId: julyCycle.id,
      ...defaultRates,
      source: 'TEMPLATE_DEFAULT',
      inheritedFromBillingCycleId: null,
    },
  });

  // 3. Cycle 2026-08: Current Operational UAT
  console.log('--- 2. Ensuring Cycle 2026-08 (Operational) & Meter Activity ---');
  const augustCycle = await prisma.billingCycle.upsert({
    where: {
      dormitory_cycle_code_unique: {
        dormitoryId: dorm.id,
        cycleCode: '2026-08',
      },
    },
    update: {},
    create: {
      dormitoryId: dorm.id,
      cycleCode: '2026-08',
      name: 'รอบบิล สิงหาคม 2569',
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-31'),
      billingDate: new Date('2026-08-25'),
      dueDate: new Date('2026-09-05'),
      status: 'open',
    },
  });

  await prisma.billingRateSnapshot.upsert({
    where: { billingCycleId: augustCycle.id },
    update: {},
    create: {
      dormitoryId: dorm.id,
      billingCycleId: augustCycle.id,
      ...defaultRates,
      source: 'INHERITED',
      inheritedFromBillingCycleId: julyCycle.id,
    },
  });

  // Seed deterministic August meter readings for all occupied rooms
  const occupiedRooms = dorm.rooms.filter((r) => r.status === 'occupied');
  let augustMetersCreated = 0;

  for (const r of occupiedRooms) {
    // Water Meter Device & Reading
    let wDev = await prisma.meterDevice.findFirst({
      where: { dormitoryId: dorm.id, roomId: r.id, type: 'water' },
    });
    if (!wDev) {
      wDev = await prisma.meterDevice.create({
        data: {
          dormitoryId: dorm.id,
          roomId: r.id,
          type: 'water',
          meterNumber: `WM-${r.roomNumber}`,
          initialReading: 100,
        },
      });
    }

    const existingWReading = await prisma.meterReading.findUnique({
      where: {
        billing_cycle_room_meter_type_unique: {
          billingCycleId: augustCycle.id,
          roomId: r.id,
          meterType: 'water',
        },
      },
    });

    if (!existingWReading) {
      await prisma.meterReading.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: augustCycle.id,
          roomId: r.id,
          meterDeviceId: wDev.id,
          meterType: 'water',
          previousReading: 112,
          currentReading: 125,
          usageUnits: 13,
          readAt: new Date('2026-08-25'),
          status: 'confirmed',
        },
      });
      augustMetersCreated++;
    }

    // Electricity Meter Device & Reading
    let eDev = await prisma.meterDevice.findFirst({
      where: { dormitoryId: dorm.id, roomId: r.id, type: 'electricity' },
    });
    if (!eDev) {
      eDev = await prisma.meterDevice.create({
        data: {
          dormitoryId: dorm.id,
          roomId: r.id,
          type: 'electricity',
          meterNumber: `EM-${r.roomNumber}`,
          initialReading: 500,
        },
      });
    }

    const existingEReading = await prisma.meterReading.findUnique({
      where: {
        billing_cycle_room_meter_type_unique: {
          billingCycleId: augustCycle.id,
          roomId: r.id,
          meterType: 'electricity',
        },
      },
    });

    if (!existingEReading) {
      await prisma.meterReading.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: augustCycle.id,
          roomId: r.id,
          meterDeviceId: eDev.id,
          meterType: 'electricity',
          previousReading: 580,
          currentReading: 670,
          usageUnits: 90,
          readAt: new Date('2026-08-25'),
          status: 'confirmed',
        },
      });
      augustMetersCreated++;
    }
  }
  console.log(`   August Meter Readings: ${augustMetersCreated} new readings created across ${occupiedRooms.length} occupied rooms (bills left unissued for PO menu test).`);

  // 4. Cycle 2026-09: Future Draft
  console.log('--- 3. Ensuring Cycle 2026-09 (Future Draft) ---');
  const septCycle = await prisma.billingCycle.upsert({
    where: {
      dormitory_cycle_code_unique: {
        dormitoryId: dorm.id,
        cycleCode: '2026-09',
      },
    },
    update: {},
    create: {
      dormitoryId: dorm.id,
      cycleCode: '2026-09',
      name: 'รอบบิล กันยายน 2569',
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-09-30'),
      billingDate: new Date('2026-09-25'),
      dueDate: new Date('2026-10-05'),
      status: 'draft',
    },
  });

  await prisma.billingRateSnapshot.upsert({
    where: { billingCycleId: septCycle.id },
    update: {},
    create: {
      dormitoryId: dorm.id,
      billingCycleId: septCycle.id,
      ...defaultRates,
      source: 'INHERITED',
      inheritedFromBillingCycleId: augustCycle.id,
    },
  });

  // 5. Cycle 2026-10: Future Draft
  console.log('--- 4. Ensuring Cycle 2026-10 (Future Draft) ---');
  const octCycle = await prisma.billingCycle.upsert({
    where: {
      dormitory_cycle_code_unique: {
        dormitoryId: dorm.id,
        cycleCode: '2026-10',
      },
    },
    update: {},
    create: {
      dormitoryId: dorm.id,
      cycleCode: '2026-10',
      name: 'รอบบิล ตุลาคม 2569',
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-10-31'),
      billingDate: new Date('2026-10-25'),
      dueDate: new Date('2026-11-05'),
      status: 'draft',
    },
  });

  await prisma.billingRateSnapshot.upsert({
    where: { billingCycleId: octCycle.id },
    update: {},
    create: {
      dormitoryId: dorm.id,
      billingCycleId: octCycle.id,
      ...defaultRates,
      source: 'INHERITED',
      inheritedFromBillingCycleId: septCycle.id,
    },
  });

  // 6. Verify Operational Cycle Resolver identifies August 2026
  console.log('--- 5. Verifying Operational Cycle Resolution ---');
  const resolver = new CurrentCycleResolverService(prisma);
  const resolved = await resolver.resolveOperationalBillingCycle(dorm.id);
  console.log(`   Authoritative Operational Cycle: ${resolved.cycleCode} (Reason: ${resolved.reason})`);

  if (resolved.cycleCode !== '2026-08') {
    throw new Error(`CRITICAL ERROR: Expected operational cycle 2026-08, but resolver returned: ${resolved.cycleCode}`);
  }

  // 7. Update Golden Scenario Manifest
  console.log('--- 6. Updating Golden Scenario Manifest ---');
  await updateManifestWithBillingTimeline();

  console.log('\n================================================================================');
  console.log('  ✅ GOLDEN BILLING TIMELINE COMPLETED SUCCESSFULLY');
  console.log('  Timeline: 2026-07 (Historical) -> 2026-08 (Operational) -> 2026-09 (Draft) -> 2026-10 (Draft)');
  console.log('================================================================================\n');

  await prisma.$disconnect();
}

async function updateManifestWithBillingTimeline() {
  if (!fs.existsSync(MANIFEST_PATH)) return;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  manifest.billingTimeline = {
    canonicalCycles: [
      {
        cycleCode: '2026-07',
        name: 'รอบบิล กรกฎาคม 2569',
        type: 'historical',
        status: 'open',
        rateSnapshotSource: 'TEMPLATE_DEFAULT',
        billsCount: 16,
        paidBills: 12,
        unpaidBills: 3,
        overdueBills: 1,
        meterReadingsCount: 32,
      },
      {
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        type: 'operational',
        status: 'open',
        rateSnapshotSource: 'INHERITED',
        inheritedFrom: '2026-07',
        billsCount: 0,
        meterReadingsCount: 32,
        notes: 'Operational cycle with confirmed meter readings; bills ready for PO issuance testing',
      },
      {
        cycleCode: '2026-09',
        name: 'รอบบิล กันยายน 2569',
        type: 'future_draft',
        status: 'draft',
        rateSnapshotSource: 'INHERITED',
        inheritedFrom: '2026-08',
        billsCount: 0,
        meterReadingsCount: 0,
      },
      {
        cycleCode: '2026-10',
        name: 'รอบบิล ตุลาคม 2569',
        type: 'future_draft',
        status: 'draft',
        rateSnapshotSource: 'INHERITED',
        inheritedFrom: '2026-09',
        billsCount: 0,
        meterReadingsCount: 0,
      },
    ],
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('golden-billing-ensure.mjs')) {
  ensureGoldenBillingTimeline().catch((err) => {
    console.error(`❌ [GOLDEN BILLING ENSURE FAILED] ${err.message}`);
    process.exit(1);
  });
}
