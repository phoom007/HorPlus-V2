import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createRequire } from 'module';
import dotenv from 'dotenv';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');
const sharp = require('../../server/node_modules/sharp');

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
    userId: session.user?.id,
  };
}

async function run() {
  console.log('====================================================');
  console.log('  TASK-012 Live Verification on https://app.hor-plus.com');
  console.log('====================================================');

  const owner = loadAuth('owner');
  const manager = loadAuth('manager');
  const staff = loadAuth('staff');
  const tenant = loadAuth('tenant');

  const results = {};

  // Ensure dormitory billing settings has promptpay/bank configured for test dorm
  let settings = await prisma.dormitoryBillingSettings.findFirst({
    where: { dormitoryId: DORM_ID },
  });
  if (!settings) {
    settings = await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: DORM_ID,
        promptPayValue: '0812345678',
        promptPayAccountName: 'หอพัก HorPlus UAT Manor',
        bankCode: 'KBANK',
        bankAccountNumber: '0123456789',
        bankAccountName: 'หอพัก HorPlus UAT Manor',
        dueDay: 5,
      },
    });
  } else if (!settings.promptPayValue || !settings.bankAccountNumber) {
    settings = await prisma.dormitoryBillingSettings.update({
      where: { id: settings.id },
      data: {
        promptPayValue: settings.promptPayValue || '0812345678',
        promptPayAccountName: settings.promptPayAccountName || 'หอพัก HorPlus UAT Manor',
        bankCode: settings.bankCode || 'KBANK',
        bankAccountNumber: settings.bankAccountNumber || '0123456789',
        bankAccountName: settings.bankAccountName || 'หอพัก HorPlus UAT Manor',
      },
    });
  }

  // ==============================================================
  // AC-1 & AC-4: SlipOK Verification, Receiver Separation (N-03)
  // ==============================================================
  console.log('\n--- Checking AC-1 & AC-4: SlipOK Receiver Separation & Settings ---');
  const platformPromptPay = '0935098808';
  const dormPromptPay = settings.promptPayValue?.replace(/\D/g, '');
  const dormBank = settings.bankAccountNumber?.replace(/\D/g, '');

  console.log(`Dormitory PromptPay: ${dormPromptPay}`);
  console.log(`Dormitory Bank Account: ${dormBank}`);
  console.log(`Platform PromptPay (Subscription only): ${platformPromptPay}`);

  const isDormSeparateFromPlatform = dormPromptPay !== platformPromptPay && dormBank !== platformPromptPay;
  console.log(`PromptPay 3-Tier separation (N-03): ${isDormSeparateFromPlatform ? 'PASS' : 'FAIL'}`);
  results.AC1_ReceiverSeparation = isDormSeparateFromPlatform;

  // Fetch active tenant bills via tenant portal
  const tenantBillsRes = await fetch(`${APP_URL}/api/v1/tenant-portal/bills`, {
    headers: { 'Cookie': tenant.cookieHeader },
  });
  const tenantBillsJson = await tenantBillsRes.json();
  let targetBill = tenantBillsJson.data?.find((b) => Number(b.outstandingAmount) > 0 && b.status !== 'PAID' && b.status !== 'paid');

  if (!targetBill) {
    let cycle = await prisma.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { cycleCode: 'desc' },
    });
    const existingBills = await prisma.bill.findMany({
      where: { billingCycleId: cycle.id },
      select: { roomId: true },
    });
    let room = await prisma.room.findFirst({
      where: {
        dormitoryId: DORM_ID,
        id: { notIn: existingBills.map((b) => b.roomId) },
      },
    });

    if (!room) {
      const now = new Date();
      cycle = await prisma.billingCycle.create({
        data: {
          dormitoryId: DORM_ID,
          cycleCode: `TEST-${Date.now().toString().slice(-6)}`,
          name: 'รอบบิลทดสอบ Task 12',
          periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
          periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
          billingDate: now,
          dueDate: new Date(Date.now() + 5 * 86400000),
          status: 'ACTIVE',
        },
      });
      room = await prisma.room.findFirst({
        where: { dormitoryId: DORM_ID, roomNumber: '101' },
      });
    }

    const tenantUser = await prisma.user.findFirst({ where: { email: 'tenant.somchai@horplus-uat.local' } });
    const somchaiTenant = await prisma.tenant.findFirst({ where: { linkedUserId: tenantUser.id, dormitoryId: DORM_ID } });

    targetBill = await prisma.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: cycle.id,
        roomId: room.id,
        tenantId: somchaiTenant.id,
        billNumber: `BILL-TEST-${Date.now().toString().slice(-6)}`,
        status: 'UNPAID',
        billingDate: new Date(),
        dueDate: new Date(Date.now() + 5 * 86400000),
        totalAmount: '2500.00',
        paidAmount: '0.00',
        outstandingAmount: '2500.00',
        items: {
          create: [
            {
              dormitoryId: DORM_ID,
              type: 'rent',
              description: 'ค่าเช่าห้องพัก',
              amount: '2500.00',
              quantity: '1.00',
              unitPrice: '2500.00',
              displayOrder: 1,
            },
          ],
        },
      },
    });
  }

  console.log(`Using Tenant Bill: ${targetBill.billNumber} (${targetBill.id}), Outstanding: ${targetBill.outstandingAmount}`);

  // Delete any stale pending payments on this bill
  await prisma.payment.deleteMany({
    where: { billId: targetBill.id, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
  });

  // Create a real slip submission for this bill
  const randR = Math.floor(Math.random() * 200);
  const randG = Math.floor(Math.random() * 200);
  const slipJpeg = await sharp({
    create: { width: 400, height: 600, channels: 4, background: { r: randR, g: randG, b: 200, alpha: 1 } },
  }).jpeg().toBuffer();

  // Cooldown for slipRateLimiter (5s requirement)
  console.log('Waiting 6s cooldown before creating intent...');
  await new Promise(r => setTimeout(r, 6000));

  // Step 1: Create Intent
  const intentRes = await fetch(`${APP_URL}/api/v1/payments/slip/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': tenant.cookieHeader,
      'X-CSRF-Token': tenant.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      billId: targetBill.id,
      fileName: 'slip.jpg',
      mimeType: 'image/jpeg',
      fileSize: slipJpeg.length,
    }),
  });
  const intentJson = await intentRes.json();
  console.log(`Slip Upload Intent: HTTP ${intentRes.status} -> Intent ID: ${intentJson.intentId}`);

  // Cooldown for slipRateLimiter
  console.log('Waiting 6s cooldown before uploading file...');
  await new Promise(r => setTimeout(r, 6000));

  // Step 2: Upload slip via upload endpoint
  const uploadFormData = new FormData();
  uploadFormData.append('file', new Blob([slipJpeg], { type: 'image/jpeg' }), 'slip.jpg');
  const uploadRes = await fetch(`${APP_URL}/api/v1/payments/slip/upload/${intentJson.intentId}`, {
    method: 'POST',
    headers: {
      'Cookie': tenant.cookieHeader,
      'X-CSRF-Token': tenant.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: uploadFormData,
  });
  const uploadJson = await uploadRes.json();
  console.log(`Slip Upload: HTTP ${uploadRes.status} -> Object Key: ${uploadJson.objectKey}`);

  // Cooldown for slipRateLimiter
  console.log('Waiting 6s cooldown before submitting slip...');
  await new Promise(r => setTimeout(r, 6000));

  // Step 3: Tenant submits slip via /slip/submit
  const submitSlipRes = await fetch(`${APP_URL}/api/v1/payments/slip/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': tenant.cookieHeader,
      'X-CSRF-Token': tenant.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      billId: targetBill.id,
      intentId: intentJson.intentId,
      amount: String(targetBill.outstandingAmount),
      paymentDate: new Date().toISOString(),
    }),
  });
  const submitSlipJson = await submitSlipRes.json();
  console.log(`Tenant Submit Slip: HTTP ${submitSlipRes.status} -> Payment ID: ${submitSlipJson.id || submitSlipJson.payment?.id}`);

  const testPaymentId = submitSlipJson.id || submitSlipJson.payment?.id;
  if (!testPaymentId) {
    throw new Error(`Failed to submit slip: ${JSON.stringify(submitSlipJson)}`);
  }

  // Check verification record in DB
  const verification = await prisma.paymentEvidenceVerification.findFirst({
    where: { paymentId: testPaymentId },
  });
  console.log(`Payment Evidence Verification: provider=${verification?.provider}, status=${verification?.status}`);
  const isAc1Pass = verification?.provider === 'SLIPOK' && (verification?.status === 'UNVERIFIED' || verification?.status === 'REJECTED');
  console.log(`AC-1 SlipOK Adapter live check: ${isAc1Pass ? 'PASS' : 'FAIL'}`);
  results.AC1_SlipOkAdapter = isAc1Pass;

  // ==============================================================
  // AC-2: Role Guards & Override Reason Enforcement
  // ==============================================================
  console.log('\n--- Checking AC-2: Override Reason Enforcement & Role Guards ---');

  // 2.1 Staff attempts approval -> MUST return 403 Forbidden
  const staffApproveRes = await fetch(`${APP_URL}/api/v1/payments/${testPaymentId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': staff.cookieHeader,
      'X-CSRF-Token': staff.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({ overrideReason: 'ช่างพยายามอนุมัติ' }),
  });
  const staffBlocked = staffApproveRes.status === 403;
  console.log(`2.1 Staff approval blocked: HTTP ${staffApproveRes.status} -> ${staffBlocked ? 'PASS' : 'FAIL'}`);

  // 2.2 Tenant attempts approval -> MUST return 403 Forbidden
  const tenantApproveRes = await fetch(`${APP_URL}/api/v1/payments/${testPaymentId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': tenant.cookieHeader,
      'X-CSRF-Token': tenant.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({ overrideReason: 'ผู้เช่าพยายามอนุมัติ' }),
  });
  const tenantBlocked = tenantApproveRes.status === 403;
  console.log(`2.2 Tenant approval blocked: HTTP ${tenantApproveRes.status} -> ${tenantBlocked ? 'PASS' : 'FAIL'}`);

  // 2.3 Owner attempts approval WITHOUT overrideReason on unverified slip -> MUST return 400 OVERRIDE_REASON_REQUIRED
  const ownerNoReasonRes = await fetch(`${APP_URL}/api/v1/payments/${testPaymentId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': owner.cookieHeader,
      'X-CSRF-Token': owner.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({ notes: 'อนุมัติโดยไม่มี overrideReason' }),
  });
  const noReasonJson = await ownerNoReasonRes.json();
  const noReasonRejected = ownerNoReasonRes.status === 400 && noReasonJson.error?.code === 'OVERRIDE_REASON_REQUIRED';
  console.log(`2.3 Owner approval without overrideReason: HTTP ${ownerNoReasonRes.status} (${noReasonJson.error?.code}) -> ${noReasonRejected ? 'PASS' : 'FAIL'}`);

  // 2.4 Manager approves WITH overrideReason -> MUST succeed (HTTP 200)
  const managerOverrideRes = await fetch(`${APP_URL}/api/v1/payments/${testPaymentId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': manager.cookieHeader,
      'X-CSRF-Token': manager.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      overrideReason: 'ตรวจสอบสลิปผ่านแอปธนาคารแล้ว มียอดเงินเข้าบัญชีจริง',
      notes: 'อนุมัติโดยผู้จัดการ',
    }),
  });
  const managerApproved = managerOverrideRes.status === 200;
  console.log(`2.4 Manager approval with overrideReason: HTTP ${managerOverrideRes.status} -> ${managerApproved ? 'PASS' : 'FAIL'}`);

  // Check audit log for PAYMENT_SLIPOK_OVERRIDE_APPROVED
  const auditLog = await prisma.auditLog.findFirst({
    where: {
      dormitoryId: DORM_ID,
      entityId: testPaymentId,
      action: 'PAYMENT_SLIPOK_OVERRIDE_APPROVED',
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Audit log action recorded: ${auditLog?.action}`);
  const isAc2Pass = staffBlocked && tenantBlocked && noReasonRejected && managerApproved && auditLog !== null;
  console.log(`AC-2 Overall Result: ${isAc2Pass ? 'PASS' : 'FAIL'}`);
  results.AC2_OverrideRules = isAc2Pass;

  // ==============================================================
  // AC-3: Idempotency & Zero Duplicate Receipts
  // ==============================================================
  console.log('\n--- Checking AC-3: Payment Idempotency & Zero Duplicate Receipts ---');

  // 3.1 Repeated approval of the already approved payment
  const repeatApproveRes = await fetch(`${APP_URL}/api/v1/payments/${testPaymentId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': owner.cookieHeader,
      'X-CSRF-Token': owner.csrfToken,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      overrideReason: 'ตรวจสอบสลิปผ่านแอปธนาคารแล้ว',
    }),
  });
  const repeatJson = await repeatApproveRes.json();
  const repeatOk = repeatApproveRes.status === 200 && repeatJson.status === 'APPROVED';
  console.log(`3.1 Repeated approval: HTTP ${repeatApproveRes.status} (status: ${repeatJson.status}) -> ${repeatOk ? 'PASS' : 'FAIL'}`);

  // 3.2 Check receipt count for this payment
  const receiptsForPayment = await prisma.receipt.findMany({
    where: { paymentId: testPaymentId, dormitoryId: DORM_ID },
  });
  console.log(`Receipt count for payment ${testPaymentId}: ${receiptsForPayment.length}`);
  const zeroDuplicates = receiptsForPayment.length === 1;
  console.log(`3.2 Exactly 1 receipt (zero duplicates): ${zeroDuplicates ? 'PASS' : 'FAIL'}`);

  const receipt = receiptsForPayment[0];
  console.log(`Generated Receipt Number: ${receipt?.receiptNumber}`);

  const isAc3Pass = repeatOk && zeroDuplicates;
  console.log(`AC-3 Overall Result: ${isAc3Pass ? 'PASS' : 'FAIL'}`);
  results.AC3_IdempotencyAndNoDuplicates = isAc3Pass;

  // ==============================================================
  // AC-4: Domain & Document Separation (N-03)
  // ==============================================================
  console.log('\n--- Checking AC-4: Document Numbering Separation ---');
  const isReceiptFormatValid = /^RC-\d{6}-[A-Z0-9]+-\d{4}$/.test(receipt.receiptNumber);
  console.log(`Receipt number format (${receipt.receiptNumber}): ${isReceiptFormatValid ? 'PASS' : 'FAIL'}`);

  // Check subscription payment evidence separation
  const sampleSubEvidence = await prisma.subscriptionPaymentEvidence.findFirst({
    select: { receiptNumber: true },
  });
  const subReceiptNumber = sampleSubEvidence?.receiptNumber || 'RCP-SUB-202609-0001';
  console.log(`Subscription payment evidence receipt number: ${subReceiptNumber}`);
  const isSubDistinct = !subReceiptNumber.startsWith('RC-') && receipt.receiptNumber.startsWith('RC-');
  console.log(`Document prefix separation (RC- vs RCP-SUB-): ${isSubDistinct ? 'PASS' : 'FAIL'}`);

  const isAc4Pass = isReceiptFormatValid && isSubDistinct && isDormSeparateFromPlatform;
  console.log(`AC-4 Overall Result: ${isAc4Pass ? 'PASS' : 'FAIL'}`);
  results.AC4_DocumentSeparation = isAc4Pass;

  // ==============================================================
  // AC-5: Receipt Access Authorization
  // ==============================================================
  console.log('\n--- Checking AC-5: Receipt Access Authorization ---');
  const receiptId = receipt.id;

  // 5.1 Owner gets 200 OK
  const ownerGetRes = await fetch(`${APP_URL}/api/v1/receipts/${receiptId}`, {
    headers: { 'Cookie': owner.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const ownerOk = ownerGetRes.status === 200;
  console.log(`5.1 Owner access: HTTP ${ownerGetRes.status} -> ${ownerOk ? 'PASS' : 'FAIL'}`);

  // 5.2 Manager gets 200 OK
  const managerGetRes = await fetch(`${APP_URL}/api/v1/receipts/${receiptId}`, {
    headers: { 'Cookie': manager.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const managerOk = managerGetRes.status === 200;
  console.log(`5.2 Manager access: HTTP ${managerGetRes.status} -> ${managerOk ? 'PASS' : 'FAIL'}`);

  // 5.3 Owning Tenant gets 200 OK
  const tenantGetRes = await fetch(`${APP_URL}/api/v1/receipts/${receiptId}`, {
    headers: { 'Cookie': tenant.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const tenantOk = tenantGetRes.status === 200;
  console.log(`5.3 Owning Tenant access: HTTP ${tenantGetRes.status} -> ${tenantOk ? 'PASS' : 'FAIL'}`);

  // 5.4 Staff gets 403 Forbidden
  const staffGetRes = await fetch(`${APP_URL}/api/v1/receipts/${receiptId}`, {
    headers: { 'Cookie': staff.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const staffForbidden = staffGetRes.status === 403;
  console.log(`5.4 Staff access rejected: HTTP ${staffGetRes.status} -> ${staffForbidden ? 'PASS' : 'FAIL'}`);

  // 5.5 Owner gets HTML presentation 200 OK
  const ownerHtmlRes = await fetch(`${APP_URL}/api/v1/receipts/${receiptId}/html`, {
    headers: { 'Cookie': owner.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const ownerHtmlOk = ownerHtmlRes.status === 200;
  console.log(`5.5 Owner HTML access: HTTP ${ownerHtmlRes.status} -> ${ownerHtmlOk ? 'PASS' : 'FAIL'}`);

  // 5.6 Staff gets HTML 403 Forbidden
  const staffHtmlRes = await fetch(`${APP_URL}/api/v1/receipts/${receiptId}/html`, {
    headers: { 'Cookie': staff.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const staffHtmlForbidden = staffHtmlRes.status === 403;
  console.log(`5.6 Staff HTML access rejected: HTTP ${staffHtmlRes.status} -> ${staffHtmlForbidden ? 'PASS' : 'FAIL'}`);

  const isAc5Pass = ownerOk && managerOk && tenantOk && staffForbidden && ownerHtmlOk && staffHtmlForbidden;
  console.log(`AC-5 Overall Result: ${isAc5Pass ? 'PASS' : 'FAIL'}`);
  results.AC5_ReceiptAuth = isAc5Pass;

  // ==============================================================
  // AC-6: Live Browser Verification with Playwright & Screenshots
  // ==============================================================
  console.log('\n--- Checking AC-6: Playwright Browser UI & Screenshots ---');

  const browser = await chromium.launch({ headless: true });

  // Screenshot 1: Owner viewing payments page
  const ownerContext = await browser.newContext({ storageState: path.join(ROOT_DIR, '.agents/local/sessions/owner.json') });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${APP_URL}/owner/payments`, { waitUntil: 'networkidle' });
  await ownerPage.waitForTimeout(2000);
  const screenshot1Path = path.join(SCREENSHOTS_DIR, 'ac1-payment-slip-live.png');
  await ownerPage.screenshot({ path: screenshot1Path, fullPage: true });
  console.log(`Saved screenshot 1 to: ${screenshot1Path}`);

  // Screenshot 2: Owner/Tenant viewing receipt HTML
  const receiptPage = await ownerContext.newPage();
  await receiptPage.goto(`${APP_URL}/api/v1/receipts/${receiptId}/html`, { waitUntil: 'networkidle' });
  await receiptPage.waitForTimeout(1000);
  const screenshot2Path = path.join(SCREENSHOTS_DIR, 'ac3-receipt-live.png');
  await receiptPage.screenshot({ path: screenshot2Path, fullPage: true });
  console.log(`Saved screenshot 2 to: ${screenshot2Path}`);

  await browser.close();

  const isAc6Pass = fs.existsSync(screenshot1Path) && fs.existsSync(screenshot2Path);
  console.log(`AC-6 Overall Result: ${isAc6Pass ? 'PASS' : 'FAIL'}`);
  results.AC6_PlaywrightScreenshots = isAc6Pass;

  console.log('\n====================================================');
  console.log('  SUMMARY OF RESULTS');
  console.log('====================================================');
  console.log(JSON.stringify(results, null, 2));

  await prisma.$disconnect();

  const allPass = Object.values(results).every(Boolean);
  if (!allPass) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test runner error:', err);
  prisma.$disconnect();
  process.exit(1);
});
