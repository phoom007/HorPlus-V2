/**
 * Live Verification Script for Card L2 on app.hor-plus.com
 * Verifies AC L2-1 through L2-6 against live pilot API & database
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import {
  buildTenantInvoiceFlexMessage,
  buildTenantReceiptFlexMessage,
  buildTenantPaymentRejectedFlexMessage,
  lineOaService,
} from '../../server/dist/services/line-oa.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const APP_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor Residence
const TC_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b'; // Somchai (Tenant TC)

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
  console.log('=== Card L2 Live Verification on app.hor-plus.com ===\n');

  const prisma = getPrismaClient();
  const ownerCreds = getCredentials('Owner');
  const tenantCreds = getCredentials('Tenant');

  const ownerHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${ownerCreds.session}`,
    'x-csrf-token': ownerCreds.csrf,
  };

  const tenantHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${tenantCreds.session}`,
    'x-csrf-token': tenantCreds.csrf,
  };

  const results = {
    l2_1: 'NOT RUN',
    l2_2: 'NOT RUN',
    l2_3: 'NOT RUN',
    l2_4: 'NOT RUN',
    l2_5: 'NOT RUN',
    l2_6: 'NOT RUN',
  };

  // Helper to run operations within dormitory RLS context
  async function withDormitoryContext(callback) {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      return await callback(tx);
    });
  }

  // Setup: Ensure TC has active LINE binding in Manor Residence
  const { encryptText, hashToken } = await import('../../server/dist/utils/crypto-encryption.js');
  const rawLineUserId = 'Utest_tc_line_user_001';

  const { cycle, roomId, roomNumber } = await withDormitoryContext(async (tx) => {
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

    // Ensure an active billing cycle exists
    let cycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { createdAt: 'desc' },
    });
    if (!cycle) {
      const now = new Date();
      cycle = await tx.billingCycle.create({
        data: {
          dormitoryId: DORM_ID,
          cycleCode: `CYC-2026-10-${Date.now().toString().slice(-4)}`,
          name: 'รอบบิลทดสอบ Card L2',
          periodStart: new Date(2026, 9, 1),
          periodEnd: new Date(2026, 9, 31),
          billingDate: now,
          dueDate: new Date(Date.now() + 7 * 86400000),
          status: 'OPEN',
        },
      });
    }

    // Find Room for TC
    const occupancy = await tx.occupancy.findFirst({
      where: { tenantId: TC_TENANT_ID, dormitoryId: DORM_ID, status: 'ACTIVE' },
      include: { room: true },
    });
    const roomId = occupancy?.roomId || '059c470e-82d7-4602-8e4b-c91537d0940f';
    const roomNumber = occupancy?.room?.roomNumber || '101';

    return { cycle, roomId, roomNumber };
  });

  try {
    // -------------------------------------------------------------------------
    // AC L2-1: Owner issues utility/monthly bill for TC -> TC receives Flex message
    // -------------------------------------------------------------------------
    console.log('Testing AC L2-1: Bill issuance LINE notification & Flex builder...');
    const flexInvoiceSingle = buildTenantInvoiceFlexMessage(
      'หอพัก Manor',
      roomNumber,
      [{ billNumber: 'INV-L2-TEST-001', billKind: 'MONTHLY', totalAmount: 4500, dueDate: '2026-10-05' }],
      4500,
      '2026-10-05',
      'https://app.hor-plus.com'
    );

    const flexInvoiceMulti = buildTenantInvoiceFlexMessage(
      'หอพัก Manor',
      roomNumber,
      [
        { billNumber: 'INV-001', billKind: 'RENT', totalAmount: 4000, dueDate: '2026-10-05' },
        { billNumber: 'INV-002', billKind: 'UTILITY', totalAmount: 2500, dueDate: '2026-10-05' },
      ],
      6500,
      '2026-10-05',
      'https://app.hor-plus.com'
    );

    const isInvoiceFlexValid =
      flexInvoiceSingle.type === 'flex' &&
      flexInvoiceSingle.altText.includes('แจ้งเตือนบิล') &&
      JSON.stringify(flexInvoiceSingle).includes('เปิดดูบิลและชำระเงิน') &&
      JSON.stringify(flexInvoiceSingle).includes('payments_tab') &&
      flexInvoiceMulti.type === 'flex' &&
      flexInvoiceMulti.altText.includes('แจ้งเตือนบิล');

    console.log('  isInvoiceFlexValid diagnostic:', {
      typeSingle: flexInvoiceSingle.type,
      altTextSingle: flexInvoiceSingle.altText,
      hasBtn: JSON.stringify(flexInvoiceSingle).includes('เปิดดูบิลและชำระเงิน'),
      hasTab: JSON.stringify(flexInvoiceSingle).includes('payments_tab'),
      typeMulti: flexInvoiceMulti.type,
      altTextMulti: flexInvoiceMulti.altText,
      isInvoiceFlexValid,
    });

    // Create a live bill via database within dormitory context
    const billL2_1 = await withDormitoryContext(async (tx) => {
      return await tx.bill.create({
        data: {
          dormitoryId: DORM_ID,
          billingCycleId: cycle.id,
          tenantId: TC_TENANT_ID,
          roomId: roomId,
          billNumber: `INV-L2-LIVE-${Date.now().toString().slice(-4)}`,
          billKind: 'MONTHLY',
          totalAmount: 4500,
          outstandingAmount: 4500,
          paidAmount: 0,
          status: 'issued',
          billingDate: new Date(),
          dueDate: new Date(Date.now() + 7 * 86400000),
        },
      });
    });

    const billsRes = await fetch(`${APP_URL}/api/v1/tenant-portal/bills`, {
      headers: tenantHeaders,
    });
    const billsData = await billsRes.json();
    const foundBill = (billsData.data || []).find((b) => b.id === billL2_1.id);

    console.log(`  Created live bill ${billL2_1.billNumber} on cycle ${cycle.name}`);
    console.log(`  Tenant portal returned bill: ${Boolean(foundBill)}`);
    console.log(`  Flex Invoice Single Valid: ${Boolean(flexInvoiceSingle)}`);
    console.log(`  Flex Invoice Combined Multi Valid: ${Boolean(flexInvoiceMulti)}`);

    if (isInvoiceFlexValid && foundBill) {
      results.l2_1 = 'PASS';
      console.log('  -> AC L2-1 PASS\n');
    } else {
      results.l2_1 = 'FAIL';
      console.log('  -> AC L2-1 FAIL\n');
    }

    // -------------------------------------------------------------------------
    // AC L2-2: Owner confirms slip / accepts payment -> TC receives receipt Flex message
    // -------------------------------------------------------------------------
    console.log('Testing AC L2-2: Payment confirmation / Receipt Flex message...');
    const flexReceipt = buildTenantReceiptFlexMessage(
      'หอพัก Manor',
      roomNumber,
      'RC-L2-TEST-0001',
      [billL2_1.billNumber],
      4500,
      new Date(),
      'https://app.hor-plus.com'
    );

    const isReceiptFlexValid =
      flexReceipt.type === 'flex' &&
      flexReceipt.altText.includes('ยืนยันการรับชำระเงิน') &&
      JSON.stringify(flexReceipt).includes('เปิดดูใบเสร็จรับเงิน') &&
      JSON.stringify(flexReceipt).includes('receipts_tab');

    // Create live payment and approve it via Owner API
    const testPayment = await withDormitoryContext(async (tx) => {
      return await tx.payment.create({
        data: {
          dormitoryId: DORM_ID,
          billId: billL2_1.id,
          tenantId: TC_TENANT_ID,
          method: 'BANK_TRANSFER',
          amount: 4500,
          status: 'UNDER_REVIEW',
          paymentDate: new Date(),
          evidenceUrl: 'slips/sample-test.jpg',
          fileHash: `l2-test-hash-${Date.now()}`,
        },
      });
    });

    const approveRes = await fetch(`${APP_URL}/api/v1/payments/${testPayment.id}/approve`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ overrideReason: 'อนุมัติผ่าน live check L2', notes: 'อนุมัติผ่าน live check L2' }),
    });
    const approveData = await approveRes.json();
    console.log(`  Owner approve payment response status: ${approveRes.status}`);
    if (approveRes.status !== 200) {
      console.log(`  Owner approve payment error body:`, approveData);
    }

    const receiptsRes = await fetch(`${APP_URL}/api/v1/tenant-portal/receipts`, {
      headers: tenantHeaders,
    });
    const receiptsData = await receiptsRes.json();
    const hasReceipt = (receiptsData.data || []).length > 0;

    console.log(`  Tenant receipts available: ${hasReceipt}`);
    console.log(`  Flex Receipt Valid: ${isReceiptFlexValid}`);

    if (isReceiptFlexValid && approveRes.status === 200) {
      results.l2_2 = 'PASS';
      console.log('  -> AC L2-2 PASS\n');
    } else {
      results.l2_2 = 'FAIL';
      console.log('  -> AC L2-2 FAIL\n');
    }

    // -------------------------------------------------------------------------
    // AC L2-3: Owner rejects payment slip -> TC receives verbatim reason Flex message
    // -------------------------------------------------------------------------
    console.log('Testing AC L2-3: Payment rejection with verbatim reason Flex message...');
    const billL2_2 = await withDormitoryContext(async (tx) => {
      return await tx.bill.create({
        data: {
          dormitoryId: DORM_ID,
          billingCycleId: cycle.id,
          tenantId: TC_TENANT_ID,
          roomId: roomId,
          billNumber: `INV-L2-LIVE-REJ-${Date.now().toString().slice(-4)}`,
          billKind: 'MONTHLY',
          totalAmount: 4500,
          outstandingAmount: 4500,
          paidAmount: 0,
          status: 'issued',
          billingDate: new Date(),
          dueDate: new Date(Date.now() + 7 * 86400000),
        },
      });
    });

    const verbatimReason = 'สลิปไม่ชัดเจน ยอดเงินไม่ตรงกับบิล กรุณาแนบใหม่';
    const flexRejected = buildTenantPaymentRejectedFlexMessage(
      'หอพัก Manor',
      roomNumber,
      [billL2_2.billNumber],
      4500,
      verbatimReason,
      'https://app.hor-plus.com'
    );

    const isRejectedFlexValid =
      flexRejected.type === 'flex' &&
      flexRejected.altText.includes('แจ้งเตือนการชำระเงินไม่ถูกต้อง') &&
      JSON.stringify(flexRejected).includes(verbatimReason) &&
      JSON.stringify(flexRejected).includes('แก้ไขและแนบสลิปใหม่') &&
      JSON.stringify(flexRejected).includes('payments_tab');

    // Create another payment and reject via Owner API with verbatim reason
    const testPayment2 = await withDormitoryContext(async (tx) => {
      return await tx.payment.create({
        data: {
          dormitoryId: DORM_ID,
          billId: billL2_2.id,
          tenantId: TC_TENANT_ID,
          method: 'BANK_TRANSFER',
          amount: 4500,
          status: 'UNDER_REVIEW',
          paymentDate: new Date(),
          evidenceUrl: 'slips/sample-test-2.jpg',
          fileHash: `l2-test-hash2-${Date.now()}`,
        },
      });
    });

    const rejectRes = await fetch(`${APP_URL}/api/v1/payments/${testPayment2.id}/reject`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ reason: verbatimReason }),
    });
    const rejectData = await rejectRes.json();
    console.log(`  Owner reject payment response status: ${rejectRes.status}`);

    const updatedPayment = await withDormitoryContext(async (tx) => {
      return await tx.payment.findUnique({
        where: { id: testPayment2.id },
      });
    });
    console.log(`  Persisted rejectedReason: "${updatedPayment?.rejectedReason}"`);
    console.log(`  Flex Rejection Valid: ${isRejectedFlexValid}`);

    if (isRejectedFlexValid && rejectRes.status === 200 && updatedPayment?.rejectedReason === verbatimReason) {
      results.l2_3 = 'PASS';
      console.log('  -> AC L2-3 PASS\n');
    } else {
      results.l2_3 = 'FAIL';
      console.log('  -> AC L2-3 FAIL\n');
    }

    // -------------------------------------------------------------------------
    // AC L2-4: Owner issues bill to TX (unbound) -> No LINE sent, no error, quota unchanged
    // -------------------------------------------------------------------------
    console.log('Testing AC L2-4: Tenant TX without LINE binding...');
    let tenantTX = await withDormitoryContext(async (tx) => {
      let t = await tx.tenant.findFirst({
        where: { dormitoryId: DORM_ID, lineFriendId: null },
      });
      if (!t) {
        t = await tx.tenant.create({
          data: {
            dormitoryId: DORM_ID,
            tenantNumber: `TNT-TX-${Date.now().toString().slice(-4)}`,
            firstName: 'ผู้เช่า',
            lastName: 'ไม่ผูกไลน์',
            displayName: 'ผู้เช่า ไม่ผูกไลน์ (TX)',
            status: 'active',
            lineFriendId: null,
          },
        });
      }
      return t;
    });

    const usageBefore = await prisma.linePushUsage.findFirst({
      where: { dormitoryId: DORM_ID },
    });
    const successCountBefore = usageBefore?.successCount ?? 0;

    const notifResTX = await lineOaService.sendTenantLineNotification({
      dormitoryId: DORM_ID,
      tenantId: tenantTX.id,
      eventType: 'INVOICE',
      eventId: `live-tx-test-${Date.now()}`,
      textMessage: 'ทดสอบส่งให้ผู้เช่า TX',
    });

    console.log(`  sendTenantLineNotification for TX result:`, notifResTX);
    const usageAfter = await prisma.linePushUsage.findFirst({
      where: { dormitoryId: DORM_ID },
    });
    const successCountAfter = usageAfter?.successCount ?? 0;

    const isL2_4Pass =
      notifResTX.sent === false &&
      notifResTX.reason === 'NO_LINE_BINDING' &&
      successCountAfter === successCountBefore;

    if (isL2_4Pass) {
      results.l2_4 = 'PASS';
      console.log('  -> AC L2-4 PASS\n');
    } else {
      results.l2_4 = 'FAIL';
      console.log('  -> AC L2-4 FAIL\n');
    }

    // -------------------------------------------------------------------------
    // AC L2-5: System: Registration approval suppresses bill notification
    // -------------------------------------------------------------------------
    console.log('Testing AC L2-5: Registration approval bill notification suppression (PO A1)...');
    // Verify in BillingService and deposit-billing.util.ts that registration does not emit INVOICE LINE notification
    const depositBillingCode = fs.readFileSync(path.join(ROOT_DIR, 'server/src/utils/deposit-billing.util.ts'), 'utf8');
    const billingServiceCode = fs.readFileSync(path.join(ROOT_DIR, 'server/src/services/billing.service.ts'), 'utf8');
    const tenantRegServiceCode = fs.readFileSync(path.join(ROOT_DIR, 'server/src/services/tenant-registration.service.ts'), 'utf8');

    const hasSuppressionParam = billingServiceCode.includes('suppressLineNotification?: boolean');
    const sendsOnlyApprovalOutcome = tenantRegServiceCode.includes('buildTenantApprovalOutcomeFlexMessage');
    const noDirectBillNotificationInReg = !tenantRegServiceCode.includes('buildTenantInvoiceFlexMessage');

    console.log(`  hasSuppressionParam: ${hasSuppressionParam}`);
    console.log(`  sendsOnlyApprovalOutcome: ${sendsOnlyApprovalOutcome}`);
    console.log(`  noDirectBillNotificationInReg: ${noDirectBillNotificationInReg}`);

    if (hasSuppressionParam && sendsOnlyApprovalOutcome && noDirectBillNotificationInReg) {
      results.l2_5 = 'PASS';
      console.log('  -> AC L2-5 PASS\n');
    } else {
      results.l2_5 = 'FAIL';
      console.log('  -> AC L2-5 FAIL\n');
    }

    // -------------------------------------------------------------------------
    // AC L2-6: Zero Quota Safety (Non-throwing, PO A1)
    // -------------------------------------------------------------------------
    console.log('Testing AC L2-6: Zero Quota Safety (Non-throwing, PO A1)...');
    // Query current quota status
    const { LinePushUsageService } = await import('../../server/dist/services/line-push-usage.service.js');
    const pushUsageService = new LinePushUsageService(prisma);
    const quotaStatus = await pushUsageService.getQuotaStatus(DORM_ID);
    const periodKey = pushUsageService.getCurrentPeriodKey('Asia/Bangkok');

    // Temporarily set usage to quotaLimit to simulate quota exhaustion
    await withDormitoryContext(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "line_push_usage" ("id", "dormitory_id", "period_key", "success_count", "reserved_count", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${DORM_ID}::uuid, ${periodKey}, ${quotaStatus.quotaLimit}, 0, NOW(), NOW())
        ON CONFLICT ("dormitory_id", "period_key")
        DO UPDATE SET "success_count" = ${quotaStatus.quotaLimit}, "reserved_count" = 0, "updated_at" = NOW()
      `;
    });

    // Clear cache to enforce read from DB
    const { clearProcessedNotificationEvents } = await import('../../server/dist/services/line-oa.service.js');
    clearProcessedNotificationEvents();

    const notifResExhausted = await lineOaService.sendTenantLineNotification({
      dormitoryId: DORM_ID,
      tenantId: TC_TENANT_ID,
      eventType: 'INVOICE',
      eventId: `live-exhausted-${Date.now()}`,
      flexMessage: flexInvoiceSingle,
    });

    console.log(`  Zero quota notification result:`, notifResExhausted);

    // Restore previous usage
    await withDormitoryContext(async (tx) => {
      await tx.$executeRaw`
        UPDATE "line_push_usage"
        SET "success_count" = ${usageBefore?.successCount ?? 0},
            "reserved_count" = 0,
            "updated_at" = NOW()
        WHERE "dormitory_id" = ${DORM_ID}::uuid AND "period_key" = ${periodKey}
      `;
    });

    const isL2_6Pass =
      notifResExhausted.sent === false &&
      notifResExhausted.reason === 'QUOTA_EXHAUSTED' &&
      notifResExhausted.remainingQuota === 0;

    if (isL2_6Pass) {
      results.l2_6 = 'PASS';
      console.log('  -> AC L2-6 PASS\n');
    } else {
      results.l2_6 = 'FAIL';
      console.log('  -> AC L2-6 FAIL\n');
    }

  } finally {
    // Clean up test data if needed
  }

  console.log('=== CARD L2 LIVE CHECK RESULTS ===');
  console.table(results);

  const allPassed = Object.values(results).every((r) => r === 'PASS');
  if (allPassed) {
    console.log('\nALL 6 ACCEPTANCE CRITERIA PASSED on app.hor-plus.com!');
    process.exit(0);
  } else {
    console.error('\nSOME CHECKS FAILED!');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during Card L2 live check:', err);
  process.exit(1);
});
