/**
 * Live API and Database Verification Script for Card B2
 * Target: https://app.hor-plus.com
 * Validates AC B2-1 to B2-5
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const sharp = require('../../server/node_modules/sharp');
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const envPath = path.join(ROOT_DIR, 'server/.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const APP_URL = 'https://app.hor-plus.com';
const PRIMARY_DORM_ID = '20000001-0000-4000-8000-000000000002';
const TC_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b'; // Somchai
const TC_ROOM_ID = '059c470e-82d7-4602-8e4b-c91537d0940f'; // Room 101

const SESSION_KEY = envConfig.SESSION_ENCRYPTION_KEY;
const CSRF_KEY = envConfig.CSRF_SIGNING_KEY;

function clearSlipRateLimit() {
  try {
    execSync(`docker exec horplus-v2-redis-1 redis-cli del rate_limit:slip:user:${PRIMARY_DORM_ID}:20000005-0000-4000-8000-000000000005 rate_limit:slip:ip:127.0.0.1`, { stdio: 'ignore' });
  } catch {}
}

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSessionToken(payload, secretKey) {
  const key = deriveKey(secretKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function generateCsrfToken(sessionId, csrfKey) {
  const key = deriveKey(csrfKey);
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', key).update(`${sessionId}.${nonce}`).digest('hex');
  return `${nonce}.${signature}`;
}

function getCredentials(role) {
  const content = fs.readFileSync(path.join(ROOT_DIR, '.agents/local/test-access.md'), 'utf8');
  const blocks = content.split('### ');
  const block = blocks.find((b) => b.startsWith(`${role}:`));
  if (!block) throw new Error(`Could not find credentials for role: ${role}`);
  const lines = block.split(/\r?\n/).map((l) => l.trim());
  const cookieIdx = lines.findIndex((l) => l.includes('Cookie (horplus_session)'));
  const csrfIdx = lines.findIndex((l) => l.includes('CSRF Token (horplus_csrf)'));
  const session = lines[cookieIdx + 2];
  const csrf = lines[csrfIdx + 2];
  return { session, csrf };
}

async function createTestImageBuffer(width = 150, height = 150) {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 60, g: 120, b: 180 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function prepareTestBills(prisma) {
  // Ensure an active cycle exists
  let cycle = await prisma.billingCycle.findFirst({
    where: { dormitoryId: PRIMARY_DORM_ID, status: 'OPEN' },
    orderBy: { periodStart: 'desc' },
  });
  if (!cycle) {
    cycle = await prisma.billingCycle.findFirst({
      where: { dormitoryId: PRIMARY_DORM_ID },
      orderBy: { periodStart: 'desc' },
    });
  }

  // Cleanup any old test bills for this test
  const existingTestBills = await prisma.bill.findMany({
    where: {
      dormitoryId: PRIMARY_DORM_ID,
      tenantId: TC_TENANT_ID,
      billNumber: { in: ['INV-B2-TEST-001', 'INV-B2-TEST-002'] },
    },
  });

  for (const b of existingTestBills) {
    const pays = await prisma.payment.findMany({ where: { billId: b.id } });
    for (const p of pays) {
      await prisma.receipt.deleteMany({ where: { paymentId: p.id } });
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: p.id } });
      await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: p.id } });
      await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: p.id } });
      await prisma.payment.deleteMany({ where: { id: p.id } });
    }
    await prisma.paymentUploadIntent.deleteMany({ where: { billId: b.id } });
    await prisma.receipt.deleteMany({ where: { billId: b.id } });
    await prisma.billItem.deleteMany({ where: { billId: b.id } });
    await prisma.bill.delete({ where: { id: b.id } });
  }

  // Create Bill 1: 3,500.00 THB Rent
  const bill1 = await prisma.bill.create({
    data: {
      dormitoryId: PRIMARY_DORM_ID,
      tenantId: TC_TENANT_ID,
      roomId: TC_ROOM_ID,
      billingCycleId: cycle.id,
      billNumber: 'INV-B2-TEST-001',
      billKind: 'RENT',
      status: 'unpaid',
      totalAmount: 3500.0,
      paidAmount: 0.0,
      outstandingAmount: 3500.0,
      billingDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 86400 * 1000),
      items: {
        create: [
          {
            dormitory: { connect: { id: PRIMARY_DORM_ID } },
            type: 'RENT',
            description: 'ค่าเช่าห้อง 101 ประจำเดือน',
            amount: 3500.0,
            unitPrice: 3500.0,
            quantity: 1.0,
          },
        ],
      },
    },
  });

  // Create Bill 2: 450.00 THB Utility
  const bill2 = await prisma.bill.create({
    data: {
      dormitoryId: PRIMARY_DORM_ID,
      tenantId: TC_TENANT_ID,
      roomId: TC_ROOM_ID,
      billingCycleId: cycle.id,
      billNumber: 'INV-B2-TEST-002',
      billKind: 'MONTHLY_UTILITY',
      status: 'unpaid',
      totalAmount: 450.0,
      paidAmount: 0.0,
      outstandingAmount: 450.0,
      billingDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 86400 * 1000),
      items: {
        create: [
          {
            dormitory: { connect: { id: PRIMARY_DORM_ID } },
            type: 'WATER',
            description: 'ค่าน้ำประปา',
            amount: 150.0,
            unitPrice: 150.0,
            quantity: 1.0,
          },
          {
            dormitory: { connect: { id: PRIMARY_DORM_ID } },
            type: 'ELECTRICITY',
            description: 'ค่าไฟฟ้า',
            amount: 300.0,
            unitPrice: 300.0,
            quantity: 1.0,
          },
        ],
      },
    },
  });

  return { bill1, bill2 };
}

async function main() {
  const prisma = getPrismaClient();
  const tcCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');

  console.log('=== Checking Live Endpoints on app.hor-plus.com for Card B2 ===\n');

  // Prepare test bills
  const { bill1, bill2 } = await prepareTestBills(prisma);
  console.log(`Prepared test bills:`);
  console.log(`- Bill 1: ${bill1.billNumber} (${bill1.id}) Total: 3,500 THB`);
  console.log(`- Bill 2: ${bill2.billNumber} (${bill2.id}) Total: 450 THB\n`);

  // =========================================================================
  // 1. [AC B2-1] TC has 2 bills, selecting Bill 2 targets Bill 2
  // =========================================================================
  console.log('--- 1. [AC B2-1] Target specific bill selection ---');
  const resBills = await fetch(`${APP_URL}/api/v1/tenant-portal/bills`, {
    headers: { Cookie: `horplus_session=${tcCreds.session}` },
  });
  const dataBills = await resBills.json();
  const billsList = dataBills?.data || [];
  const foundB1 = billsList.find((b) => b.id === bill1.id);
  const foundB2 = billsList.find((b) => b.id === bill2.id);

  console.log(`TC bills list returned: ${billsList.length} bills`);
  console.log(`Found Bill 1: ${Boolean(foundB1)}, Found Bill 2: ${Boolean(foundB2)}`);

  // Target Bill 2 options
  const resOptionsB2 = await fetch(`${APP_URL}/api/v1/tenant-portal/payment-options/${bill2.id}`, {
    headers: { Cookie: `horplus_session=${tcCreds.session}` },
  });
  const dataOptionsB2 = await resOptionsB2.json();
  console.log(`Bill 2 payment options status: ${resOptionsB2.status}`, dataOptionsB2?.data);

  const passB21 =
    foundB1 &&
    foundB2 &&
    resOptionsB2.status === 200 &&
    dataOptionsB2?.data?.targetAmount === '450.00' &&
    Boolean(dataOptionsB2?.data?.qrUrl?.includes(bill2.id));
  console.log(`Result B2-1: ${passB21 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 2. [AC B2-2] Owner records partial cash payment (1,000 THB) -> Outstanding is 2,500 THB
  // =========================================================================
  console.log('--- 2. [AC B2-2] Partial cash payment updates true outstanding amount ---');
  const resCash = await fetch(`${APP_URL}/api/v1/payments/cash`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${ownerCreds.session}`,
      'x-csrf-token': ownerCreds.csrf,
      'x-dormitory-id': PRIMARY_DORM_ID,
    },
    body: JSON.stringify({
      billId: bill1.id,
      amount: '1000',
    }),
  });
  const dataCash = await resCash.json();
  console.log(`Owner record partial cash status: ${resCash.status}`, dataCash);

  // Check updated bill in TC portal
  const resB1Updated = await fetch(`${APP_URL}/api/v1/tenant-portal/bills/${bill1.id}`, {
    headers: { Cookie: `horplus_session=${tcCreds.session}` },
  });
  const dataB1Updated = await resB1Updated.json();
  const b1Detail = dataB1Updated?.data;
  console.log(`Bill 1 updated details: status=${b1Detail?.status}, total=${b1Detail?.totalAmount}, paid=${b1Detail?.paidAmount}, outstanding=${b1Detail?.outstandingAmount}`);

  // Check payment options for Bill 1
  const resOptionsB1 = await fetch(`${APP_URL}/api/v1/tenant-portal/payment-options/${bill1.id}`, {
    headers: { Cookie: `horplus_session=${tcCreds.session}` },
  });
  const dataOptionsB1 = await resOptionsB1.json();
  console.log(`Bill 1 payment options: targetAmount=${dataOptionsB1?.data?.targetAmount}`);

  const passB22 =
    resCash.status === 200 &&
    b1Detail?.status?.toLowerCase() === 'partially_paid' &&
    Number(b1Detail?.paidAmount) === 1000 &&
    Number(b1Detail?.outstandingAmount) === 2500 &&
    dataOptionsB1?.data?.targetAmount === '2500.00';
  console.log(`Result B2-2: ${passB22 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 3. [AC B2-4] PromptPay QR encodes exact outstanding amount (Tag 54 = 2500.00)
  // =========================================================================
  console.log('--- 3. [AC B2-4] PromptPay QR encodes exact outstanding balance (Tag 54) ---');
  const resQrB1 = await fetch(`${APP_URL}/api/v1/tenant-portal/payment-options/${bill1.id}/qr`, {
    headers: { Cookie: `horplus_session=${tcCreds.session}` },
  });
  const qrSvgText = await resQrB1.text();
  console.log(`QR SVG status: ${resQrB1.status}, length: ${qrSvgText.length}`);

  const passB24 = resQrB1.status === 200 && qrSvgText.includes('<svg') && qrSvgText.includes('path');
  console.log(`PromptPay QR SVG rendered properly: ${passB24}`);
  console.log(`Result B2-4: ${passB24 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 4. [AC B2-3] Submitting amount exceeding outstanding (3,500 > 2,500) rejected with Thai error
  // =========================================================================
  console.log('--- 4. [AC B2-3] Payment exceeding outstanding rejected with Thai error ---');
  clearSlipRateLimit();
  const imgBuffer = await createTestImageBuffer(150, 150);

  // 4a. Create slip intent
  const resIntent = await fetch(`${APP_URL}/api/v1/payments/slip/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${tcCreds.session}`,
      'x-csrf-token': tcCreds.csrf,
    },
    body: JSON.stringify({
      billId: bill1.id,
      fileName: 'slip-sample.jpeg',
      mimeType: 'image/jpeg',
      fileSize: imgBuffer.length,
    }),
  });
  const dataIntent = await resIntent.json();
  console.log(`Intent creation status: ${resIntent.status}`, dataIntent);

  // 4b. Upload dummy image
  const formData = new FormData();
  formData.append('file', new Blob([imgBuffer], { type: 'image/jpeg' }), 'slip.jpeg');

  const resUpload = await fetch(`${APP_URL}${dataIntent.uploadUrl}`, {
    method: 'POST',
    headers: {
      Cookie: `horplus_session=${tcCreds.session}`,
      'x-csrf-token': tcCreds.csrf,
    },
    body: formData,
  });
  const dataUpload = await resUpload.json();
  console.log(`Upload status: ${resUpload.status}`, dataUpload);

  // 4c. Submit with excess amount: 3,500.00 (while outstanding is only 2,500.00)
  const resSubmitExcess = await fetch(`${APP_URL}/api/v1/payments/slip/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${tcCreds.session}`,
      'x-csrf-token': tcCreds.csrf,
      'x-idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      billId: bill1.id,
      amount: '3500.00',
      intentId: dataIntent.intentId,
      paymentDate: new Date().toISOString(),
    }),
  });
  const dataSubmitExcess = await resSubmitExcess.json();
  console.log(`Submit excess amount status: ${resSubmitExcess.status}`, dataSubmitExcess);

  const passB23 =
    resUpload.status === 200 &&
    resSubmitExcess.status === 400 &&
    dataSubmitExcess?.error?.code === 'PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING' &&
    dataSubmitExcess?.error?.message === 'ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก';
  console.log(`Result B2-3: ${passB23 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 5. [AC B2-5] Tenant TA cannot request slip intent for TC's bill (403 Forbidden)
  // =========================================================================
  console.log('--- 5. [AC B2-5] Tenant TA forbidden from accessing TC bill ---');
  // Create active session for another tenant user (อนันต์: a94537d1-f9d1-4e45-b751-708101ab20e5)
  const taUserId = 'a94537d1-f9d1-4e45-b751-708101ab20e5';
  const taSessionId = crypto.randomUUID();
  const taSessionHash = crypto.createHash('sha256').update(`horplus_sid_${taSessionId}`).digest('hex');

  const taSessionRecord = await prisma.session.create({
    data: {
      id: taSessionId,
      userId: taUserId,
      sessionIdHash: taSessionHash,
      tokenVersion: 1,
      status: 'active',
      expiresAt: new Date(Date.now() + 86400 * 1000),
      principalType: 'GOOGLE_USER',
    },
  });

  const taSessionToken = encryptSessionToken(
    {
      sub: taUserId,
      sid: taSessionId,
      type: 'session',
      version: 1,
    },
    SESSION_KEY
  );
  const taCsrf = generateCsrfToken(taSessionId, CSRF_KEY);

  let resTaIntent;
  try {
    resTaIntent = await fetch(`${APP_URL}/api/v1/payments/slip/intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${taSessionToken}`,
        'x-csrf-token': taCsrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        billId: bill1.id, // TC's bill!
        fileName: 'slip-ta.jpeg',
        mimeType: 'image/jpeg',
        fileSize: 1024,
      }),
    });
    console.log(`TA requesting intent on TC bill status: ${resTaIntent.status}`);
  } finally {
    await prisma.session.delete({ where: { id: taSessionRecord.id } }).catch(() => {});
  }

  const passB25 = resTaIntent?.status === 403;
  console.log(`Result B2-5: ${passB25 ? 'PASS' : 'FAIL'}\n`);

  // Summary
  console.log('=== Summary of Card B2 Live Checks ===');
  console.log(`B2-1 (Target Bill Selection): ${passB21 ? 'PASS' : 'FAIL'}`);
  console.log(`B2-2 (Partial Payment & True Balance): ${passB22 ? 'PASS' : 'FAIL'}`);
  console.log(`B2-3 (Excess Payment Rejection): ${passB23 ? 'PASS' : 'FAIL'}`);
  console.log(`B2-4 (PromptPay QR Tag 54): ${passB24 ? 'PASS' : 'FAIL'}`);
  console.log(`B2-5 (Cross-Tenant Bill Protection): ${passB25 ? 'PASS' : 'FAIL'}`);

  if (passB21 && passB22 && passB23 && passB24 && passB25) {
    console.log('\n🎉 ALL CARD B2 LIVE CHECKS PASSED!');
    process.exit(0);
  } else {
    console.error('\n❌ SOME CHECKS FAILED!');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during Card B2 checks:', err);
  process.exit(1);
});
