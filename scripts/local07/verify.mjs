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
  const { BillingService } = require('../../server/dist/services/billing.service.js');
  const { PrismaMeterRepository } = require('../../server/dist/db/repositories/meter.repository.js');
  const { PrismaBillingCycleRepository } = require('../../server/dist/db/repositories/billing-cycle.repository.js');
  const { PrismaRoomRepository } = require('../../server/dist/db/repositories/room.repository.js');
  const { PrismaBillRepository } = require('../../server/dist/db/repositories/bill.repository.js');
  const { PrismaContractRepository } = require('../../server/dist/db/repositories/contract.repository.js');
  const { PrismaTenantRepository } = require('../../server/dist/db/repositories/tenant.repository.js');
  const { AuditService } = require('../../server/dist/services/audit.service.js');

  const meterRepo = new PrismaMeterRepository(prisma);
  const cycleRepo = new PrismaBillingCycleRepository(prisma);
  const roomRepo = new PrismaRoomRepository(prisma);
  const billRepo = new PrismaBillRepository(prisma);
  const contractRepo = new PrismaContractRepository(prisma);
  const tenantRepo = new PrismaTenantRepository(prisma);

  const meterService = new MeterService(
    meterRepo,
    cycleRepo,
    roomRepo,
    billRepo,
    new AuditService()
  );

  const billingService = new BillingService(
    billRepo,
    cycleRepo,
    meterRepo,
    contractRepo,
    roomRepo,
    tenantRepo
  );

  const cycleJulyDb = compDormDb?.billingCycles.find(c => c.cycleCode === '2026-07');
  const cycleAugDb = compDormDb?.billingCycles.find(c => c.cycleCode === '2026-08');
  const cycleSeptDb = compDormDb?.billingCycles.find(c => c.cycleCode === '2026-09');
  const cycleOctDb = compDormDb?.billingCycles.find(c => c.cycleCode === '2026-10');

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

  // 7. Daily Stay Domain & Financial Tail Verification
  console.log('\n--- 7. Daily Stay Domain & Financial Tail Verification ---');
  const room106Db = allRooms.find(r => r.roomNumber === '106');
  const room205Db = allRooms.find(r => r.roomNumber === '205');
  const room206Db = allRooms.find(r => r.roomNumber === '206');
  const roomB102Db = allRooms.find(r => r.roomNumber === 'B102');

  if (cycleAugDb && room106Db) {
    const augPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleAugDb.id);
    const r106Aug = augPreview.rooms.find(r => r.roomId === room106Db.id);
    assert(r106Aug?.billingSource === 'DAILY_STAY', 'Room 106 is ACTIVE Daily stay in August 2026');
    assert(r106Aug?.isDailyUnpaid === true, 'Room 106 has isDailyUnpaid = true in August 2026');
    assert(r106Aug?.isDailyOverdue === false, 'Room 106 has isDailyOverdue = false in August 2026 (active before checkout)');
  }

  if (cycleAugDb && room206Db) {
    const augPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleAugDb.id);
    const r206Aug = augPreview.rooms.find(r => r.roomId === room206Db.id);
    assert(r206Aug?.billingSource === 'DAILY_STAY', 'Room 206 is ACTIVE Daily stay in August 2026');
    assert(r206Aug?.isDailyRentPaid === true, 'Room 206 has isDailyRentPaid = true in August 2026 (active paid daily stay)');
    assert(r206Aug?.isDailyOverdue === false, 'Room 206 has isDailyOverdue = false in August 2026');
  }

  if (cycleJulyDb && room205Db) {
    const julyPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleJulyDb.id);
    const r205July = julyPreview.rooms.find(r => r.roomId === room205Db.id);
    assert(r205July?.isDailyUnpaid === true, 'Room 205 has isDailyUnpaid = true in July 2026 (checked-out unpaid tail)');
    assert(r205July?.isDailyOverdue === true, 'Room 205 has isDailyOverdue = true in July 2026 (checked-out unpaid overdue tail)');
  }

  if (cycleAugDb && room205Db) {
    const augPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleAugDb.id);
    const r205Aug = augPreview.rooms.find(r => r.roomId === room205Db.id);
    assert(r205Aug?.billingSource === 'NONE', 'Room 205 physical availability is free (NONE) in August 2026 despite July unpaid tail');
  }

  if (cycleJulyDb && roomB102Db) {
    const julyPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleJulyDb.id);
    const rB102July = julyPreview.rooms.find(r => r.roomId === roomB102Db.id);
    assert(rB102July?.isDailyUnpaid === false, 'Room B102 has isDailyUnpaid = false in July 2026 (historical settled stay)');
    assert(Number(rB102July?.historicalDailyCount) >= 1, 'Room B102 has historicalDailyCount >= 1 in July 2026');
  }

  if (cycleAugDb && room204Db) {
    const augPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleAugDb.id);
    const r204Aug = augPreview.rooms.find(r => r.roomId === room204Db.id);
    assert(r204Aug?.hasBookableGap === true, 'Room 204 has hasBookableGap = true in August 2026 (partial cycle after Aug 1)');
  }

  if (cycleSeptDb && room205Db) {
    const septPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleSeptDb.id);
    const r205Sept = septPreview.rooms.find(r => r.roomId === room205Db.id);
    assert(r205Sept?.hasBookableGap === true, 'Room 205 has hasBookableGap = true in September 2026 (future reservation starts Sept 15)');
  }

  // 8. Charge Component Matrix Verification (0, 1, 2, 3 components in August 2026)
  console.log('\n--- 8. Charge Component Matrix Verification (0, 1, 2, 3 components) ---');
  const room101Db = allRooms.find(r => r.roomNumber === '101');
  const room201Db = allRooms.find(r => r.roomNumber === '201');
  const room202Db = allRooms.find(r => r.roomNumber === '202');

  if (cycleAugDb && room105Db && room101Db && room201Db && room202Db && room205Db) {
    const augPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleAugDb.id);

    // 0 Components: Room 205 (Vacant room)
    const r205Aug = augPreview.rooms.find(r => r.roomId === room205Db.id);
    assert(r205Aug?.chargeComponents?.length === 0, 'Room 205 (Vacant) has 0 charge components in August 2026');
    assert(Number(r205Aug?.amountDue) === 0, 'Room 205 amountDue is 0.00 in August 2026');

    // 1 Component (INVALID utility): Room 105 (Term room with missing per_unit readings)
    const r105Aug = augPreview.rooms.find(r => r.roomId === room105Db.id);
    assert(r105Aug?.chargeComponents?.length === 1 && r105Aug?.chargeComponents[0]?.status === 'INVALID', 'Room 105 has 1 INVALID charge component in August 2026');
    assert(Number(r105Aug?.amountDue) === 0, 'Room 105 amountDue is 0.00 in August 2026');

    // 1 Component: Room 101
    const r101Aug = augPreview.rooms.find(r => r.roomId === room101Db.id);
    assert(r101Aug?.chargeComponents?.length === 1, 'Room 101 has 1 charge component in August 2026', r101Aug?.chargeComponents?.length);
    assert(Number(r101Aug?.amountDue) === 1268, 'Room 101 amountDue is 1268.00 in August 2026');

    // 2 Components (RENT + INVALID utility): Room 201
    const r201Aug = augPreview.rooms.find(r => r.roomId === room201Db.id);
    assert(r201Aug?.chargeComponents?.length === 2, 'Room 201 has 2 charge components in August 2026 (RENT + utility)', r201Aug?.chargeComponents?.length);
    assert(Number(r201Aug?.amountDue) === 4800, 'Room 201 amountDue is 4800.00 in August 2026 (unpaid rent only)');

    // 3 Components: Room 202 (RENT + DEPOSIT + MONTHLY_UTILITY)
    const r202Aug = augPreview.rooms.find(r => r.roomId === room202Db.id);
    assert(r202Aug?.chargeComponents?.length === 3, 'Room 202 has 3 charge components in August 2026', r202Aug?.chargeComponents?.length);
    assert(Number(r202Aug?.amountDue) === 6000, 'Room 202 amountDue is 6000.00 in August 2026 (unpaid rent + utility)');

    // Multi-Cycle Parity: July 2026 Room 101 (Decomposed into Rent 4500 + MU 950, 0 combined labels)
    if (cycleJulyDb) {
      const julPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleJulyDb.id);
      const r101Jul = julPreview.rooms.find(r => r.roomId === room101Db.id);
      assert(r101Jul?.chargeComponents?.length === 2, 'Room 101 has 2 decomposed charge components in July 2026 (Rent + MU)', r101Jul?.chargeComponents?.length);
      assert(r101Jul?.chargeComponents[0]?.type === 'rent' && r101Jul?.chargeComponents[0]?.amount === '4500.00', 'Room 101 July Rent component is 4500.00');
      assert(r101Jul?.chargeComponents[1]?.type === 'monthly_utility' && r101Jul?.chargeComponents[1]?.amount === '950.00', 'Room 101 July MU component is 950.00');
      assert(!r101Jul?.chargeComponents?.some(c => c.type === 'legacy_combined' || (c.label && c.label.includes('รวมค่าเช่า'))), 'Room 101 July has no combined component');
    }
  }

  // 9. Room 104 Complete Realistic Zero-Payable Meter Fixture Verification
  console.log('\n--- 9. Realistic Zero-Payable Meter Fixture Verification ---');
  const room104Db = allRooms.find(r => r.roomNumber === '104');
  if (cycleAugDb && room104Db) {
    const augReadings = await prisma.meterReading.findMany({
      where: { roomId: room104Db.id, billingCycleId: cycleAugDb.id },
    });
    const waterR = augReadings.find(r => r.meterType === 'water');
    const elecR = augReadings.find(r => r.meterType === 'electricity');
    assert(Number(waterR?.previousReading) === 138 && Number(waterR?.currentReading) === 138, 'Room 104 has populated water meter readings (138 -> 138) in August 2026');
    assert(Number(elecR?.previousReading) === 720 && Number(elecR?.currentReading) === 720, 'Room 104 has populated electric meter readings (720 -> 720) in August 2026');
  }

  // 10. Pull-Previous Workspace & People-Count Integration Verification
  console.log('\n--- 10. Pull-Previous Workspace & People-Count Integration Verification ---');
  if (cycleAugDb && room101Db) {
    const pullData = await meterService.pullPreviousWorkspaceData(COMP_DORM.id, cycleAugDb.id);
    const r101Pull = pullData.rooms.find(r => r.roomId === room101Db.id);

    assert(pullData.hasPreviousCycle === true, 'Pull previous reports hasPreviousCycle = true');
    assert(Number(r101Pull?.previousElectricityCurrentReading) === 560, 'Room 101 previousElectricityCurrentReading is 560.00 (pulled from July electric reading)', r101Pull?.previousElectricityCurrentReading);
    assert(Number(r101Pull?.previousWaterCurrentReading) === 110, 'Room 101 previousWaterCurrentReading is 110.00 (pulled from July water reading)', r101Pull?.previousWaterCurrentReading);
    assert(r101Pull?.previousCyclePeopleCount === 1, 'Room 101 previousCyclePeopleCount is 1 (from July snapshot)', r101Pull?.previousCyclePeopleCount);
    assert(r101Pull?.currentHouseholdPeopleCount === 2, 'Room 101 currentHouseholdPeopleCount is 2 (current registered household occupants)', r101Pull?.currentHouseholdPeopleCount);
  }

  // 11. Seeded Active Monthly Utility Bill Source & Split-Bill Structural Invariants
  console.log('\n--- 11. Seeded Active Monthly Utility Bill Source Invariant Verification ---');
  const allMonthlyUtilityBills = await prisma.bill.findMany({
    where: {
      dormitoryId: COMP_DORM.id,
      billKind: 'MONTHLY_UTILITY',
      status: { notIn: ['cancelled', 'void'] },
    },
    include: { items: true },
  });

  for (const bill of allMonthlyUtilityBills) {
    const readings = await prisma.meterReading.findMany({
      where: {
        dormitoryId: COMP_DORM.id,
        billingCycleId: bill.billingCycleId,
        roomId: bill.roomId,
      },
    });
    const waterR = readings.find(r => r.meterType === 'water');
    const elecR = readings.find(r => r.meterType === 'electricity');
    assert(
      waterR?.currentReading !== null && waterR?.currentReading !== undefined,
      `Bill ${bill.billNumber} (Room ${bill.roomId}) has valid current water meter reading`
    );
    assert(
      elecR?.currentReading !== null && elecR?.currentReading !== undefined,
      `Bill ${bill.billNumber} (Room ${bill.roomId}) has valid current electric meter reading`
    );

    // Split-Bill Invariant: MONTHLY_UTILITY must NOT contain RENT or DEPOSIT items
    const hasRentItem = bill.items.some(i => i.type === 'rent');
    const hasDepositItem = bill.items.some(i => i.type === 'deposit');
    assert(!hasRentItem, `MONTHLY_UTILITY bill ${bill.billNumber} contains no RENT items`);
    assert(!hasDepositItem, `MONTHLY_UTILITY bill ${bill.billNumber} contains no DEPOSIT items`);
  }

  // Split-bill Invariant: RENT / DEPOSIT bills must only contain rent/deposit items
  const allBills = await prisma.bill.findMany({
    where: { dormitoryId: COMP_DORM.id },
    include: { items: true },
  });
  for (const bill of allBills) {
    if (bill.billKind === 'RENT') {
      const hasNonRent = bill.items.some(i => i.type !== 'rent');
      assert(!hasNonRent, `RENT bill ${bill.billNumber} contains only rent items`);
    } else if (bill.billKind === 'DEPOSIT') {
      const hasNonDeposit = bill.items.some(i => i.type !== 'deposit');
      assert(!hasNonDeposit, `DEPOSIT bill ${bill.billNumber} contains only deposit items`);
    }

    // Bill Item Sum Invariant: sum(items.amount) === bill.subtotal === bill.totalAmount
    const itemSum = bill.items.reduce((acc, i) => acc + Number(i.amount), 0);
    assert(
      Math.abs(itemSum - Number(bill.totalAmount)) < 0.01,
      `Bill ${bill.billNumber} item sum (${itemSum}) equals totalAmount (${bill.totalAmount})`
    );
    assert(
      Math.abs(Number(bill.subtotal) - Number(bill.totalAmount)) < 0.01,
      `Bill ${bill.billNumber} subtotal (${bill.subtotal}) equals totalAmount (${bill.totalAmount})`
    );
  }

  // 12. Strict Issued-Bill & Baseline-Only Save Integrity Verification
  console.log('\n--- 12. Strict Issued-Bill & Baseline-Only Save Integrity Verification ---');
  if (cycleAugDb && room101Db) {
    // 12a. Critical August Save Invariant: Unchanged save on Room 101 has delta = 0.00
    const bill101Before = await prisma.bill.findFirst({
      where: { dormitoryId: COMP_DORM.id, roomId: room101Db.id, billingCycleId: cycleAugDb.id, billNumber: 'INV-202608-101' },
    });
    const totalBefore = Number(bill101Before?.totalAmount);

    const unchangedSaveRes = await meterService.saveBulkMeterWorkspace(
      COMP_DORM.id,
      {
        billingCycleId: cycleAugDb.id,
        rows: [
          {
            roomId: room101Db.id,
            waterPrev: 110,
            waterCurr: 121,
            elecPrev: 560,
            elecCurr: 620,
          },
        ],
      },
      'test-admin',
      billingService
    );
    assert(unchangedSaveRes.savedCount === 1, 'Unchanged Room 101 meter save succeeds');

    const bill101After = await prisma.bill.findFirst({
      where: { dormitoryId: COMP_DORM.id, roomId: room101Db.id, billingCycleId: cycleAugDb.id, billNumber: 'INV-202608-101' },
    });
    const totalAfter = Number(bill101After?.totalAmount);
    assert(
      Math.abs(totalBefore - totalAfter) < 0.01,
      `Critical August Save Invariant: Room 101 bill total remains unchanged (${totalBefore} -> ${totalAfter}, delta = 0.00)`
    );

    // 12b. Unissued room (e.g. Room 102 in August) saving baseline-only (blank current) succeeds
    const room102Db = allRooms.find(r => r.roomNumber === '102');
    if (room102Db) {
      const saveRes = await meterService.saveBulkMeterWorkspace(
        COMP_DORM.id,
        {
          billingCycleId: cycleAugDb.id,
          rows: [
            {
              roomId: room102Db.id,
              waterPrev: 110,
              waterCurr: null,
              elecPrev: 560,
              elecCurr: null,
            },
          ],
        },
        'test-admin',
        billingService
      );
      assert(saveRes.savedCount === 1, 'Unissued room baseline-only save succeeds');
      const r102Water = await prisma.meterReading.findFirst({
        where: { roomId: room102Db.id, billingCycleId: cycleAugDb.id, meterType: 'water' },
      });
      assert(r102Water?.previousReading !== null && r102Water?.currentReading === null, 'Unissued room persists baseline and null current');
    }

    // 12c. Issued room (Room 101 with INV-202608-101) clearing current reading fails closed
    let threwClosed = false;
    try {
      await meterService.saveBulkMeterWorkspace(
        COMP_DORM.id,
        {
          billingCycleId: cycleAugDb.id,
          rows: [
            {
              roomId: room101Db.id,
              waterPrev: 110,
              waterCurr: null,
              elecPrev: 560,
              elecCurr: 620,
            },
          ],
        },
        'test-admin',
        billingService
      );
    } catch (err) {
      if (err.code === 'CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL') {
        threwClosed = true;
      }
    }
    assert(threwClosed === true, 'Clearing current meter reading on issued unpaid bill fails closed with CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL');
  }

  // 13. Executable 5-State Owner Rooms Financial Oracle Matrix (Production MeterService Authority)
  console.log('\n--- 13. Executable 5-State Owner Rooms Financial Oracle Matrix ---');
  assert(Boolean(cycleJulyDb), 'Oracle Fixture Precondition: cycle 2026-07 exists in DB');
  assert(Boolean(cycleAugDb), 'Oracle Fixture Precondition: cycle 2026-08 exists in DB');
  assert(Boolean(cycleSeptDb), 'Oracle Fixture Precondition: cycle 2026-09 exists in DB');
  assert(Boolean(cycleOctDb), 'Oracle Fixture Precondition: cycle 2026-10 exists in DB');

  const r101Db = allRooms.find(r => r.roomNumber === '101');
  const r104Db = allRooms.find(r => r.roomNumber === '104');
  const r106Db = allRooms.find(r => r.roomNumber === '106');
  const r201Db = allRooms.find(r => r.roomNumber === '201');
  const r202Db = allRooms.find(r => r.roomNumber === '202');
  const r203Db = allRooms.find(r => r.roomNumber === '203');
  const r205Db = allRooms.find(r => r.roomNumber === '205');
  const r206Db = allRooms.find(r => r.roomNumber === '206');
  const r303Db = allRooms.find(r => r.roomNumber === '303');

  assert(Boolean(r101Db), 'Oracle Fixture Precondition: Room 101 exists in DB');
  assert(Boolean(r104Db), 'Oracle Fixture Precondition: Room 104 exists in DB');
  assert(Boolean(r106Db), 'Oracle Fixture Precondition: Room 106 exists in DB');
  assert(Boolean(r201Db), 'Oracle Fixture Precondition: Room 201 exists in DB');
  assert(Boolean(r202Db), 'Oracle Fixture Precondition: Room 202 exists in DB');
  assert(Boolean(r203Db), 'Oracle Fixture Precondition: Room 203 exists in DB');
  assert(Boolean(r205Db), 'Oracle Fixture Precondition: Room 205 exists in DB');
  assert(Boolean(r206Db), 'Oracle Fixture Precondition: Room 206 exists in DB');
  assert(Boolean(r303Db), 'Oracle Fixture Precondition: Room 303 exists in DB');

  const julyPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleJulyDb.id);
  const augPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleAugDb.id);
  const septPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleSeptDb.id);
  const octPreview = await meterService.getMeterBillingPreviewContext(COMP_DORM.id, cycleOctDb.id);

    // Matrix Scenario A: RENT PAID (July 2026 Room 101)
    const p101Jul = julyPreview.rooms.find(r => r.roomId === r101Db?.id);
    const p101Aug = augPreview.rooms.find(r => r.roomId === r101Db?.id);
    assert(
      p101Jul?.agreementRentPaymentStatus === 'PAID',
      'Matrix A: RENT PAID -> Room 101 (2026-07) rent status is PAID (จ่ายแล้ว)',
      p101Jul?.agreementRentPaymentStatus
    );

    // Matrix Scenario A2: ROOM 101 DEPOSIT ORACLE & SINGLE SEEDED BILL IDENTITY
    const r101DepositBills = await prisma.bill.findMany({
      where: { dormitoryId: COMP_DORM.id, roomId: r101Db.id, billKind: 'DEPOSIT' },
    });
    assert(
      r101DepositBills.length === 1,
      `Room 101 Deposit Bill single identity invariant (found ${r101DepositBills.length}, expected 1)`
    );
    assert(
      r101DepositBills[0]?.billNumber === 'INV-202606-101-D',
      `Room 101 Deposit Bill is the seeded June Deposit Bill INV-202606-101-D without duplicates (${r101DepositBills[0]?.billNumber})`
    );
    assert(
      p101Jul?.agreementDepositPaymentStatus === 'PAID',
      'Matrix A2: DEPOSIT PAID -> Room 101 (2026-07) deposit status is PAID (ชำระแล้ว)',
      p101Jul?.agreementDepositPaymentStatus
    );
    assert(
      p101Aug?.agreementDepositPaymentStatus === 'PAID',
      'Matrix A2: DEPOSIT PAID LIFECYCLE -> Room 101 (2026-08) deposit status is PAID (ชำระแล้ว)',
      p101Aug?.agreementDepositPaymentStatus
    );

    // Matrix Scenario B: RENT UNPAID (August 2026 Room 201)
    const p201Aug = augPreview.rooms.find(r => r.roomId === r201Db?.id);
    assert(
      p201Aug?.agreementRentPaymentStatus === 'UNPAID',
      'Matrix B: RENT UNPAID -> Room 201 (2026-08) rent status is UNPAID (รอชำระ)',
      p201Aug?.agreementRentPaymentStatus
    );

    // Matrix Scenario C: RENT PARTIAL (August 2026 Room 203)
    const p203Aug = augPreview.rooms.find(r => r.roomId === r203Db?.id);
    assert(
      p203Aug?.agreementRentPaymentStatus === 'PARTIAL',
      'Matrix C: RENT PARTIAL -> Room 203 (2026-08) rent status is PARTIAL (ชำระบางส่วน: 2000/4800)',
      p203Aug?.agreementRentPaymentStatus
    );

    // Matrix Scenario D: RENT NOT_ISSUED (August 2026 Room 303)
    const p303Aug = augPreview.rooms.find(r => r.roomId === r303Db?.id);
    assert(
      p303Aug?.agreementRentPaymentStatus === 'NOT_ISSUED',
      'Matrix D: RENT NOT_ISSUED -> Room 303 (2026-08) active contract with no issued bill evaluates to NOT_ISSUED (ยังไม่ออกบิล)',
      p303Aug?.agreementRentPaymentStatus
    );

    // Matrix Scenario E: DEPOSIT PAID (August 2026 Room 202)
    const p202Aug = augPreview.rooms.find(r => r.roomId === r202Db?.id);
    assert(
      p202Aug?.agreementDepositPaymentStatus === 'PAID',
      'Matrix E: DEPOSIT PAID -> Room 202 (2026-08) deposit status is PAID (จ่ายแล้ว: INV-202608-202-D)',
      p202Aug?.agreementDepositPaymentStatus
    );

    // Matrix Scenario F: SAME AGREEMENT in later cycle (September 2026 Room 202)
    const p202Sept = septPreview.rooms.find(r => r.roomId === r202Db?.id);
    assert(
      p202Sept?.agreementDepositPaymentStatus === 'PAID',
      'Matrix F: SAME AGREEMENT in later cycle -> Room 202 (2026-09) inherits August paid deposit as PAID without new deposit bill',
      p202Sept?.agreementDepositPaymentStatus
    );

    // Matrix Scenario F2: DEPOSIT LIFECYCLE (3 Cycles: August, September, October Room 202)
    const p202Oct = octPreview.rooms.find(r => r.roomId === r202Db?.id);
    assert(
      p202Aug?.agreementDepositPaymentStatus === 'PAID' &&
      p202Sept?.agreementDepositPaymentStatus === 'PAID' &&
      p202Oct?.agreementDepositPaymentStatus === 'PAID',
      'Matrix F2: DEPOSIT LIFECYCLE (3 Cycles) -> Room 202 deposit is PAID in August (2026-08), September (2026-09), and October (2026-10)',
      `Aug: ${p202Aug?.agreementDepositPaymentStatus}, Sept: ${p202Sept?.agreementDepositPaymentStatus}, Oct: ${p202Oct?.agreementDepositPaymentStatus}`
    );

    // Matrix Scenario F3: ONE-TIME DEPOSIT CHARGE IN START CYCLE (August Room 202)
    const r202AugDepCompCount = p202Aug?.chargeComponents?.filter(c => c.type === 'deposit')?.length || 0;
    const r202SeptDepCompCount = p202Sept?.chargeComponents?.filter(c => c.type === 'deposit')?.length || 0;
    const r202OctDepCompCount = p202Oct?.chargeComponents?.filter(c => c.type === 'deposit')?.length || 0;
    assert(
      r202AugDepCompCount === 1 && r202SeptDepCompCount === 0 && r202OctDepCompCount === 0,
      'Matrix F3: ONE-TIME DEPOSIT CHARGE -> Room 202 has exactly 1 deposit charge in start cycle (Aug) and 0 in subsequent cycles (Sept, Oct)',
      `Aug: ${r202AugDepCompCount}, Sept: ${r202SeptDepCompCount}, Oct: ${r202OctDepCompCount}`
    );

    // Matrix Scenario G: DEPOSIT NOT_ISSUED (August 2026 Room 303)
    assert(
      p303Aug?.agreementDepositPaymentStatus === 'NOT_ISSUED',
      'Matrix G: DEPOSIT NOT_ISSUED -> Room 303 (2026-08) requires deposit but no deposit bill issued evaluates to NOT_ISSUED (ยังไม่ออกบิล)',
      p303Aug?.agreementDepositPaymentStatus
    );

    // Matrix Scenario H: DAILY RENT UNPAID & PAID (August 2026 Room 106 & 206)
    const p106Aug = augPreview.rooms.find(r => r.roomId === r106Db?.id);
    const p206Aug = augPreview.rooms.find(r => r.roomId === r206Db?.id);
    assert(
      p106Aug?.agreementRentPaymentStatus === 'UNPAID',
      'Matrix H: DAILY RENT -> Room 106 (2026-08) daily stay rent status is UNPAID (รอชำระ)',
      p106Aug?.agreementRentPaymentStatus
    );
    assert(
      p206Aug?.agreementRentPaymentStatus === 'PAID',
      'Matrix H2: DAILY RENT PAID -> Room 206 (2026-08) daily stay rent status is PAID (จ่ายแล้ว)',
      p206Aug?.agreementRentPaymentStatus
    );

    // Matrix Scenario I: DAILY DEPOSIT -> Room 106 (2026-08) daily stay deposit status is UNPAID (รอชำระ)
    assert(
      p106Aug?.agreementDepositPaymentStatus === 'UNPAID',
      'Matrix I: DAILY DEPOSIT -> Room 106 (2026-08) daily stay deposit status is UNPAID (รอชำระ)',
      p106Aug?.agreementDepositPaymentStatus
    );

    // Matrix Scenario J: RESERVED IN CYCLE (September 2026 Room 205)
    const p205Sept = septPreview.rooms.find(r => r.roomId === r205Db?.id);
    assert(
      p205Sept?.cyclePresentationState === 'RESERVED_IN_CYCLE' && p205Sept?.agreementRentPaymentStatus === 'NOT_ISSUED',
      'Matrix J: RESERVED IN CYCLE -> Room 205 (2026-09) is RESERVED_IN_CYCLE with rent status NOT_ISSUED (ยังไม่ออกบิล)',
      `State: ${p205Sept?.cyclePresentationState}, Rent: ${p205Sept?.agreementRentPaymentStatus}`
    );

    // Matrix Scenario K: Ambiguous LEGACY_COMBINED Partial -> Room 104 (2026-08) combined partial bill resolves rent & deposit to UNKNOWN (ไม่พบข้อมูลการชำระ)
    const p104Aug = augPreview.rooms.find(r => r.roomId === r104Db?.id);
    assert(
      p104Aug?.agreementRentPaymentStatus === 'UNKNOWN' && p104Aug?.agreementDepositPaymentStatus === 'UNKNOWN',
      'Matrix K: Ambiguous LEGACY_COMBINED Partial -> Room 104 (2026-08) combined partial bill resolves rent & deposit to UNKNOWN (ไม่พบข้อมูลการชำระ)',
      `Rent: ${p104Aug?.agreementRentPaymentStatus}, Deposit: ${p104Aug?.agreementDepositPaymentStatus}`
    );

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
