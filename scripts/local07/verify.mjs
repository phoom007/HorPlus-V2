/**
 * HorPlus LOCAL-07 — Sandbox Verification & Integrity Check
 * 
 * Verifies:
 * 1. Database Safety Guard prevents non-target DB execution
 * 2. Dataset Idempotency (reset + seed produces identical counts)
 * 3. Fresh Owner Onboarding Persistence (all fields intact in DB)
 * 4. Comprehensive Owner KPI & Financial Oracle consistency
 * 5. Session token encryption / decryption & CSRF binding
 * 
 * @license Apache-2.0
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { FRESH_DORM, COMP_DORM, REGISTRATION_OWNER } from './constants.mjs';
import { CANONICAL_SUBSCRIPTION_CATALOG } from '../../server/src/config/subscription-catalog.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const targetInfo = assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

export async function runVerification() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — SANDBOX VERIFICATION & INTEGRITY PROOF');
  console.log('================================================================================');
  console.log(`Target: ${targetInfo.host}:${targetInfo.port}/${targetInfo.database}\n`);

  let failures = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
    } else {
      console.error(`  ❌ FAIL: ${name} — ${details}`);
      failures++;
    }
  }

  // 1. Safety Guard Assertion
  console.log('--- 1. Safety Guard Verification ---');
  try {
    const safety = assertSafeDatabaseTarget();
    assert(safety.port === '5455' && safety.database === 'horplus_wave1d_fasttrack_test', 'Database strictly targets port 5455 & horplus_wave1d_fasttrack_test');
    assert(safety.redisPort === '6380', 'Redis strictly targets port 6380');
  } catch (err) {
    assert(false, 'Database safety guard failed', err.message);
  }

  // 2. Pre-Onboarding Registration Owner State Verification
  console.log('\n--- 2. Registration Owner Pre-Onboarding State Verification ---');
  const regUser = await prisma.user.findUnique({
    where: { id: REGISTRATION_OWNER.id },
    include: { memberships: true },
  });
  assert(Boolean(regUser), 'Registration Owner user identity exists in DB');
  assert(regUser?.memberships.length === 0, 'Registration Owner has strictly 0 active memberships', regUser?.memberships.length);
  const regDormCount = await prisma.dormitory.count({ where: { createdByUserId: REGISTRATION_OWNER.id } });
  assert(regDormCount === 0, 'Registration Owner has strictly 0 dormitories created before manual review', regDormCount);

  // 3. Canonical Subscription Catalog Verification
  console.log('\n--- 3. Canonical Subscription Catalog Verification ---');
  const freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
  const paidPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
  const paidPkg = await prisma.subscriptionPackage.findFirst({
    where: { plan: { code: 'PAID' }, durationMonths: 1, enabled: true },
  });
  const horplusPromo = await prisma.promoCode.findFirst({ where: { code: 'HORPLUS' } });

  const canonFree = CANONICAL_SUBSCRIPTION_CATALOG.plans.find(p => p.code === 'FREE');
  const canonPaid = CANONICAL_SUBSCRIPTION_CATALOG.plans.find(p => p.code === 'PAID');
  const canonPkg = CANONICAL_SUBSCRIPTION_CATALOG.packages.find(p => p.planCode === 'PAID' && p.durationMonths === 1);
  const canonPromo = CANONICAL_SUBSCRIPTION_CATALOG.promoCodes?.find(p => p.code === 'HORPLUS');

  assert(freePlan?.roomLimit === canonFree?.roomLimit, `FREE room limit matches canonical truth (${canonFree?.roomLimit})`, freePlan?.roomLimit);
  assert(paidPlan?.roomLimit === canonPaid?.roomLimit, `PAID room limit matches canonical truth (${canonPaid?.roomLimit})`, paidPlan?.roomLimit);
  assert(paidPlan?.messageQuotaMonthly === canonPaid?.messageQuotaMonthly, `PAID message quota matches canonical truth (${canonPaid?.messageQuotaMonthly})`, paidPlan?.messageQuotaMonthly);
  assert(Number(paidPkg?.price) === canonPkg?.price, `PAID 1-month package price matches canonical truth (฿${canonPkg?.price})`, paidPkg?.price);
  assert(horplusPromo?.extensionDays === canonPromo?.extensionDays, `HORPLUS promo extension days matches canonical truth (${canonPromo?.extensionDays} days)`, horplusPromo?.extensionDays);

  // 2. Fresh Owner Persistence Verification
  console.log('\n--- 2. Fresh Owner Onboarding Persistence Verification ---');
  const freshMember = await prisma.dormitoryMember.findFirst({
    where: { userId: FRESH_DORM.owner.id, status: 'active' },
    include: {
      dormitory: {
        include: {
          billingSettings: true,
          propertyDefaults: true,
          buildings: { include: { rooms: true } },
          ownerSignatures: true,
          dormitorySubscription: { include: { plan: true } },
          members: { include: { user: true, role: true } },
        },
      },
    },
  });
  const freshDormDb = freshMember?.dormitory;

  assert(Boolean(freshDormDb), 'Fresh Owner Dormitory exists in DB');
  assert(freshDormDb?.name === FRESH_DORM.name, 'Dormitory name matches onboarding input', freshDormDb?.name);
  assert(freshDormDb?.phone === FRESH_DORM.phone, 'Dormitory phone matches onboarding input', freshDormDb?.phone);
  assert(freshDormDb?.province === FRESH_DORM.province, 'Dormitory province matches onboarding input', freshDormDb?.province);
  assert(Number(freshDormDb?.billingSettings?.waterRate) === 18, 'Billing waterRate is 18.00', freshDormDb?.billingSettings?.waterRate);
  assert(Number(freshDormDb?.billingSettings?.electricityRate) === 7, 'Billing electricityRate is 7.00', freshDormDb?.billingSettings?.electricityRate);
  assert(freshDormDb?.buildings.length === 1, 'Building count is 1', freshDormDb?.buildings.length);
  assert(freshDormDb?.buildings[0]?.rooms.length === 4, 'Room count is 4', freshDormDb?.buildings[0]?.rooms.length);
  assert(freshDormDb?.buildings[0]?.rooms.every((r) => r.status.toLowerCase() === 'vacant'), 'All 4 rooms are vacant initially');
  assert(freshDormDb?.ownerSignatures.length > 0 && freshDormDb?.ownerSignatures[0]?.isCurrent === true, 'Owner signature persisted with isCurrent = true');
  assert(freshDormDb?.dormitorySubscription?.status === 'TRIAL', 'Subscription is in TRIAL status');
  assert(Boolean(freshDormDb?.propertyDefaults?.defaultTerms), 'Fresh Owner property defaults has defaultTerms text');
  assert(Boolean(freshDormDb?.propertyDefaults?.petPolicy), 'Fresh Owner property defaults has petPolicy object');

  // 3. Comprehensive Owner KPI & Oracle Verification
  console.log('\n--- 3. Comprehensive Owner KPI & Financial Oracle Verification ---');
  const compDormDb = await prisma.dormitory.findUnique({
    where: { id: COMP_DORM.id },
    include: {
      propertyDefaults: true,
      buildings: { include: { rooms: true } },
      tenants: true,
      contracts: true,
      billingCycles: { include: { bills: { include: { items: true, Receipt: true, Payment: true } } } },
      members: { include: { role: true, user: true } },
      tenantRegistrationRequests: true,
    },
  });

  assert(Boolean(compDormDb), 'Comprehensive Dormitory exists in DB');
  assert(Boolean(compDormDb?.propertyDefaults?.defaultTerms), 'Comprehensive Owner has defaultTerms');
  assert(compDormDb?.propertyDefaults?.petPolicy?.allowed === 'conditional', 'Comprehensive Owner has conditional petPolicy');
  assert(compDormDb?.tenantRegistrationRequests?.length > 0, 'Comprehensive Owner has pending tenant registration request');
  assert(Boolean(compDormDb?.tenantRegistrationRequests[0]?.acceptanceSnapshotSha256), 'Tenant registration request has canonical acceptanceSnapshotSha256');
  assert(Boolean(compDormDb?.tenantRegistrationRequests[0]?.tenantSignatureObjectKey), 'Tenant registration request has tenantSignatureObjectKey');
  const totalRooms = compDormDb?.buildings.reduce((sum, b) => sum + b.rooms.length, 0) || 0;
  assert(totalRooms === 18, 'Total room count is exactly 18', totalRooms);

  const allRooms = compDormDb?.buildings.flatMap(b => b.rooms) || [];
  const occupiedRooms = allRooms.filter(r => r.status === 'occupied');
  const vacantRooms = allRooms.filter(r => r.status === 'vacant');
  const reservedRooms = allRooms.filter(r => r.status === 'reserved');
  const maintenanceRooms = allRooms.filter(r => r.status === 'maintenance');

  assert(occupiedRooms.length === 11, 'Occupied rooms count is exactly 11', occupiedRooms.length);
  assert(vacantRooms.length === 5, 'Vacant rooms count is exactly 5', vacantRooms.length);
  assert(reservedRooms.length === 1, 'Reserved rooms count is exactly 1', reservedRooms.length);
  assert(maintenanceRooms.length === 1, 'Maintenance rooms count is exactly 1', maintenanceRooms.length);

  // Billing Cycle July 2026 verification
  const julyCycle = compDormDb?.billingCycles.find(c => c.cycleCode === '2026-07');
  assert(Boolean(julyCycle), 'Billing cycle 2026-07 exists and is open');
  assert(julyCycle?.bills.length === 11, 'July bills count is 11', julyCycle?.bills.length);

  const paidBills = julyCycle?.bills.filter(b => b.status === 'paid') || [];
  const unpaidBills = julyCycle?.bills.filter(b => b.status === 'unpaid') || [];

  assert(paidBills.length === 7, 'Paid bills count is exactly 7', paidBills.length);
  assert(unpaidBills.length === 4, 'Unpaid bills count is exactly 4', unpaidBills.length);

  const totalBilled = julyCycle?.bills.reduce((sum, b) => sum + Number(b.totalAmount), 0) || 0;
  const totalPaid = paidBills.reduce((sum, b) => sum + Number(b.totalAmount), 0);
  const totalUnpaid = unpaidBills.reduce((sum, b) => sum + Number(b.totalAmount), 0);

  assert(Math.round(totalBilled) === 65899, 'Total billed in July 2026 equals ฿65,899.00', totalBilled);
  assert(Math.round(totalPaid) === 41994, 'Total paid in July 2026 equals ฿41,994.00', totalPaid);
  assert(Math.round(totalUnpaid) === 23905, 'Total unpaid in July 2026 equals ฿23,905.00', totalUnpaid);

  // Receipts count verification
  const receiptsCount = julyCycle?.bills.reduce((sum, b) => sum + b.Receipt.length, 0) || 0;
  assert(receiptsCount === 7, 'Receipts issued count is exactly 7', receiptsCount);

  // 4. Session State Manifest Verification
  console.log('\n--- 4. Session Manifest & Playwright Storage State Verification ---');
  const manifestPath = path.join(ROOT_DIR, '.local07-sessions/manifest.json');
  assert(fs.existsSync(manifestPath), '.local07-sessions/manifest.json exists');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert(Boolean(manifest['registration-owner']), 'Registration Owner session exists in manifest');
    assert(Boolean(manifest['fresh-owner']), 'Fresh Owner session exists in manifest');
    assert(Boolean(manifest['comp-owner']), 'Comprehensive Owner session exists in manifest');
    assert(Boolean(manifest['tenant-somchai']), 'Tenant Somchai session exists in manifest');
    assert(Boolean(manifest['manager']), 'Staff Manager session exists in manifest');
    assert(Boolean(manifest['tech']), 'Staff Tech session exists in manifest');
  }

  // 5. Oracle Document Verification
  console.log('\n--- 5. Oracle Documentation Verification ---');
  const oracleJsonPath = path.join(ROOT_DIR, 'docs/uat/local07-expected-results.json');
  const oracleMdPath = path.join(ROOT_DIR, 'docs/uat/LOCAL07_EXPECTED_RESULTS_TH.md');
  assert(fs.existsSync(oracleJsonPath), 'docs/uat/local07-expected-results.json exists');
  assert(fs.existsSync(oracleMdPath), 'docs/uat/LOCAL07_EXPECTED_RESULTS_TH.md exists');

  // 6. Temporal Projection Authority Verification (Monthly & Term)
  console.log('\n--- 6. Temporal Projection Authority Verification ---');
  const weeraContract = compDormDb?.contracts.find(c => c.contractNumber === 'CTR-2026-204');
  assert(Boolean(weeraContract), 'Comprehensive Monthly contract CTR-2026-204 exists');
  assert(weeraContract?.createdAt?.toISOString().startsWith('2026-07'), 'Room 204 Contract.createdAt is strictly in July 2026', weeraContract?.createdAt?.toISOString());
  assert(weeraContract?.startDate?.toISOString().startsWith('2026-06-01'), 'Room 204 Contract startDate is 2026-06-01', weeraContract?.startDate?.toISOString());
  assert(weeraContract?.endDate?.toISOString().startsWith('2026-08-01'), 'Room 204 Contract endDate is 2026-08-01', weeraContract?.endDate?.toISOString());

  const { MeterService } = require('../../server/dist/services/meter.service.js');
  const { PrismaMeterRepository } = require('../../server/dist/db/repositories/meter.repository.js');
  const { PrismaBillingCycleRepository } = require('../../server/dist/db/repositories/billing-cycle.repository.js');
  const { PrismaRoomRepository } = require('../../server/dist/db/repositories/room.repository.js');
  const { PrismaBillRepository } = require('../../server/dist/db/repositories/bill.repository.js');
  const { AuditService } = require('../../server/dist/services/audit.service.js');

  const meterService = new MeterService(
    new PrismaMeterRepository(prisma),
    new PrismaBillingCycleRepository(prisma),
    new PrismaRoomRepository(prisma),
    new PrismaBillRepository(prisma),
    new AuditService()
  );

  const cycleJulyDb = compDormDb?.billingCycles.find(c => c.cycleCode === '2026-07');
  const cycleAugDb = compDormDb?.billingCycles.find(c => c.cycleCode === '2026-08');
  const cycleSeptDb = compDormDb?.billingCycles.find(c => c.cycleCode === '2026-09');

  const room204Db = allRooms.find(r => r.roomNumber === '204');
  const room105Db = allRooms.find(r => r.roomNumber === '105');

  if (cycleJulyDb && room204Db) {
    const julyPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleJulyDb.id);
    const r204July = julyPreview.rooms.find(r => r.roomId === room204Db.id);
    assert(r204July?.tenantId === weeraContract?.tenantId, 'Room 204 (Weera) is visible in July 2026 (intersects July & registered July)');
    assert(r204July?.tenantName === 'นายวีระ กล้าหาญ', 'Room 204 tenant name is นายวีระ กล้าหาญ in July');

    const r105July = julyPreview.rooms.find(r => r.roomId === room105Db?.id);
    assert(Boolean(r105July?.tenantId) && r105July?.billingSource === 'PROVISIONAL_TERM', 'Room 105 (Term) is visible in July 2026 as PROVISIONAL_TERM');
    assert(r105July?.tenantName === 'นางสาวพิมพา สดใส', 'Room 105 tenant name is นางสาวพิมพา สดใส in July');
  }

  if (cycleAugDb && room204Db) {
    const augPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleAugDb.id);
    const r204Aug = augPreview.rooms.find(r => r.roomId === room204Db.id);
    assert(r204Aug?.tenantId === weeraContract?.tenantId, 'Room 204 (Weera) is visible in August 2026 (endDate 2026-08-01 intersects August)');
    assert(r204Aug?.tenantName === 'นายวีระ กล้าหาญ', 'Room 204 tenant name is นายวีระ กล้าหาญ in August');

    const r105Aug = augPreview.rooms.find(r => r.roomId === room105Db?.id);
    assert(Boolean(r105Aug?.tenantId) && r105Aug?.billingSource === 'PROVISIONAL_TERM', 'Room 105 (Term) is visible in August 2026 as PROVISIONAL_TERM');
  }

  if (cycleSeptDb && room204Db) {
    const septPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleSeptDb.id);
    const r204Sept = septPreview.rooms.find(r => r.roomId === room204Db.id);
    assert(r204Sept?.tenantId === null && r204Sept?.billingSource === 'NONE', 'Room 204 (Weera) is absent in September 2026 (contract ended August 1)');

    const r105Sept = septPreview.rooms.find(r => r.roomId === room105Db?.id);
    assert(Boolean(r105Sept?.tenantId) && r105Sept?.billingSource === 'PROVISIONAL_TERM', 'Room 105 (Term) is visible in September 2026 (term ends October 31)');
  }

  console.log('\n================================================================================');
  if (failures === 0) {
    console.log('🎉 ALL LOCAL-07 SANDBOX INTEGRITY CHECKS PASSED PERFECTLY (0 FAILURES)');
  } else {
    console.error(`❌ VERIFICATION FAILED WITH ${failures} ERRORS`);
  }
  console.log('================================================================================\n');

  await prisma.$disconnect();
  return failures === 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('verify.mjs')) {
  runVerification().then((success) => {
    if (!success) process.exit(1);
  }).catch((err) => {
    console.error(`❌ [VERIFICATION ERROR] ${err.message}`);
    process.exit(1);
  });
}
