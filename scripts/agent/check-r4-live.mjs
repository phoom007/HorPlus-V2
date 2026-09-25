/**
 * Live API and DB Verification Script for Card R4
 * Target: https://app.hor-plus.com
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const APP_URL = 'https://app.hor-plus.com';
const PRIMARY_DORM_ID = '20000001-0000-4000-8000-000000000002';
const ROOM_VACANT_ID = '14a4b02d-9f57-4af6-befb-8fb12d605376'; // Room 204
const ROOM_OCCUPIED_ID = '059c470e-82d7-4602-8e4b-c91537d0940f'; // Room 101

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

async function cleanupTestDailyStays(prisma) {
  try {
    const stays = await prisma.dailyStay.findMany({
      where: {
        dormitoryId: PRIMARY_DORM_ID,
        OR: [
          { applicantFullName: { contains: 'ทดสอบรายวัน' } },
          { applicantFullName: { contains: 'สมปอง' } },
          { applicantFullName: { contains: 'คนอยากพัก' } },
        ],
      },
    });
    for (const s of stays) {
      if (s.invoiceId) {
        const invoicePayments = await prisma.payment.findMany({ where: { dailyStayInvoiceId: s.invoiceId } });
        for (const pay of invoicePayments) {
          await prisma.receipt.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentAllocation.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: pay.id } });
          await prisma.payment.deleteMany({ where: { id: pay.id } });
        }
        await prisma.dailyStayInvoiceItem.deleteMany({ where: { dailyStayInvoiceId: s.invoiceId } });
        await prisma.dailyStayInvoice.deleteMany({ where: { id: s.invoiceId } });
      }
      if (s.tenantId) {
        const bills = await prisma.bill.findMany({ where: { tenantId: s.tenantId } });
        for (const b of bills) {
          const payments = await prisma.payment.findMany({ where: { billId: b.id } });
          for (const pay of payments) {
            await prisma.receipt.deleteMany({ where: { paymentId: pay.id } });
            await prisma.paymentAllocation.deleteMany({ where: { paymentId: pay.id } });
            await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: pay.id } });
            await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: pay.id } });
            await prisma.payment.deleteMany({ where: { id: pay.id } });
          }
          await prisma.paymentUploadIntent.deleteMany({ where: { billId: b.id } });
          await prisma.receipt.deleteMany({ where: { billId: b.id } });
          await prisma.billItem.deleteMany({ where: { billId: b.id } });
          await prisma.bill.deleteMany({ where: { id: b.id } });
        }
      }
      if (s.occupancyId) {
        await prisma.occupancy.deleteMany({ where: { id: s.occupancyId } });
      }
      await prisma.dailyStay.deleteMany({ where: { id: s.id } });
    }

    const testTenants = await prisma.tenant.findMany({
      where: {
        dormitoryId: PRIMARY_DORM_ID,
        OR: [
          { firstName: { contains: 'ทดสอบรายวัน' } },
          { firstName: { contains: 'สมปอง' } },
          { firstName: { contains: 'คนอยากพัก' } },
        ],
      },
    });
    for (const t of testTenants) {
      const bills = await prisma.bill.findMany({ where: { tenantId: t.id } });
      for (const b of bills) {
        const payments = await prisma.payment.findMany({ where: { billId: b.id } });
        for (const pay of payments) {
          await prisma.receipt.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentAllocation.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: pay.id } });
          await prisma.payment.deleteMany({ where: { id: pay.id } });
        }
        await prisma.billItem.deleteMany({ where: { billId: b.id } });
        await prisma.bill.deleteMany({ where: { id: b.id } });
      }
      await prisma.occupancy.deleteMany({ where: { tenantId: t.id } });
      await prisma.tenant.deleteMany({ where: { id: t.id } });
    }

    await prisma.room.update({
      where: { id: ROOM_VACANT_ID },
      data: { status: 'vacant', currentTenantId: null },
    });
    await prisma.room.update({
      where: { id: '3558477a-20a0-4c45-b695-4a1c009bfb55' }, // Room 205
      data: { status: 'vacant', currentTenantId: null },
    });
  } catch (e) {
    console.warn('Cleanup warning:', e.message);
  }
}

async function main() {
  console.log('=== Card R4 Live Verification on app.hor-plus.com ===\n');

  const prisma = getPrismaClient();
  await cleanupTestDailyStays(prisma);

  const ownerCreds = getCredentials('Owner');
  const staffCreds = getCredentials('Staff');
  const tenantCreds = getCredentials('Tenant');

  const ownerHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${ownerCreds.session}`,
    'x-csrf-token': ownerCreds.csrf,
    'x-dormitory-id': PRIMARY_DORM_ID,
  };

  const staffHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${staffCreds.session}`,
    'x-csrf-token': staffCreds.csrf,
    'x-dormitory-id': PRIMARY_DORM_ID,
  };

  const tenantHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${tenantCreds.session}`,
    'x-csrf-token': tenantCreds.csrf,
    'x-dormitory-id': PRIMARY_DORM_ID,
  };

  let allPassed = true;

  // =========================================================================
  // AC R4-1: Applicant submits daily stay request for vacant room (Room 204)
  // =========================================================================
  console.log('--- Testing AC R4-1: Applicant submits daily stay request ---');
  let createdStayId = null;
  try {
    const today = new Date();
    const startStr = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 2 * 24 * 3600 * 1000);
    const endStr = end.toISOString().slice(0, 10);

    const reqBody = {
      dormitoryId: PRIMARY_DORM_ID,
      roomNumber: '204',
      roomId: ROOM_VACANT_ID,
      applicantFullName: 'สมปอง ทดสอบรายวัน R4',
      applicantPhone: '0891112233',
      startDate: startStr,
      endDate: endStr,
      depositAmount: '500.00',
      depositDeclaredStatus: 'UNPAID',
      paymentMethod: 'CASH',
    };

    const res = await fetch(`${APP_URL}/api/v1/daily-stays/request`, {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify(reqBody),
    });

    const data = await res.json();
    console.log('Submit request HTTP status:', res.status);
    console.log('Submit response data:', JSON.stringify(data));

    if (res.status === 201 && data?.data?.status === 'PENDING_APPROVAL') {
      createdStayId = data.data.id;
      const inclusiveDays = data.data.inclusiveDayCount;
      const totalRent = Number(data.data.totalRentAmount);
      console.log(`Stay ID: ${createdStayId}, inclusiveDayCount: ${inclusiveDays}, totalRent: ${totalRent}`);
      if (inclusiveDays === 2) {
        console.log('✅ AC R4-1 PASS: Daily stay request created with 2 nights and PENDING_APPROVAL');
      } else {
        console.error(`❌ AC R4-1 FAIL: expected 2 nights, got ${inclusiveDays}`);
        allPassed = false;
      }
    } else {
      console.error('❌ AC R4-1 FAIL: Unexpected response status or payload');
      allPassed = false;
    }
  } catch (err) {
    console.error('❌ AC R4-1 ERROR:', err.message);
    allPassed = false;
  }

  // =========================================================================
  // AC R4-3: Request room with conflicting dates -> 409
  // =========================================================================
  console.log('\n--- Testing AC R4-3: Applicant requests conflicting/occupied room ---');
  try {
    const today = new Date();
    const startStr = today.toISOString().slice(0, 10);
    const endStr = new Date(today.getTime() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const conflictBody = {
      dormitoryId: PRIMARY_DORM_ID,
      roomNumber: '101',
      roomId: ROOM_OCCUPIED_ID,
      applicantFullName: 'คนอยากพัก ชนคิว R4',
      applicantPhone: '0899998888',
      startDate: startStr,
      endDate: endStr,
    };

    const res = await fetch(`${APP_URL}/api/v1/daily-stays/request`, {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify(conflictBody),
    });

    const data = await res.json();
    console.log('Conflict request HTTP status:', res.status);
    console.log('Conflict response data:', JSON.stringify(data));

    if (res.status === 409 && (data?.error?.message?.includes('ไม่ว่าง') || data?.message?.includes('ไม่ว่าง'))) {
      console.log('✅ AC R4-3 PASS: Server rejected overlapping room with 409 and Thai error message');
    } else {
      console.error('❌ AC R4-3 FAIL: Expected 409 with Thai error message');
      allPassed = false;
    }
  } catch (err) {
    console.error('❌ AC R4-3 ERROR:', err.message);
    allPassed = false;
  }

  // =========================================================================
  // AC R4-4: Staff calls approve/reject endpoint -> 403 Forbidden
  // =========================================================================
  console.log('\n--- Testing AC R4-4: Staff role permission check ---');
  if (createdStayId) {
    try {
      const res = await fetch(`${APP_URL}/api/v1/daily-stays/${createdStayId}/approve`, {
        method: 'POST',
        headers: staffHeaders,
        body: JSON.stringify({}),
      });

      const data = await res.json();
      console.log('Staff approve HTTP status:', res.status);
      console.log('Staff approve response data:', JSON.stringify(data));

      if (res.status === 403) {
        console.log('✅ AC R4-4 PASS: Staff approval request rejected with 403 Forbidden');
      } else {
        console.error(`❌ AC R4-4 FAIL: Expected 403, got ${res.status}`);
        allPassed = false;
      }
    } catch (err) {
      console.error('❌ AC R4-4 ERROR:', err.message);
      allPassed = false;
    }
  } else {
    console.warn('⚠️ AC R4-4 SKIPPED: createdStayId is missing');
  }

  // =========================================================================
  // AC R4-2: Owner approves daily stay -> DailyStay, Occupancy, Bill (DAILY) created
  // =========================================================================
  console.log('\n--- Testing AC R4-2: Owner approves daily stay ---');
  if (createdStayId) {
    try {
      const res = await fetch(`${APP_URL}/api/v1/daily-stays/${createdStayId}/approve`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({}),
      });

      const data = await res.json();
      console.log('Owner approve HTTP status:', res.status);
      console.log('Owner approve response data:', JSON.stringify(data));

      if (res.status === 200 && data?.data?.status === 'ACTIVE') {
        const approvedStay = data.data;
        const tenantId = approvedStay.tenantId;
        const occupancyId = approvedStay.occupancyId;
        console.log(`Approved stay status: ${approvedStay.status}, tenantId: ${tenantId}, occupancyId: ${occupancyId}`);

        // Verify DailyStayInvoice and Bill in DB
        const invoice = await prisma.dailyStayInvoice.findFirst({
          where: { dailyStayId: createdStayId },
          include: { items: true },
        });
        console.log(`DailyStayInvoice: ${invoice?.invoiceNumber}, items: ${invoice?.items?.length}`);

        const bill = await prisma.bill.findFirst({
          where: { dormitoryId: PRIMARY_DORM_ID, roomId: ROOM_VACANT_ID, billKind: 'DAILY' },
          include: { items: true },
        });
        console.log(`Bill kind: ${bill?.billKind}, billNumber: ${bill?.billNumber}, totalAmount: ${bill?.totalAmount}`);

        const room = await prisma.room.findUnique({
          where: { id: ROOM_VACANT_ID },
        });
        console.log(`Room 204 status: ${room?.status}, currentTenantId: ${room?.currentTenantId}`);

        if (invoice && bill && (room?.status === 'occupied' || room?.status === 'reserved')) {
          console.log('✅ AC R4-2 PASS: Owner approved stay, DailyStayInvoice and Bill (DAILY) created, Room occupied');
        } else {
          console.error('❌ AC R4-2 FAIL: Missing invoice, bill, or room status not updated');
          allPassed = false;
        }
      } else {
        console.error('❌ AC R4-2 FAIL: Expected 200 with ACTIVE status');
        allPassed = false;
      }
    } catch (err) {
      console.error('❌ AC R4-2 ERROR:', err.message);
      allPassed = false;
    }
  } else {
    console.warn('⚠️ AC R4-2 SKIPPED: createdStayId is missing');
  }

  console.log('\n=== Summary ===');
  if (allPassed) {
    console.log('🎉 ALL LIVE API CHECKS PASSED!');
    process.exit(0);
  } else {
    console.error('💥 SOME LIVE API CHECKS FAILED!');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal execution error:', e);
  process.exit(1);
});
