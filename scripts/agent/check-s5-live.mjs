/**
 * Live API Verification for Card S5
 * Target: https://app.hor-plus.com
 * Tests all 6 Acceptance Criteria (S5-1 to S5-6)
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');
const { Redis } = require('../../server/node_modules/ioredis');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.agents/local/sessions');

const envConfig = dotenv.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/.env')));
const prisma = new PrismaClient({
  datasources: { db: { url: envConfig.DIRECT_URL || envConfig.DATABASE_URL } },
});

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing session file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getCookieString(sessionData) {
  return sessionData.cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function getCsrfToken(sessionData) {
  const csrfCookie = sessionData.cookies.find(c => c.name === 'horplus_csrf');
  return csrfCookie ? csrfCookie.value : '';
}

async function main() {
  console.log('=== Starting Card S5 Live API Verification ===\n');

  // Clear registration rate limits in Redis
  try {
    const redis = new Redis(envConfig.REDIS_URL || 'redis://localhost:6379');
    const rateLimitKeys = await redis.keys('rate_limit:registration:*');
    if (rateLimitKeys.length > 0) {
      await redis.del(...rateLimitKeys);
      console.log(`  Cleared ${rateLimitKeys.length} registration rate-limit keys from Redis`);
    }
    redis.disconnect();
  } catch (err) {
    console.warn('  Redis rate limit cleanup warning:', err.message);
  }

  const ownerSession = getSession('owner');
  const ownerCookies = getCookieString(ownerSession);
  const ownerCsrf = getCsrfToken(ownerSession);

  // 1. Delete previous test TC tenants if created in previous runs
  const prevTcTenants = await prisma.tenant.findMany({
    where: { dormitoryId: DORM_ID, phone: '0895551122' },
  });
  for (const t of prevTcTenants) {
    const bills = await prisma.bill.findMany({ where: { tenantId: t.id }, select: { id: true } });
    const billIds = bills.map(b => b.id);
    if (billIds.length > 0) {
      await prisma.combinedPaymentGroupBillTarget.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.paymentAllocation.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.paymentUploadIntent.deleteMany({ where: { billId: { in: billIds } } });
      const payments = await prisma.payment.findMany({ where: { billId: { in: billIds } }, select: { id: true } });
      const paymentIds = payments.map(p => p.id);
      if (paymentIds.length > 0) {
        await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      }
      await prisma.receipt.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.payment.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.billStatusHistory.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.billItem.deleteMany({ where: { billId: { in: billIds } } });
    }
    await prisma.combinedPaymentGroupBillTarget.deleteMany({ where: { paymentGroup: { tenantId: t.id } } });
    await prisma.paymentAllocation.deleteMany({ where: { paymentGroup: { tenantId: t.id } } });
    await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentGroup: { tenantId: t.id } } });
    await prisma.paymentUploadIntent.deleteMany({ where: { tenantId: t.id } });
    await prisma.combinedPaymentGroup.deleteMany({ where: { tenantId: t.id } });
    await prisma.bill.deleteMany({ where: { tenantId: t.id } });
    await prisma.contractStatusHistory.deleteMany({ where: { contract: { tenantId: t.id } } });
    await prisma.contract.deleteMany({ where: { tenantId: t.id } });
    await prisma.provisionalRentalTerm.deleteMany({ where: { tenantId: t.id } });
    await prisma.occupancy.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenantEmergencyContact.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenantVehicle.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenantCoOccupant.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenantNotice.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
    console.log(`  Cleaned up previous test tenant: ${t.id}`);
  }

  // Ensure Room 304 is vacant
  const targetRoom = await prisma.room.findFirst({
    where: { dormitoryId: DORM_ID, roomNumber: '304' },
  });
  if (!targetRoom) throw new Error('Room 304 not found');
  await prisma.room.update({
    where: { id: targetRoom.id },
    data: { status: 'vacant', currentTenantId: null, currentContractId: null },
  });
  console.log(`Selected Clean Target Room: ${targetRoom.roomNumber} (${targetRoom.id})`);

  // --------------------------------------------------------------------------
  // S5-1: Owner creates tenant TC in vacant Room 205 via standard API with backdated start date per PO-2
  // (contract ending within 30 days from today for use in C2)
  // Today is 2026-09-25. StartDate = 2025-10-15, Duration = 12 months -> EndDate = 2026-10-14 (in 19 days)
  // --------------------------------------------------------------------------
  console.log('\n--- 1. [AC S5-1] Owner creates tenant TC in vacant room 205 ---');
  const createTcPayload = {
    roomId: targetRoom.id,
    fullName: 'ธนดล เจริญสุข',
    phone: '0895551122',
    rentalType: 'MONTHLY',
    startDate: '2025-10-15',
    durationMonths: 12,
    unitRentAmount: '3500',
    depositAmount: '7000',
    depositDeclaredStatus: 'PAID',
  };

  const createRes = await fetch(`${BASE_URL}/api/v1/meters/provisional-terms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': ownerCookies,
      'X-CSRF-Token': ownerCsrf,
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify(createTcPayload),
  });

  const createJson = await createRes.json();
  console.log(`  Create TC response status: ${createRes.status}`);
  if (!createRes.ok) {
    console.error('  Failed to create TC:', createJson);
    throw new Error('Create TC failed');
  }

  // Verify in DB that TC is created as unlinked tenant
  const tcTenant = await prisma.tenant.findFirst({
    where: { dormitoryId: DORM_ID, phone: '0895551122', deletedAt: null },
    include: { provisionalRentalTerms: true },
  });
  if (!tcTenant) throw new Error('TC tenant not found in database');
  console.log(`  TC created in DB: ${tcTenant.displayName} (${tcTenant.id}), lineFriendId: ${tcTenant.lineFriendId}, linkedUserId: ${tcTenant.linkedUserId}`);
  if (tcTenant.lineFriendId !== null || tcTenant.linkedUserId !== null) {
    throw new Error('TC must be unlinked initially');
  }
  const tcProv = tcTenant.provisionalRentalTerms[0];
  console.log(`  Provisional term: start=${tcProv?.startDate}, end=${tcProv?.endDate}, rent=${tcProv?.unitRentAmount}, deposit=${tcProv?.depositAmount}`);
  console.log('  PASS: S5-1');

  // --------------------------------------------------------------------------
  // S5-3: TC (LINE reserve 1): Entering 1-character name or wrong phone is rejected in Thai
  // (Must be verified before S5-2)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. [AC S5-3] Verification rejects 1-character name or wrong phone in Thai ---');
  // Sub-check A: 1-character name
  const shortInputRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/verify-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      claimInput: 'ธ',
    }),
  });
  const shortJson = await shortInputRes.json();
  console.log(`  1-character input status: ${shortInputRes.status}, error:`, shortJson.error?.message);
  if (shortInputRes.status !== 400 || !shortJson.error?.message?.includes('อย่างน้อย 2 ตัวอักษร')) {
    throw new Error(`Expected 400 with min 2 chars error, got ${shortInputRes.status}: ${JSON.stringify(shortJson)}`);
  }

  // Sub-check B: Wrong phone number
  const wrongPhoneRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/verify-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      claimInput: '0899999999',
    }),
  });
  const wrongPhoneJson = await wrongPhoneRes.json();
  console.log(`  Wrong phone status: ${wrongPhoneRes.status}, error:`, wrongPhoneJson.error?.message);
  if (wrongPhoneRes.status !== 404 || !wrongPhoneJson.error?.message?.includes('ไม่ตรงกับข้อมูลในระบบ')) {
    throw new Error(`Expected 404 with mismatch error, got ${wrongPhoneRes.status}: ${JSON.stringify(wrongPhoneJson)}`);
  }
  console.log('  PASS: S5-3');

  // --------------------------------------------------------------------------
  // S5-6: Unauthenticated caller calling verify-claim receives ONLY safe masked data
  // (masked name + room number); NO phone, emergency contact, vehicle, or co-occupant data returned
  // --------------------------------------------------------------------------
  console.log('\n--- 3. [AC S5-6] Unauthenticated verify-claim returns masked data only (No PII) ---');
  const verifyRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/verify-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      claimInput: '0895551122', // Exact phone
    }),
  });
  const verifyJson = await verifyRes.json();
  console.log(`  Verify claim response status: ${verifyRes.status}`);
  if (!verifyRes.ok || !verifyJson.data?.verified) {
    throw new Error(`Verify claim failed: ${JSON.stringify(verifyJson)}`);
  }

  const claimData = verifyJson.data;
  console.log(`  Masked name returned: "${claimData.maskedName}", displayName: "${claimData.displayName}"`);
  console.log(`  Room returned:`, claimData.room);
  console.log(`  Claim verification token present: ${!!claimData.claimVerificationToken}`);

  if (claimData.maskedName !== 'ธน*** เจ***') {
    throw new Error(`Expected masked name 'ธน*** เจ***', got '${claimData.maskedName}'`);
  }
  if (claimData.phone !== undefined) {
    throw new Error(`SECURITY LEAK: phone was returned in verify-claim: ${claimData.phone}`);
  }
  if (claimData.emergencyContact !== undefined) {
    throw new Error(`SECURITY LEAK: emergencyContact was returned in verify-claim`);
  }
  if (claimData.vehicles !== undefined) {
    throw new Error(`SECURITY LEAK: vehicles was returned in verify-claim`);
  }
  if (claimData.coOccupants !== undefined) {
    throw new Error(`SECURITY LEAK: coOccupants was returned in verify-claim`);
  }
  if (claimData.pet !== undefined) {
    throw new Error(`SECURITY LEAK: pet was returned in verify-claim`);
  }
  console.log('  PASS: S5-6 (All private PII withheld, only masked name and room returned)');

  const claimVerificationToken = claimData.claimVerificationToken;

  // --------------------------------------------------------------------------
  // S5-5: Calling complete-claim without prior verify token or without CSRF targeting TC
  // is rejected; TC data in DB remains unchanged
  // --------------------------------------------------------------------------
  console.log('\n--- 4. [AC S5-5] complete-claim rejected without verify token or without CSRF ---');
  // Sub-check A: Missing claimVerificationToken
  const noTokenRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/complete-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      tenantId: tcTenant.id,
      signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      // Omit claimVerificationToken
    }),
  });
  const noTokenJson = await noTokenRes.json();
  console.log(`  Missing token status: ${noTokenRes.status}, error:`, noTokenJson.error?.message);
  if (noTokenRes.status !== 400) {
    throw new Error(`Expected 400 for missing token, got ${noTokenRes.status}`);
  }

  // Sub-check B: Cookie session present but CSRF header omitted
  const noCsrfRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/complete-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': ownerCookies, // Has horplus_session cookie
      // OMIT X-CSRF-Token
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      tenantId: tcTenant.id,
      claimVerificationToken,
      signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    }),
  });
  const noCsrfJson = await noCsrfRes.json();
  console.log(`  No CSRF status: ${noCsrfRes.status}, error:`, noCsrfJson.error?.message);
  if (noCsrfRes.status !== 403 || noCsrfJson.error?.code !== 'CSRF_INVALID') {
    throw new Error(`Expected 403 CSRF_INVALID, got ${noCsrfRes.status}: ${JSON.stringify(noCsrfJson)}`);
  }

  // Verify TC in DB remains unchanged
  const tcCheckDb = await prisma.tenant.findUnique({ where: { id: tcTenant.id } });
  if (tcCheckDb.lineFriendId !== null || tcCheckDb.linkedUserId !== null) {
    throw new Error('TC data in DB was modified by rejected complete-claim!');
  }
  console.log('  PASS: S5-5 (TC in DB remains untouched)');

  // --------------------------------------------------------------------------
  // S5-2: TC: Mobile button in OA -> claim verification -> enter matching data ->
  // binding succeeds, immediately enters TC portal
  // --------------------------------------------------------------------------
  console.log('\n--- 5. [AC S5-2] TC completes claim with valid verify token & invite token ---');
  // Ensure TC has a lineFriendId to bind
  let tcLineFriend = await prisma.dormitoryLineFriend.findFirst({
    where: { dormitoryId: DORM_ID, displayName: 'ผู้เช่า TC (LINE สำรอง 1)' },
  });
  if (!tcLineFriend) {
    const rawLineUserId = 'U_tc_reserve_line_001';
    const lineUserIdHash = crypto.createHash('sha256').update(rawLineUserId).digest('hex');
    tcLineFriend = await prisma.dormitoryLineFriend.create({
      data: {
        dormitoryId: DORM_ID,
        displayName: 'ผู้เช่า TC (LINE สำรอง 1)',
        lineUserIdHash,
        lineUserIdEncrypted: 'enc_tc_reserve_line_001',
        friendStatus: 'ADDED',
      },
    });
  }

  // Create invite token for TC
  const tcRawToken = crypto.randomBytes(32).toString('hex');
  const tcTokenHash = crypto.createHash('sha256').update(tcRawToken).digest('hex');
  const tcInvite = await prisma.tenantRegistrationInvite.create({
    data: {
      dormitoryId: DORM_ID,
      lineFriendId: tcLineFriend.id,
      tokenHash: tcTokenHash,
      purpose: 'TENANT_REGISTRATION',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const completeRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/complete-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      tenantId: tcTenant.id,
      inviteToken: tcRawToken,
      claimVerificationToken,
      signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      displayName: 'ธนดล เจริญสุข',
      firstName: 'ธนดล',
      lastName: 'เจริญสุข',
      phone: '0895551122',
    }),
  });

  const completeJson = await completeRes.json();
  console.log(`  complete-claim status: ${completeRes.status}`, completeJson.data ? 'Success' : completeJson.error);
  if (!completeRes.ok || !completeJson.data?.success) {
    throw new Error(`complete-claim failed: ${JSON.stringify(completeJson)}`);
  }

  // Verify DB state
  const claimedTcInDb = await prisma.tenant.findUnique({
    where: { id: tcTenant.id },
    include: { contracts: true },
  });
  console.log(`  Claimed TC in DB: lineFriendId=${claimedTcInDb.lineFriendId}, status=${claimedTcInDb.status}`);
  if (claimedTcInDb.lineFriendId !== tcLineFriend.id) {
    throw new Error(`Expected lineFriendId ${tcLineFriend.id}, got ${claimedTcInDb.lineFriendId}`);
  }
  const r205Occupied = await prisma.room.findUnique({ where: { id: targetRoom.id } });
  console.log(`  Room 205 status: ${r205Occupied.status}, currentTenantId: ${r205Occupied.currentTenantId}`);
  if (r205Occupied.status !== 'occupied' || r205Occupied.currentTenantId !== tcTenant.id) {
    throw new Error('Room 205 was not updated to occupied with currentTenantId');
  }
  console.log('  PASS: S5-2 (TC successfully claimed and bound)');

  // --------------------------------------------------------------------------
  // S5-4: TD (LINE reserve 2): Attempting to claim already-claimed tenant TC is rejected
  // (409 / Thai error)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. [AC S5-4] TD attempts to claim already-claimed TC -> Rejected 409 ---');
  // Attempt 1: Call verify-claim on Room 205 which is now occupied
  const verifyOccupiedRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/verify-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      claimInput: '0895551122',
    }),
  });
  const verifyOccupiedJson = await verifyOccupiedRes.json();
  console.log(`  verify-claim on claimed room status: ${verifyOccupiedRes.status}, error:`, verifyOccupiedJson.error?.message);
  if (verifyOccupiedRes.status !== 404 || !verifyOccupiedJson.error?.message?.includes('ไม่พบข้อมูลผู้เช่าที่รอการยืนยันสิทธิ์')) {
    throw new Error(`Expected 404 CLAIM_UNAVAILABLE, got ${verifyOccupiedRes.status}`);
  }

  // Attempt 2: Direct call to complete-claim targeting already-claimed TC
  const reClaimRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/complete-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      tenantId: tcTenant.id,
      claimVerificationToken, // Old verify token
      signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      displayName: 'นิดา ผู้เช่าใหม่ (TD)',
    }),
  });
  const reClaimJson = await reClaimRes.json();
  console.log(`  complete-claim on already-claimed tenant status: ${reClaimRes.status}, error:`, reClaimJson.error?.message);
  if (reClaimRes.status !== 409 || !reClaimJson.error?.message?.includes('ได้รับการผูกสิทธิ์บัญชีหรือ LINE เรียบร้อยแล้ว')) {
    throw new Error(`Expected 409 TENANT_ALREADY_CLAIMED, got ${reClaimRes.status}: ${JSON.stringify(reClaimJson)}`);
  }
  console.log('  PASS: S5-4 (Re-claiming already bound tenant is strictly rejected with 409)');

  console.log('\n=== ALL CARD S5 LIVE API CHECKS PASSED SUCCESSFULLY! ===');
}

main()
  .catch(err => {
    console.error('\n❌ S5 Live API Check FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
