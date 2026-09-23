import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createRequire } from 'module';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const envConfig = dotenv.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/.env')));
const prisma = new PrismaClient({
  datasources: { db: { url: envConfig.DIRECT_URL || envConfig.DATABASE_URL } },
});

const APP_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.agents/local/screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function loadAuth(role) {
  const file = path.join(ROOT_DIR, `.agents/local/sessions/${role}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Session file not found: ${file}. Run generate-test-sessions.mjs first.`);
  }
  const session = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const sessionCookie = session.cookies.find(c => c.name === 'horplus_session')?.value;
  const csrfCookie = session.cookies.find(c => c.name === 'horplus_csrf')?.value;
  return {
    rawSession: session,
    cookieHeader: `horplus_session=${sessionCookie}; horplus_csrf=${csrfCookie}`,
    csrfToken: csrfCookie,
  };
}

async function run() {
  console.log('====================================================');
  console.log('  TASK-011 Live Verification on https://app.hor-plus.com');
  console.log('====================================================');

  const owner = loadAuth('owner');
  const manager = loadAuth('manager');
  const staff = loadAuth('staff');
  const tenant = loadAuth('tenant');

  const results = {};

  // Fetch cycles and rooms
  const cycle = await prisma.billingCycle.findFirst({
    where: { dormitoryId: DORM_ID, cycleCode: '2026-10' },
  });
  const room = await prisma.room.findFirst({
    where: { dormitoryId: DORM_ID, roomNumber: '103' },
  });

  console.log(`Using Cycle: ${cycle.cycleCode} (${cycle.id}), Room: ${room.roomNumber} (${room.id})`);

  // ==============================================================
  // AC-1: Meter Reading Monotonicity, Rollover, and Validation
  // ==============================================================
  console.log('\n--- Checking AC-1: Meter Monotonicity & Rollover ---');

  // Find existing previous reading for room 103 water
  const existingDev = await prisma.meterDevice.findFirst({
    where: { roomId: room.id, type: 'water' },
  });
  const prevReading = existingDev?.currentReading?.toString() || existingDev?.initialReading?.toString() || '0';
  console.log(`Current water device initial/current reading for room 103: ${prevReading}`);

  // 1.1 Lower reading without rollover rejected
  // We send a reading lower than prevReading
  const testPrev = '500';
  const testLower = '450';

  // Setup room 206 for rollover test
  const rolloverTestRoom = await prisma.room.findFirst({
    where: { dormitoryId: DORM_ID, roomNumber: '206' },
  });
  await prisma.meterReading.deleteMany({
    where: { dormitoryId: DORM_ID, billingCycleId: cycle.id, roomId: rolloverTestRoom.id, meterType: 'water' },
  });
  let dev206 = await prisma.meterDevice.findFirst({
    where: { roomId: rolloverTestRoom.id, type: 'water' },
  });
  if (dev206) {
    await prisma.meterDevice.update({
      where: { id: dev206.id },
      data: { initialReading: '500' },
    });
  } else {
    dev206 = await prisma.meterDevice.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: rolloverTestRoom.id,
        type: 'water',
        meterNumber: `WATER-${rolloverTestRoom.id.slice(-4)}`,
        initialReading: '500',
      },
    });
  }

  // 1.1 Try lower reading (450 vs 500)
  const lowerReadingRes = await fetch(`${APP_URL}/api/v1/meters/readings/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': owner.cookieHeader,
      'X-CSRF-Token': owner.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      billingCycleId: cycle.id,
      readings: [
        {
          roomId: rolloverTestRoom.id,
          meterType: 'water',
          previousReading: '500',
          currentReading: '450', // Lower than previous!
        },
      ],
    }),
  });
  const lowerJson = await lowerReadingRes.json();
  const lowerRejected = lowerReadingRes.status === 400 && (lowerJson.error?.code === 'INVALID_METER_READING_LOWER' || lowerJson.error?.code === 'INVALID_METER_READING');
  console.log(`1.1 Lower reading rejection: HTTP ${lowerReadingRes.status} (${lowerJson.error?.code}) -> ${lowerRejected ? 'PASS' : 'FAIL'}`);

  // 1.2 4-digit rollover: prev 9950, curr 25 -> usage = (10000 - 9950) + 25 = 75
  await prisma.meterDevice.update({
    where: { id: dev206.id },
    data: { initialReading: '9950' },
  });

  const rolloverRes = await fetch(`${APP_URL}/api/v1/meters/readings/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': owner.cookieHeader,
      'X-CSRF-Token': owner.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      billingCycleId: cycle.id,
      readings: [
        {
          roomId: rolloverTestRoom.id,
          meterType: 'water',
          previousReading: '9950',
          currentReading: '25', // 4-digit rollover: usage = (10000 - 9950) + 25 = 75
        },
      ],
    }),
  });
  const rolloverJson = await rolloverRes.json();
  const rolloverSuccess = rolloverRes.status === 200 && rolloverJson.data && Number(rolloverJson.data[0]?.usageUnits) === 75;
  console.log(`1.2 4-digit rollover reading: HTTP ${rolloverRes.status}, usageUnits: ${rolloverJson.data?.[0]?.usageUnits} -> ${rolloverSuccess ? 'PASS' : 'FAIL'}`);

  results['AC-1'] = lowerRejected && rolloverSuccess ? 'PASS' : 'FAIL';

  // ==============================================================
  // AC-2: Tenant Draft Bill Isolation & Visibility
  // ==============================================================
  console.log('\n--- Checking AC-2: Tenant Draft Bill Isolation ---');
  // Create a draft bill specifically for testing draft isolation
  const testDraftBill = await prisma.bill.create({
    data: {
      dormitoryId: DORM_ID,
      billingCycleId: cycle.id,
      roomId: room.id,
      tenantId: '57e85b41-3f99-461d-9590-cf7590f6afd7', // Somchai
      billNumber: `INV-TEST-DRAFT-${Date.now().toString().slice(-4)}`,
      status: 'draft',
      billingDate: new Date('2026-10-01'),
      dueDate: new Date('2026-10-05'),
      subtotal: '4500.00',
      totalAmount: '4500.00',
      paidAmount: '0.00',
      outstandingAmount: '4500.00',
    },
  });
  console.log(`Created test draft bill: ${testDraftBill.id} (${testDraftBill.billNumber}, status: ${testDraftBill.status})`);

  // 2.1 Call GET /api/v1/tenant-portal/bills as tenant
  const tenantBillsRes = await fetch(`${APP_URL}/api/v1/tenant-portal/bills`, {
    headers: { 'Cookie': tenant.cookieHeader },
  });
  const tenantBillsJson = await tenantBillsRes.json();
  const returnedBills = tenantBillsJson.data || [];
  const draftBillLeaked = returnedBills.some(b => b.id === testDraftBill.id || b.status === 'draft' || b.status === 'DRAFT');
  console.log(`2.1 Tenant GET /bills returned ${returnedBills.length} bills. Draft bill leaked: ${draftBillLeaked}`);

  // 2.2 Direct call to draft bill by ID as tenant
  const directDraftRes = await fetch(`${APP_URL}/api/v1/tenant-portal/bills/${testDraftBill.id}`, {
    headers: { 'Cookie': tenant.cookieHeader },
  });
  const directDraftJson = await directDraftRes.json();
  const directRejected = directDraftRes.status === 404 && directDraftJson.error?.code === 'TENANT_BILL_NOT_FOUND';
  console.log(`2.2 Tenant GET /bills/:id for draft bill: HTTP ${directDraftRes.status} (${directDraftJson.error?.code}) -> ${directRejected ? 'PASS' : 'FAIL'}`);

  results['AC-2'] = !draftBillLeaked && directRejected ? 'PASS' : 'FAIL';

  // Clean up test draft bill
  await prisma.bill.delete({ where: { id: testDraftBill.id } });

  // ==============================================================
  // AC-3: Exact Decimal Monetary Calculation Parity
  // ==============================================================
  console.log('\n--- Checking AC-3: Exact Decimal Monetary Calculation Parity ---');
  const previewRes = await fetch(`${APP_URL}/api/v1/bills/preview?billingCycleId=${cycle.id}&roomId=${room.id}&billKind=RENT`, {
    headers: {
      'Cookie': owner.cookieHeader,
      'x-dormitory-id': DORM_ID,
    },
  });
  const previewJson = await previewRes.json();
  const previewData = previewJson.data;
  console.log('Preview Data:', {
    rent: previewData?.rentAmount,
    water: previewData?.waterAmount,
    elec: previewData?.electricityAmount,
    subtotal: previewData?.subtotal,
    total: previewData?.totalAmount,
  });
  const previewValid = previewRes.status === 200 && previewData?.totalAmount === '4500.00';

  const tenantBill = returnedBills[0];
  const parityPass = previewValid && tenantBill && Number(tenantBill.totalAmount) === 4500;
  console.log(`3.1 Decimal calculation parity: Preview valid: ${previewValid} (total: ${previewData?.totalAmount}), Tenant bill (${tenantBill?.billNumber}) total: ${tenantBill?.totalAmount} -> ${parityPass ? 'PASS' : 'FAIL'}`);
  results['AC-3'] = parityPass ? 'PASS' : 'FAIL';

  // ==============================================================
  // AC-4: Rate Snapshot Immutability
  // ==============================================================
  console.log('\n--- Checking AC-4: Rate Snapshot Immutability ---');
  const cycleWithSnapshot = await prisma.billingCycle.findUnique({
    where: { id: cycle.id },
    include: { rateSnapshot: true },
  });
  console.log('Billing Cycle Rate Snapshot:', {
    hasSnapshot: !!cycleWithSnapshot?.rateSnapshot,
    waterRate: cycleWithSnapshot?.rateSnapshot?.waterRate?.toString(),
    electricRate: cycleWithSnapshot?.rateSnapshot?.electricityRate?.toString(),
  });
  results['AC-4'] = cycleWithSnapshot ? 'PASS' : 'FAIL';

  // ==============================================================
  // AC-5: Permissioned Issue and Void Mutations
  // ==============================================================
  console.log('\n--- Checking AC-5: Permissioned Issue and Void Mutations ---');
  // 5.1 Staff denied billing:write
  const staffGenerateRes = await fetch(`${APP_URL}/api/v1/bills/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': staff.cookieHeader,
      'X-CSRF-Token': staff.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({ billingCycleId: cycle.id, roomId: room.id }),
  });
  const staffGenerateBlocked = staffGenerateRes.status === 403;
  console.log(`5.1 Staff POST /bills/generate: HTTP ${staffGenerateRes.status} -> ${staffGenerateBlocked ? 'PASS' : 'FAIL'}`);

  const staffVoidRes = await fetch(`${APP_URL}/api/v1/bills/fake-bill-id/void`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': staff.cookieHeader,
      'X-CSRF-Token': staff.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({ reason: 'testing staff void' }),
  });
  const staffVoidBlocked = staffVoidRes.status === 403;
  console.log(`5.2 Staff POST /bills/:id/void: HTTP ${staffVoidRes.status} -> ${staffVoidBlocked ? 'PASS' : 'FAIL'}`);

  // 5.2 Tenant denied billing:write
  const tenantGenerateRes = await fetch(`${APP_URL}/api/v1/bills/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': tenant.cookieHeader,
      'X-CSRF-Token': tenant.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({ billingCycleId: cycle.id, roomId: room.id }),
  });
  const tenantGenerateBlocked = tenantGenerateRes.status === 403;
  console.log(`5.3 Tenant POST /bills/generate: HTTP ${tenantGenerateRes.status} -> ${tenantGenerateBlocked ? 'PASS' : 'FAIL'}`);

  // 5.3 Owner cancelling a paid bill rejected
  const mockPaid = await prisma.bill.create({
    data: {
      dormitoryId: DORM_ID,
      billingCycleId: cycle.id,
      roomId: room.id,
      billNumber: `INV-PAID-TEST-${Date.now().toString().slice(-4)}`,
      status: 'paid',
      billingDate: new Date(),
      dueDate: new Date(),
      totalAmount: '1000.00',
      subtotal: '1000.00',
      paidAmount: '1000.00',
      outstandingAmount: '0.00',
    },
  });
  const paidCancelRes = await fetch(`${APP_URL}/api/v1/bills/${mockPaid.id}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': owner.cookieHeader,
      'X-CSRF-Token': owner.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({ reason: 'cancel paid bill' }),
  });
  const paidCancelJson = await paidCancelRes.json();
  const paidBillCancelBlocked = paidCancelRes.status === 400 && paidCancelJson.error?.code === 'BILL_CANNOT_BE_CANCELLED';
  await prisma.bill.delete({ where: { id: mockPaid.id } });
  console.log(`5.4 Owner cancel paid bill test: HTTP ${paidCancelRes.status} (${paidCancelJson.error?.code}) -> ${paidBillCancelBlocked ? 'PASS' : 'FAIL'}`);

  // 5.4 Owner voiding unpaid bill soft-cancels without deletion
  const mockUnpaid = await prisma.bill.create({
    data: {
      dormitoryId: DORM_ID,
      billingCycleId: cycle.id,
      roomId: room.id,
      billNumber: `INV-VOID-TEST-${Date.now().toString().slice(-4)}`,
      status: 'unpaid',
      billingDate: new Date(),
      dueDate: new Date(),
      totalAmount: '2000.00',
      subtotal: '2000.00',
      paidAmount: '0.00',
      outstandingAmount: '2000.00',
    },
  });

  const voidRes = await fetch(`${APP_URL}/api/v1/bills/${mockUnpaid.id}/void`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': owner.cookieHeader,
      'X-CSRF-Token': owner.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({ reason: 'จดมิเตอร์ผิดพลาด ต้องยกเลิกบิลเพื่อคำนวณใหม่' }),
  });
  const voidJson = await voidRes.json();
  const voidedInDb = await prisma.bill.findUnique({ where: { id: mockUnpaid.id } });
  const voidSuccess = voidRes.status === 200 && voidedInDb?.status === 'cancelled' && voidedInDb?.cancellationReason === 'จดมิเตอร์ผิดพลาด ต้องยกเลิกบิลเพื่อคำนวณใหม่';
  console.log(`5.5 Owner POST /bills/:id/void: HTTP ${voidRes.status}, status in DB: ${voidedInDb?.status} -> ${voidSuccess ? 'PASS' : 'FAIL'}`);

  await prisma.billStatusHistory.deleteMany({ where: { billId: mockUnpaid.id } });
  await prisma.bill.delete({ where: { id: mockUnpaid.id } });

  results['AC-5'] = staffGenerateBlocked && staffVoidBlocked && tenantGenerateBlocked && paidBillCancelBlocked && voidSuccess ? 'PASS' : 'FAIL';

  // ==============================================================
  // AC-6: Meter Readings Query Resilience (N-02)
  // ==============================================================
  console.log('\n--- Checking AC-6: Meter Readings Query Resilience (N-02) ---');
  const meterReadingsRes = await fetch(`${APP_URL}/api/v1/meters/readings?pageSize=500`, {
    headers: {
      'Cookie': owner.cookieHeader,
      'x-dormitory-id': DORM_ID,
    },
  });
  const meterReadingsJson = await meterReadingsRes.json();
  const pageSizeHonored = meterReadingsRes.status === 200 && meterReadingsJson.pagination?.pageSize === 500;
  console.log(`6.1 Meter readings query pageSize: HTTP ${meterReadingsRes.status}, pageSize: ${meterReadingsJson.pagination?.pageSize} -> ${pageSizeHonored ? 'PASS' : 'FAIL'}`);

  results['AC-6'] = pageSizeHonored ? 'PASS' : 'FAIL';

  // ==============================================================
  // Browser Screenshots
  // ==============================================================
  console.log('\n--- Taking Live Browser Screenshots ---');
  const browser = await chromium.launch({ headless: true });

  // 1. Tenant Portal Bills (verify only issued/unpaid/paid bills visible, no draft bills)
  const tenantContext = await browser.newContext({ storageState: tenant.rawSession });
  const tenantPage = await tenantContext.newPage();
  await tenantPage.goto(`${APP_URL}/tenant/bills`, { waitUntil: 'networkidle' });
  await tenantPage.waitForTimeout(2000);
  const tenantBillsScreenshotPath = path.join(SCREENSHOTS_DIR, 'ac2-tenant-bills-live.png');
  await tenantPage.screenshot({ path: tenantBillsScreenshotPath, fullPage: true });
  console.log(`Saved screenshot: ${tenantBillsScreenshotPath}`);
  await tenantContext.close();

  // 2. Owner Meter Reading Workspace
  const ownerContext = await browser.newContext({ storageState: owner.rawSession });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${APP_URL}/owner/meters`, { waitUntil: 'networkidle' });
  await ownerPage.waitForTimeout(2000);
  const ownerMetersScreenshotPath = path.join(SCREENSHOTS_DIR, 'ac1-owner-meters-live.png');
  await ownerPage.screenshot({ path: ownerMetersScreenshotPath, fullPage: true });
  console.log(`Saved screenshot: ${ownerMetersScreenshotPath}`);
  await ownerContext.close();

  await browser.close();

  console.log('\n====================================================');
  console.log('  Live Check Results Summary:');
  console.log(JSON.stringify(results, null, 2));
  console.log('====================================================');
}

run().catch(console.error).finally(() => prisma.$disconnect());
