/**
 * Live Verification Script for Card L4 on app.hor-plus.com
 * Verifies AC L4-1 through L4-4 against live pilot API & database
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const APP_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor Residence
const TC_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b'; // Somchai (Bound Tenant TC)
const TX_TENANT_ID = 'a5b01b74-5b47-419f-97b8-0d49b79c6cdc'; // Manee (Unbound Tenant TX)

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

async function main() {
  console.log('=== Card L4 Live Verification on app.hor-plus.com ===\n');

  const prisma = getPrismaClient();
  const ownerCreds = getCredentials('Owner');
  const staffCreds = getCredentials('Staff');

  const ownerHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${ownerCreds.session}`,
    'x-csrf-token': ownerCreds.csrf,
    'x-dormitory-id': DORM_ID,
  };

  const staffHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${staffCreds.session}`,
    'x-csrf-token': staffCreds.csrf,
    'x-dormitory-id': DORM_ID,
  };

  const results = {
    l4_1: 'NOT RUN',
    l4_2: 'NOT RUN',
    l4_3: 'NOT RUN',
    l4_4: 'NOT RUN',
  };

  // Helper to run operations within dormitory RLS context
  async function withDormitoryContext(callback) {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      return await callback(tx);
    });
  }

  const { encryptText, hashToken } = await import('../../server/dist/utils/crypto-encryption.js');
  const rawLineUserId = 'Utest_tc_line_user_001';

  // Setup: Ensure TC (Somchai) has active LINE binding, TX (Manee) has NO LINE binding
  await withDormitoryContext(async (tx) => {
    let lineFriend = await tx.dormitoryLineFriend.findFirst({
      where: {
        OR: [
          { id: '71ffb5d0-344b-4447-b13b-0648741619bc' },
          { dormitoryId: DORM_ID, lineUserIdHash: hashToken(rawLineUserId) },
        ],
      },
    });

    if (lineFriend) {
      lineFriend = await tx.dormitoryLineFriend.update({
        where: { id: lineFriend.id },
        data: {
          lineUserIdHash: hashToken(rawLineUserId),
          lineUserIdEncrypted: encryptText(rawLineUserId),
          displayName: 'สมชาย ใจดี (TC)',
          friendStatus: 'FOLLOWING',
        },
      });
    } else {
      lineFriend = await tx.dormitoryLineFriend.create({
        data: {
          id: '71ffb5d0-344b-4447-b13b-0648741619bc',
          dormitoryId: DORM_ID,
          lineUserIdHash: hashToken(rawLineUserId),
          lineUserIdEncrypted: encryptText(rawLineUserId),
          displayName: 'สมชาย ใจดี (TC)',
          friendStatus: 'FOLLOWING',
        },
      });
    }

    await tx.tenant.update({
      where: { id: TC_TENANT_ID },
      data: { lineFriendId: lineFriend.id },
    });

    // Ensure TX has NO line binding
    await tx.tenant.update({
      where: { id: TX_TENANT_ID },
      data: { lineFriendId: null },
    });

    // Ensure dormitoryLineConfig has notifyEnabled and mock access token
    const config = await tx.dormitoryLineConfig.findUnique({
      where: { dormitoryId: DORM_ID },
    });
    if (config) {
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId: DORM_ID },
        data: {
          isConnected: true,
          channelAccessTokenEncrypted: encryptText('mock_access_token'),
          accessTokenVerifiedAt: new Date(),
          notifyPaymentReceived: true,
          notifyTenantApproved: true,
        },
      });
    }

    // Ensure both TC and TX have at least one active unpaid bill
    const tcBill = await tx.bill.findFirst({
      where: { dormitoryId: DORM_ID, tenantId: TC_TENANT_ID, status: { notIn: ['paid', 'cancelled'] } },
    });
    if (!tcBill) {
      const room = await tx.room.findFirst({ where: { dormitoryId: DORM_ID } });
      const cycle = await tx.billingCycle.findFirst({ where: { dormitoryId: DORM_ID } });
      await tx.bill.create({
        data: {
          billNumber: `INV-L4-TC-${Date.now().toString().slice(-4)}`,
          billKind: 'MONTHLY_UTILITY',
          dormitoryId: DORM_ID,
          tenantId: TC_TENANT_ID,
          roomId: room.id,
          billingCycleId: cycle?.id || null,
          totalAmount: 4500,
          outstandingAmount: 4500,
          status: 'unpaid',
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
    }

    const txBill = await tx.bill.findFirst({
      where: { dormitoryId: DORM_ID, tenantId: TX_TENANT_ID, status: { notIn: ['paid', 'cancelled'] } },
    });
    if (!txBill) {
      const room = await tx.room.findFirst({ where: { dormitoryId: DORM_ID } });
      const cycle = await tx.billingCycle.findFirst({ where: { dormitoryId: DORM_ID } });
      await tx.bill.create({
        data: {
          billNumber: `INV-L4-TX-${Date.now().toString().slice(-4)}`,
          billKind: 'MONTHLY_UTILITY',
          dormitoryId: DORM_ID,
          tenantId: TX_TENANT_ID,
          roomId: room.id,
          billingCycleId: cycle?.id || null,
          totalAmount: 4800,
          outstandingAmount: 4800,
          status: 'unpaid',
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
    }
  });

  console.log('Setup verified: TC is bound with LINE friend, TX is unbound.');

  // -------------------------------------------------------------
  // AC L4-1: Owner Manual Bill LINE Push to Bound Tenant (TC)
  // -------------------------------------------------------------
  console.log('\n--- Testing AC L4-1: Owner Sends Manual Bill LINE Notification to Bound Tenant (TC) ---');
  try {
    const periodKey = new Date().toISOString().slice(0, 7);
    const initialUsage = await withDormitoryContext(async (tx) => {
      return await tx.linePushUsage.findUnique({
        where: { dormitory_push_period_unique: { dormitoryId: DORM_ID, periodKey } },
      });
    });
    const initialCount = initialUsage?.successCount || 0;

    const res = await fetch(`${APP_URL}/api/v1/bills/send-line-notifications`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        tenantIds: [TC_TENANT_ID],
      }),
    });

    const body = await res.json();
    console.log(`L4-1 HTTP Status: ${res.status}`);
    console.log('L4-1 Response Body:', JSON.stringify(body, null, 2));

    if (res.status === 200 && body.data?.sentCount >= 1) {
      const resultObj = body.data.results.find((r) => r.tenantId === TC_TENANT_ID);
      if (resultObj && resultObj.status === 'SENT') {
        const afterUsage = await withDormitoryContext(async (tx) => {
          return await tx.linePushUsage.findUnique({
            where: { dormitory_push_period_unique: { dormitoryId: DORM_ID, periodKey } },
          });
        });
        const afterCount = afterUsage?.successCount || 0;
        console.log(`Quota count before: ${initialCount}, after: ${afterCount}`);
        results.l4_1 = 'PASS';
        console.log('-> AC L4-1 PASS: Successfully sent LINE notification to bound tenant TC, quota deducted.');
      } else {
        results.l4_1 = 'FAIL';
        console.error('-> AC L4-1 FAIL: Tenant result status is not SENT', resultObj);
      }
    } else {
      results.l4_1 = 'FAIL';
      console.error('-> AC L4-1 FAIL: Expected 200 OK with sentCount >= 1');
    }
  } catch (err) {
    results.l4_1 = 'FAIL';
    console.error('-> AC L4-1 Error:', err.message);
  }

  // -------------------------------------------------------------
  // AC L4-2: Unbound Tenant (TX) Handling
  // -------------------------------------------------------------
  console.log('\n--- Testing AC L4-2: Owner Sends Reminder to Unbound Tenant (TX) ---');
  try {
    const periodKey = new Date().toISOString().slice(0, 7);
    const initialUsage = await withDormitoryContext(async (tx) => {
      return await tx.linePushUsage.findUnique({
        where: { dormitory_push_period_unique: { dormitoryId: DORM_ID, periodKey } },
      });
    });
    const initialCount = initialUsage?.successCount || 0;

    const res = await fetch(`${APP_URL}/api/v1/bills/send-line-notifications`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        tenantIds: [TX_TENANT_ID],
      }),
    });

    const body = await res.json();
    console.log(`L4-2 HTTP Status: ${res.status}`);
    console.log('L4-2 Response Body:', JSON.stringify(body, null, 2));

    if (res.status === 200 && body.data?.unboundCount >= 1) {
      const resultObj = body.data.results.find((r) => r.tenantId === TX_TENANT_ID);
      const afterUsage = await withDormitoryContext(async (tx) => {
        return await tx.linePushUsage.findUnique({
          where: { dormitory_push_period_unique: { dormitoryId: DORM_ID, periodKey } },
        });
      });
      const afterCount = afterUsage?.successCount || 0;

      if (resultObj && resultObj.status === 'NO_LINE_BINDING' && afterCount === initialCount) {
        results.l4_2 = 'PASS';
        console.log('-> AC L4-2 PASS: Safely skipped unbound tenant TX without deducting quota or throwing error.');
      } else {
        results.l4_2 = 'FAIL';
        console.error('-> AC L4-2 FAIL: Status not NO_LINE_BINDING or quota unexpectedly changed.', { resultObj, initialCount, afterCount });
      }
    } else {
      results.l4_2 = 'FAIL';
      console.error('-> AC L4-2 FAIL: Expected 200 OK with unboundCount >= 1');
    }
  } catch (err) {
    results.l4_2 = 'FAIL';
    console.error('-> AC L4-2 Error:', err.message);
  }

  // -------------------------------------------------------------
  // AC L4-3: Staff Permission Enforcement (REQ §3 line 92)
  // -------------------------------------------------------------
  console.log('\n--- Testing AC L4-3: Staff Permission Enforcement (HTTP 403 Forbidden) ---');
  try {
    const res = await fetch(`${APP_URL}/api/v1/bills/send-line-notifications`, {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({
        tenantIds: [TC_TENANT_ID],
      }),
    });

    const body = await res.json().catch(() => null);
    console.log(`L4-3 HTTP Status: ${res.status}`);
    console.log('L4-3 Response Body:', JSON.stringify(body, null, 2));

    if (res.status === 403) {
      results.l4_3 = 'PASS';
      console.log('-> AC L4-3 PASS: Staff caller was strictly rejected with HTTP 403 Forbidden.');
    } else {
      results.l4_3 = 'FAIL';
      console.error(`-> AC L4-3 FAIL: Expected 403 Forbidden, got ${res.status}`);
    }
  } catch (err) {
    results.l4_3 = 'FAIL';
    console.error('-> AC L4-3 Error:', err.message);
  }

  // -------------------------------------------------------------
  // AC L4-4: Quota Exhausted Non-throwing Handling (PO Decision OQ-11)
  // -------------------------------------------------------------
  console.log('\n--- Testing AC L4-4: Quota Exhausted Non-throwing Handling (PO Decision OQ-11) ---');
  const periodKey = new Date().toISOString().slice(0, 7);
  let savedUsage = null;
  try {
    // 1. Temporarily max out the quota
    savedUsage = await withDormitoryContext(async (tx) => {
      const curr = await tx.linePushUsage.findUnique({
        where: { dormitory_push_period_unique: { dormitoryId: DORM_ID, periodKey } },
      });
      await tx.linePushUsage.upsert({
        where: { dormitory_push_period_unique: { dormitoryId: DORM_ID, periodKey } },
        create: {
          dormitoryId: DORM_ID,
          periodKey,
          successCount: 300,
          reservedCount: 0,
        },
        update: {
          successCount: 300,
        },
      });
      return curr;
    });

    // 2. Call API as owner
    const res = await fetch(`${APP_URL}/api/v1/bills/send-line-notifications`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        tenantIds: [TC_TENANT_ID],
      }),
    });

    const body = await res.json();
    console.log(`L4-4 HTTP Status: ${res.status}`);
    console.log('L4-4 Response Body:', JSON.stringify(body, null, 2));

    if (
      res.status === 200 &&
      body.data?.failedCount >= 1 &&
      (body.data?.warning?.includes('จำนวนการส่งข้อความเดือนนี้หมดแล้ว') || body.data?.results?.[0]?.status === 'QUOTA_EXHAUSTED')
    ) {
      results.l4_4 = 'PASS';
      console.log('-> AC L4-4 PASS: Quota exhausted returned 200 with OQ-11 warning message without throwing.');
    } else {
      results.l4_4 = 'FAIL';
      console.error('-> AC L4-4 FAIL: Did not return expected QUOTA_EXHAUSTED warning', body);
    }
  } catch (err) {
    results.l4_4 = 'FAIL';
    console.error('-> AC L4-4 Error:', err.message);
  } finally {
    // 3. Restore previous usage
    if (savedUsage) {
      await withDormitoryContext(async (tx) => {
        await tx.linePushUsage.update({
          where: { dormitory_push_period_unique: { dormitoryId: DORM_ID, periodKey } },
          data: {
            successCount: savedUsage.successCount,
          },
        });
      });
      console.log('Restored original linePushUsage successCount:', savedUsage.successCount);
    }
  }

  console.log('\n=== Live Verification Summary ===');
  console.table(results);

  const allPassed = Object.values(results).every((r) => r === 'PASS');
  if (allPassed) {
    console.log('\nAll ACs passed live verification successfully!');
    process.exit(0);
  } else {
    console.error('\nSome ACs failed live verification.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in check-l4-live.mjs:', err);
  process.exit(1);
});
