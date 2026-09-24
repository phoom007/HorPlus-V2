/**
 * Live Check for Card S6 on app.hor-plus.com
 * Verifies S6-1, S6-2, S6-3, S6-4 against live endpoints.
 */

import fs from 'fs';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const APP_URL = 'https://app.hor-plus.com';
const PRIMARY_DORM_ID = '20000001-0000-4000-8000-000000000002'; // Comprehensive Manor
const FOREIGN_DORM_ID = 'd99948ec-49d4-4629-9fea-567241e5049d'; // TheRiCH Apartment

function getCredentials(role) {
  const content = fs.readFileSync('.agents/local/test-access.md', 'utf8');
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
  const tenantCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');
  const prisma = getPrismaClient();

  console.log('=== Checking Card S6 Live Endpoints on app.hor-plus.com ===\n');

  // =========================================================================
  // 1. [AC S6-1] Unauthenticated Public Policy: No Owner Signature Leak
  // =========================================================================
  console.log('1. [AC S6-1] Public Policy Endpoint (No Session)');
  const resPolicy = await fetch(`${APP_URL}/api/v1/tenant-registrations/public-policy?dormitoryId=${PRIMARY_DORM_ID}`);
  const dataPolicy = await resPolicy.json();
  const policy = dataPolicy.data || {};

  console.log(`Status: ${resPolicy.status}`);
  console.log(`Dormitory Name: ${policy.dormitoryName}`);
  console.log(`Terms Length: ${policy.defaultTerms ? policy.defaultTerms.length : 0} chars`);
  console.log(`Pet Policy: ${JSON.stringify(policy.petPolicy)}`);
  console.log(`Owner Signature: ${policy.ownerSignature}`);

  const passS61 =
    resPolicy.status === 200 &&
    policy.ownerSignature === null &&
    Boolean(policy.defaultTerms) &&
    policy.dormitoryId === PRIMARY_DORM_ID;
  console.log(`Result S6-1: ${passS61 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 2. [AC S6-2] Unauthenticated Registration: Fake lineFollowerId Ignored
  // =========================================================================
  console.log('2. [AC S6-2] Tenant Registration with Fake lineFollowerId (No Session)');
  const fakeFollowerId = `U_spoofed_${Date.now()}`;
  const testPhone = `089${Math.floor(1000000 + Math.random() * 9000000)}`;

  // Find a valid vacant room in Manor
  const room = await prisma.room.findFirst({
    where: { dormitoryId: PRIMARY_DORM_ID, deletedAt: null },
    select: { id: true, roomNumber: true },
  });

  const resReg = await fetch(`${APP_URL}/api/v1/tenant-registrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dormitory-id': PRIMARY_DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: PRIMARY_DORM_ID,
      requestedRoomId: room?.id,
      prefix: 'นาย',
      firstName: 'ทดสอบ',
      lastName: 'สวมสิทธิ์เอสสอง',
      phone: testPhone,
      agreedTerms: true,
      expectedPolicyVersion: policy.version || 1,
      signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      lineFollowerId: fakeFollowerId, // Fake follower ID injected by client
    }),
  });

  console.log(`Status: ${resReg.status}`);
  const regJson = await resReg.json();
  const createdReq = regJson.data;

  let boundFollowerId = null;
  if (createdReq?.id) {
    const dbReq = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: createdReq.id },
      select: { lineFollowerId: true, status: true },
    });
    boundFollowerId = dbReq?.lineFollowerId;
    console.log(`Created Request ID: ${createdReq.id}, DB lineFollowerId: ${boundFollowerId}`);

    // Owner rejects the test request to clean up
    await fetch(`${APP_URL}/api/v1/tenant-registrations/${createdReq.id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${ownerCreds.session}`,
        'x-csrf-token': ownerCreds.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({ reason: 'ทดสอบระบบความปลอดภัย S6-2' }),
    });
  }

  const passS62 = resReg.status === 201 && boundFollowerId === null;
  console.log(`Result S6-2: ${passS62 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 3. [AC S6-3] Daily Stay: Cross-Dormitory Access Rejected with 403
  // =========================================================================
  console.log('3. [AC S6-3] Daily Stay Cross-Dormitory Isolation (TA in Manor calling TheRiCH)');

  // 3.1 GET /request-context targeting foreign dormitory
  const resContextForeign = await fetch(
    `${APP_URL}/api/v1/daily-stay/request-context?dormitoryId=${FOREIGN_DORM_ID}&roomNumber=A101`,
    {
      headers: {
        Cookie: `horplus_session=${tenantCreds.session}`,
      },
    }
  );
  console.log(`GET /request-context foreign status: ${resContextForeign.status}`);
  const contextForeignJson = await resContextForeign.json();
  console.log(`Error: ${JSON.stringify(contextForeignJson.error)}`);

  // 3.2 POST /request targeting foreign dormitory
  const resPostForeign = await fetch(`${APP_URL}/api/v1/daily-stay/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${tenantCreds.session}`,
      'x-csrf-token': tenantCreds.csrf,
      'x-dormitory-id': FOREIGN_DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: FOREIGN_DORM_ID,
      roomNumber: 'A101',
      applicantFullName: 'สมชาย ผู้เช่า ข้ามหอ',
      applicantPhone: '0812345678',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
    }),
  });
  console.log(`POST /request foreign status: ${resPostForeign.status}`);
  const postForeignJson = await resPostForeign.json();
  console.log(`Error: ${JSON.stringify(postForeignJson.error)}`);

  const passS63 =
    resContextForeign.status === 403 &&
    resPostForeign.status === 403 &&
    contextForeignJson.error?.code === 'FORBIDDEN' &&
    postForeignJson.error?.code === 'FORBIDDEN';
  console.log(`Result S6-3: ${passS63 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 4. [AC S6-4] Registration Submission & Owner Rejection with Reason
  // =========================================================================
  console.log('4. [AC S6-4] TD Registration & Owner Rejection Lifecycle with Reason "ทดสอบระบบ"');
  const tdPhone = `088${Math.floor(1000000 + Math.random() * 9000000)}`;

  const resTdReg = await fetch(`${APP_URL}/api/v1/tenant-registrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dormitory-id': PRIMARY_DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: PRIMARY_DORM_ID,
      requestedRoomId: room?.id,
      prefix: 'นางสาว',
      firstName: 'ทัศนีย์',
      lastName: 'ทดสอบสี่',
      phone: tdPhone,
      note: 'ทดสอบลงทะเบียนรอบ S6-4',
      agreedTerms: true,
      expectedPolicyVersion: policy.version || 1,
      signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      coOccupants: [{ name: 'ผู้พักร่วม หนึ่ง', phone: '0811111111' }],
      emergencyContact: { name: 'ผู้ติดต่อ ฉุกเฉิน', phone: '0822222222', relationship: 'พี่สาว' },
      vehicle: { type: 'car', licensePlate: '9กข 9999' },
    }),
  });

  const tdRegJson = await resTdReg.json();
  const tdReqId = tdRegJson.data?.id;
  console.log(`TD Registration Status: ${resTdReg.status}, Request ID: ${tdReqId}`);

  let passS64 = false;
  if (tdReqId) {
    // Owner rejects with reason "ทดสอบระบบ"
    const resReject = await fetch(`${APP_URL}/api/v1/tenant-registrations/${tdReqId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${ownerCreds.session}`,
        'x-csrf-token': ownerCreds.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({ reason: 'ทดสอบระบบ' }),
    });

    console.log(`Owner Reject Status: ${resReject.status}`);
    const rejectJson = await resReject.json();
    console.log(`Rejected Request: status=${rejectJson.data?.status}, reason=${rejectJson.data?.rejectedReason}`);

    // Verify in DB
    const finalDbReq = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: tdReqId },
      select: { status: true, rejectedReason: true, acceptanceSnapshot: true },
    });

    console.log(`DB Status: ${finalDbReq?.status}, Reason: ${finalDbReq?.rejectedReason}`);
    passS64 =
      resReject.status === 200 &&
      finalDbReq?.status === 'rejected' &&
      finalDbReq?.rejectedReason === 'ทดสอบระบบ';
  }

  console.log(`Result S6-4: ${passS64 ? 'PASS' : 'FAIL'}\n`);

  console.log('=== SUMMARY OF LIVE CHECKS ===');
  console.log(`S6-1 (Public Policy No Signature): ${passS61 ? 'PASS' : 'FAIL'}`);
  console.log(`S6-2 (Sanitize Fake LINE ID):       ${passS62 ? 'PASS' : 'FAIL'}`);
  console.log(`S6-3 (Daily Stay Isolation 403):    ${passS63 ? 'PASS' : 'FAIL'}`);
  console.log(`S6-4 (Rejection Reason Lifecycle):   ${passS64 ? 'PASS' : 'FAIL'}`);

  if (passS61 && passS62 && passS63 && passS64) {
    console.log('\nALL 4 LIVE CHECKS PASSED!');
    process.exit(0);
  } else {
    console.error('\nSOME CHECKS FAILED!');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during live checks:', err);
  process.exit(1);
});
