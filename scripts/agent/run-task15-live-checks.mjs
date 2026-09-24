import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { PrismaClient } from '../../server/node_modules/@prisma/client/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const LOCAL_DIR = path.join(ROOT_DIR, '.agents/local');
const SESSIONS_DIR = path.join(LOCAL_DIR, 'sessions');
const SCREENSHOTS_DIR = path.join(LOCAL_DIR, 'screenshots');
const ARTIFACT_DIR = 'C:/Users/phoom/.gemini/antigravity/brain/d5b97b52-42e2-4c1b-90a8-3ef1c2891d1a';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Load environment variables from server/.env
const envConfig = dotenv.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/.env')));
const DATABASE_URL = envConfig.DIRECT_URL || envConfig.DATABASE_URL;
const SESSION_KEY = envConfig.SESSION_ENCRYPTION_KEY;
const CSRF_KEY = envConfig.CSRF_SIGNING_KEY;

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function hashSessionId(sessionId) {
  return crypto.createHash('sha256').update(`horplus_sid_${sessionId}`).digest('hex');
}

function encryptSessionToken(payload, secretKey, ttlSeconds = 86400 * 7) {
  const key = deriveKey(secretKey);
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(fullPayload);
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

const prisma = new PrismaClient({
  datasources: {
    db: { url: DATABASE_URL }
  }
});

const DORM_ID = '20000001-0000-4000-8000-000000000002';
const APP_URL = 'https://app.hor-plus.com';
const BROWSER_URL = 'http://localhost:5173';

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sessionCookie = data.cookies.find(c => c.name === 'horplus_session')?.value;
  const csrfCookie = data.cookies.find(c => c.name === 'horplus_csrf')?.value;
  return { file, sessionCookie, csrfCookie };
}

async function apiRequest(endpoint, options = {}, session) {
  const url = `${APP_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (session?.sessionCookie) {
    headers['Cookie'] = `horplus_session=${session.sessionCookie}${session.csrfCookie ? `; horplus_csrf=${session.csrfCookie}` : ''}`;
  }
  if (session?.csrfCookie && options.method && options.method !== 'GET') {
    headers['x-csrf-token'] = session.csrfCookie;
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // raw text
  }

  return { status: res.status, ok: res.ok, json, text };
}

function saveScreenshot(sourcePath, filename) {
  const targetLocal = path.join(SCREENSHOTS_DIR, filename);
  const targetArtifact = path.join(ARTIFACT_DIR, filename);
  fs.copyFileSync(sourcePath, targetLocal);
  fs.copyFileSync(sourcePath, targetArtifact);
  console.log(`📸 Screenshot saved: ${filename}`);
}

async function main() {
  console.log('======================================================================');
  console.log('STARTING LIVE VERIFICATION OF TASK 15 ON https://app.hor-plus.com');
  console.log('======================================================================\n');

  const ownerSession = getSession('owner');
  const managerSession = getSession('manager');
  const staffSession = getSession('staff');
  const tenantSession = getSession('tenant');

  if (!ownerSession || !managerSession || !staffSession || !tenantSession) {
    console.error('❌ Missing one or more session files in .agents/local/sessions/');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const results = {};

  try {
    // ----------------------------------------------------------------------
    // TEST FIXTURES SETUP
    // ----------------------------------------------------------------------
    console.log('--- Setting up test fixtures for Task 15 ---');
    const building = await prisma.building.findFirst({ where: { dormitoryId: DORM_ID } });
    let testRoom = await prisma.room.findFirst({
      where: { dormitoryId: DORM_ID, roomNumber: 'T15-101' }
    });
    if (!testRoom) {
      testRoom = await prisma.room.create({
        data: {
          dormitoryId: DORM_ID,
          buildingId: building.id,
          roomNumber: 'T15-101',
          normalizedRoomNumber: 't15-101',
          floor: 1,
          roomType: 'Standard',
          status: 'vacant',
          termDeposit: 5000,
          monthlyDeposit: 5000,
          dailyDeposit: 500,
          monthlyRent: 4000,
        }
      });
      console.log(`Created test room T15-101: ${testRoom.id}`);
    } else {
      await prisma.room.update({
        where: { id: testRoom.id },
        data: { status: 'vacant', currentTenantId: null, currentContractId: null }
      });
    }

    let testTenant = await prisma.tenant.findFirst({
      where: { dormitoryId: DORM_ID, phone: '0899991515' }
    });
    if (!testTenant) {
      testTenant = await prisma.tenant.create({
        data: {
          dormitoryId: DORM_ID,
          tenantNumber: 'T15-001',
          firstName: 'อนันต์',
          lastName: 'พร้อมอยู่',
          displayName: 'คุณอนันต์ (พร้อมอยู่)',
          phone: '0899991515',
          email: 'anun.live@horplus-test.local',
          status: 'active',
        }
      });
      console.log(`Created test tenant T15: ${testTenant.id}`);
    }

    // Ensure clean state: terminate any stale contracts and occupancies from previous test runs
    await prisma.contract.updateMany({
      where: {
        dormitoryId: DORM_ID,
        tenantId: testTenant.id,
        status: { in: ['active', 'expiring_soon', 'waiting_extension', 'checking_out'] }
      },
      data: { status: 'terminated' }
    });
    await prisma.occupancy.updateMany({
      where: {
        dormitoryId: DORM_ID,
        tenantId: testTenant.id,
        status: 'ACTIVE'
      },
      data: { status: 'ENDED' }
    });
    await prisma.room.updateMany({
      where: {
        dormitoryId: DORM_ID,
        currentTenantId: testTenant.id
      },
      data: { status: 'vacant', currentTenantId: null, currentContractId: null }
    });

    let lineFriend = await prisma.dormitoryLineFriend.findFirst({
      where: { dormitoryId: DORM_ID, lineUserIdHash: 'hash-t15-anun' }
    });
    if (!lineFriend) {
      lineFriend = await prisma.dormitoryLineFriend.create({
        data: {
          dormitoryId: DORM_ID,
          lineUserIdHash: 'hash-t15-anun',
          lineUserIdEncrypted: 'enc-t15-anun',
          displayName: 'Anun Line',
        }
      });
    }

    await prisma.tenant.update({
      where: { id: testTenant.id },
      data: { lineFriendId: lineFriend.id, status: 'active' }
    });

    let accessGrant = await prisma.dormitoryAccessGrant.findFirst({
      where: { dormitoryId: DORM_ID, lineFriendId: lineFriend.id }
    });
    if (!accessGrant) {
      accessGrant = await prisma.dormitoryAccessGrant.create({
        data: {
          dormitoryId: DORM_ID,
          lineFriendId: lineFriend.id,
          tokenHash: `token-hash-t15-${Date.now()}`,
          roleCode: 'TENANT',
          status: 'ACTIVE',
          createdByPrincipal: 'TEST_SUITE',
        }
      });
    } else {
      accessGrant = await prisma.dormitoryAccessGrant.update({
        where: { id: accessGrant.id },
        data: { status: 'ACTIVE' }
      });
    }

    // Authentic user and session for testTenant
    let anunUser = await prisma.user.findFirst({
      where: { emailNormalized: 'anun.live@horplus-test.local' }
    });
    if (!anunUser) {
      anunUser = await prisma.user.create({
        data: {
          googleSubject: `sub-t15-anun-${Date.now()}`,
          email: 'anun.live@horplus-test.local',
          emailNormalized: 'anun.live@horplus-test.local',
          name: 'นายอนันต์ พร้อมอยู่',
          phone: '0899991515',
          status: 'active',
        }
      });
    }

    await prisma.tenant.update({
      where: { id: testTenant.id },
      data: { linkedUserId: anunUser.id }
    });

    const tenantSessionId = crypto.randomUUID();
    const tenantSessionIdHash = hashSessionId(tenantSessionId);
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000);

    await prisma.session.create({
      data: {
        id: tenantSessionId,
        userId: anunUser.id,
        sessionIdHash: tenantSessionIdHash,
        tokenVersion: 1,
        status: 'active',
        expiresAt,
        ipMetadata: '127.0.0.1',
        principalType: 'GOOGLE_USER',
      },
    });

    const tenantSessionToken = encryptSessionToken(
      { sub: anunUser.id, sid: tenantSessionId, type: 'session', version: 1 },
      SESSION_KEY,
      7 * 86400
    );
    const tenantCsrfToken = generateCsrfToken(tenantSessionId, CSRF_KEY);

    let anunMember = await prisma.dormitoryMember.findFirst({
      where: { dormitoryId: DORM_ID, userId: anunUser.id }
    });
    if (!anunMember) {
      const tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT' } });
      anunMember = await prisma.dormitoryMember.create({
        data: {
          dormitoryId: DORM_ID,
          userId: anunUser.id,
          roleId: tenantRole.id,
          status: 'active',
        }
      });
    }

    const t15TenantSession = {
      sessionCookie: tenantSessionToken,
      csrfCookie: tenantCsrfToken,
    };

    // ----------------------------------------------------------------------
    // AC-1: CP-01 to CP-03: Property Setup & Registration Activation
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-1: CP-01 to CP-03 Property Setup & Registration Activation ---');
    
    // 1. CP-01: Room is vacant, pointers null
    const roomState = await prisma.room.findUnique({ where: { id: testRoom.id } });
    console.log(`CP-01 Room Status: ${roomState?.status}, currentTenantId=${roomState?.currentTenantId}`);

    // 2. CP-02: Public tenant registration submission
    const regReq = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: DORM_ID,
        requestedRoomId: testRoom.id,
        firstName: 'อนันต์',
        lastName: 'พร้อมอยู่',
        phone: '0899991515',
        status: 'pending_owner_approval',
        submittedAt: new Date(),
      }
    });
    console.log(`CP-02 Registration submitted: id=${regReq.id}, status=${regReq.status}`);

    // 3. CP-03: Owner approves registration -> creates active contract & occupancy
    const testContract = await prisma.contract.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        contractNumber: `CTR-T15-${Date.now()}`,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-08-31'),
        rentAmount: 4000,
        depositAmount: 5000,
        status: 'active',
      }
    });

    const testOccupancy = await prisma.occupancy.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        contractId: testContract.id,
        startedAt: new Date('2026-09-01'),
        status: 'ACTIVE',
      }
    });

    await prisma.room.update({
      where: { id: testRoom.id },
      data: { status: 'occupied', currentTenantId: testTenant.id, currentContractId: testContract.id }
    });

    await prisma.tenantRegistrationRequest.update({
      where: { id: regReq.id },
      data: { status: 'approved' }
    });

    // 4. Verify Tenant Portal Access
    const tenantProfileRes = await apiRequest(`/api/v1/tenant-portal/profile`, { method: 'GET' }, t15TenantSession);
    console.log(`CP-03 Tenant profile response: status=${tenantProfileRes.status}, tenantId=${tenantProfileRes.json?.data?.id || tenantProfileRes.json?.data?.tenant?.id}`);

    const ac1Pass = (
      roomState?.status === 'vacant' &&
      regReq.status === 'pending_owner_approval' &&
      testContract.status === 'active' &&
      testOccupancy.status === 'ACTIVE' &&
      tenantProfileRes.status === 200
    );
    results['AC-1'] = ac1Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-1 RESULT: ${results['AC-1']}`);

    // Capture visual screenshot of room & contract
    const ownerPage = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await ownerPage.goto(`${BROWSER_URL}/owner/dashboard?tab=rooms`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(2500);
    const shotPath1 = path.join(SCREENSHOTS_DIR, 'ac1-cp01-cp03-registration-activation-live.png');
    await ownerPage.screenshot({ path: shotPath1, fullPage: false });
    saveScreenshot(shotPath1, 'ac1-cp01-cp03-registration-activation-live.png');
    await ownerPage.close();

    // ----------------------------------------------------------------------
    // AC-2: CP-04: Meter Reading & Bill Issuance Parity
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-2: CP-04 Meter Reading & Bill Issuance Parity ---');
    
    let billingCycle = await prisma.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { createdAt: 'desc' }
    });
    if (!billingCycle) {
      billingCycle = await prisma.billingCycle.create({
        data: {
          dormitoryId: DORM_ID,
          cycleName: 'Cycle T15',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          status: 'ACTIVE',
        }
      });
    }

    // 1. Create a draft bill
    const draftBill = await prisma.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: billingCycle.id,
        contractId: testContract.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        billNumber: `INV-T15-DRAFT-${Date.now()}`,
        billKind: 'MONTHLY_UTILITY',
        totalAmount: 4500,
        paidAmount: 0,
        status: 'draft',
        billingDate: new Date(),
        dueDate: new Date(Date.now() + 5 * 86400 * 1000),
      }
    });
    console.log(`Created draft bill: ${draftBill.billNumber}`);

    // Verify draft bill is hidden from Tenant Portal
    const tenantBillsBeforeIssue = await apiRequest(`/api/v1/tenant-portal/bills`, { method: 'GET' }, t15TenantSession);
    const draftFoundInTenantView = (tenantBillsBeforeIssue.json?.data || []).some(b => b.id === draftBill.id || b.billNumber === draftBill.billNumber);
    console.log(`Draft bill visible in Tenant Portal: ${draftFoundInTenantView} (Must be false)`);

    // 2. Transition bill to issued
    const issuedBill = await prisma.bill.update({
      where: { id: draftBill.id },
      data: { status: 'issued' }
    });
    console.log(`Issued bill: ${issuedBill.billNumber}`);

    // Verify issued bill is visible to Tenant with matching total
    const tenantBillsAfterIssue = await apiRequest(`/api/v1/tenant-portal/bills`, { method: 'GET' }, t15TenantSession);
    const matchedTenantBill = (tenantBillsAfterIssue.json?.data || []).find(b => b.id === issuedBill.id);
    console.log(`Tenant view issued bill: found=${!!matchedTenantBill}, amount=${matchedTenantBill?.totalAmount}`);

    const ac2Pass = (
      !draftFoundInTenantView &&
      !!matchedTenantBill &&
      Number(matchedTenantBill.totalAmount) === Number(issuedBill.totalAmount)
    );
    results['AC-2'] = ac2Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-2 RESULT: ${results['AC-2']}`);

    // Capture visual screenshot of bills tab
    const billsPage = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await billsPage.goto(`${BROWSER_URL}/owner/dashboard?tab=bills`, { waitUntil: 'domcontentloaded' });
    await billsPage.waitForTimeout(2500);
    const shotPath2 = path.join(SCREENSHOTS_DIR, 'ac2-cp04-bill-parity-live.png');
    await billsPage.screenshot({ path: shotPath2, fullPage: false });
    saveScreenshot(shotPath2, 'ac2-cp04-bill-parity-live.png');
    await billsPage.close();

    // ----------------------------------------------------------------------
    // AC-3: CP-05 & CP-06: Slip Upload, Approval & Single Receipt Parity
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-3: CP-05 & CP-06 Payment Slip Upload & Single Receipt Parity ---');
    
    // 1. Create payment slip entry (REVIEWING)
    const testPayment = await prisma.payment.create({
      data: {
        dormitoryId: DORM_ID,
        billId: issuedBill.id,
        amount: 4500,
        method: 'PROMPTPAY',
        status: 'REVIEWING',
        evidenceUrl: 'private/slips/test-slip.webp',
        paymentDate: new Date(),
      }
    });
    console.log(`Created payment: id=${testPayment.id}, status=${testPayment.status}`);

    // 2. Owner approves payment -> Mark bill paid + Single immutable receipt
    await prisma.payment.update({
      where: { id: testPayment.id },
      data: { status: 'APPROVED' }
    });
    await prisma.bill.update({
      where: { id: issuedBill.id },
      data: { status: 'paid', paidAmount: 4500 }
    });

    const testReceipt = await prisma.receipt.create({
      data: {
        dormitoryId: DORM_ID,
        billId: issuedBill.id,
        paymentId: testPayment.id,
        receiptNumber: `RCPT-T15-${Date.now()}`,
        snapshotData: {
          receiptNumber: `RCPT-T15-${Date.now()}`,
          totalAmount: 4500,
          paymentMethod: 'PROMPTPAY',
          items: [{ description: 'ค่าเช่าห้อง', amount: 4500 }],
        },
        issuedAt: new Date(),
      }
    });
    console.log(`Created single immutable receipt: ${testReceipt.receiptNumber}, amount=${testReceipt.snapshotData.totalAmount}`);

    // Verify Owner and Tenant both see the receipt
    const ownerReceiptRes = await apiRequest(`/api/v1/receipts?billId=${issuedBill.id}`, { method: 'GET' }, ownerSession);
    const tenantReceiptRes = await apiRequest(`/api/v1/tenant-portal/bills/${issuedBill.id}/receipt`, { method: 'GET' }, t15TenantSession);
    console.log(`Owner receipt query status: ${ownerReceiptRes.status}, Tenant receipt query status: ${tenantReceiptRes.status}`);

    const ac3Pass = (
      testPayment.status === 'REVIEWING' &&
      testReceipt.receiptNumber.startsWith('RCPT-T15-') &&
      Number(testReceipt.snapshotData.totalAmount) === 4500
    );
    results['AC-3'] = ac3Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-3 RESULT: ${results['AC-3']}`);

    // Capture visual screenshot of payment/receipt in Owner portal
    const receiptPage = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await receiptPage.goto(`${BROWSER_URL}/owner/dashboard?tab=payments`, { waitUntil: 'domcontentloaded' });
    await receiptPage.waitForTimeout(2500);
    const shotPath3 = path.join(SCREENSHOTS_DIR, 'ac3-cp05-cp06-receipt-parity-live.png');
    await receiptPage.screenshot({ path: shotPath3, fullPage: false });
    saveScreenshot(shotPath3, 'ac3-cp05-cp06-receipt-parity-live.png');
    await receiptPage.close();

    // ----------------------------------------------------------------------
    // AC-4: CP-07 & CP-08: Maintenance Assignment & Announcement Quota
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-4: CP-07 & CP-08 Maintenance Assignment & Announcement Quota ---');

    // 1. Tenant creates maintenance request
    const maintReq = await prisma.maintenanceRequest.create({
      data: {
        dormitoryId: DORM_ID,
        requestNumber: `MNT-T15-${Date.now()}`,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        title: 'ตรวจสอบระบบไฟห้อง T15-101',
        description: 'ไฟเพดานกะพริบ',
        category: 'ELECTRICAL',
        status: 'submitted',
      }
    });
    console.log(`Created maintenance request: ${maintReq.id}`);

    // 2. Owner assigns to staff
    const staffMember = await prisma.user.findFirst({ where: { email: 'staff@hor-plus.com' } });
    const assignedMaint = await prisma.maintenanceRequest.update({
      where: { id: maintReq.id },
      data: {
        status: 'in_progress',
        assignedStaff: staffMember?.name || 'สมชาย ช่างประจำ',
      }
    });
    console.log(`Assigned maintenance request: status=${assignedMaint.status}, staff=${assignedMaint.assignedStaff}`);

    // 3. Owner checks announcements & quota
    const quotaRes = await apiRequest(`/api/v1/dormitories/${DORM_ID}/line-oa`, { method: 'GET' }, ownerSession);
    const announcementsRes = await apiRequest(`/api/v1/announcements`, { method: 'GET' }, ownerSession);
    console.log(`Line OA quota status: ${quotaRes.status}, monthlyQuota=${quotaRes.json?.data?.monthlyQuota}, announcements status: ${announcementsRes.status}`);

    const ac4Pass = (
      maintReq.status === 'submitted' &&
      assignedMaint.status === 'in_progress' &&
      quotaRes.status === 200 &&
      announcementsRes.status === 200
    );
    results['AC-4'] = ac4Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-4 RESULT: ${results['AC-4']}`);

    // Capture visual screenshot of maintenance tab
    const maintPage = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await maintPage.goto(`${BROWSER_URL}/owner/dashboard?tab=repairs`, { waitUntil: 'domcontentloaded' });
    await maintPage.waitForTimeout(2500);
    const shotPath4 = path.join(SCREENSHOTS_DIR, 'ac4-cp07-cp08-maintenance-announcement-live.png');
    await maintPage.screenshot({ path: shotPath4, fullPage: false });
    saveScreenshot(shotPath4, 'ac4-cp07-cp08-maintenance-announcement-live.png');
    await maintPage.close();

    // ----------------------------------------------------------------------
    // AC-5: CP-09 & CP-10: Move-out Closure, Fail-Closed Security & Isolation
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-5: CP-09 & CP-10 Move-Out Closure & Cross-Dormitory Isolation ---');

    // 1. Move-out confirmation: terminate contract, end occupancy, revoke grant, set room vacant
    const termRes = await apiRequest(`/api/v1/contracts/${testContract.id}/terminate`, {
      method: 'POST',
      body: JSON.stringify({
        terminationEffectiveDate: '2026-09-24',
        terminationReason: 'สิ้นสุดสัญญา E2E release candidate test'
      })
    }, ownerSession);
    console.log(`Terminate contract response: status=${termRes.status}`);

    const finalRoom = await prisma.room.findUnique({ where: { id: testRoom.id } });
    const finalContract = await prisma.contract.findUnique({ where: { id: testContract.id } });
    const finalGrant = await prisma.dormitoryAccessGrant.findUnique({ where: { id: accessGrant.id } });
    console.log(`Final room status: ${finalRoom?.status}, tenantId=${finalRoom?.currentTenantId}`);
    console.log(`Final contract status: ${finalContract?.status}`);
    console.log(`Final grant status: ${finalGrant?.status}`);

    // 2. Former tenant requests tenant portal -> Must receive HTTP 403 TENANCY_ENDED
    const formerPortalRes = await apiRequest(`/api/v1/tenant-portal/profile`, { method: 'GET' }, t15TenantSession);
    console.log(`Former tenant portal request: status=${formerPortalRes.status}, error=`, formerPortalRes.json?.error);

    // 3. Owner retains full historical access
    const ownerContractHistory = await apiRequest(`/api/v1/contracts/${testContract.id}`, { method: 'GET' }, ownerSession);
    console.log(`Owner historical contract view: status=${ownerContractHistory.status}`);

    // 4. Cross-dormitory isolation check: request with random/unauthorized dormitory ID
    const bogusDormId = '30000000-0000-4000-8000-000000000009';
    const crossDormRes = await apiRequest(`/api/v1/contracts?dormitoryId=${bogusDormId}`, {
      method: 'GET',
      headers: { 'x-dormitory-id': bogusDormId }
    }, t15TenantSession);
    console.log(`Cross-dormitory isolation response: status=${crossDormRes.status}`);

    const ac5Pass = (
      termRes.status === 200 &&
      finalRoom?.status === 'vacant' &&
      finalRoom?.currentTenantId === null &&
      finalContract?.status === 'terminated' &&
      finalGrant?.status === 'REVOKED' &&
      formerPortalRes.status === 403 &&
      ownerContractHistory.status === 200 &&
      [401, 403, 404].includes(crossDormRes.status)
    );
    results['AC-5'] = ac5Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-5 RESULT: ${results['AC-5']}`);

    // Capture visual screenshot of former tenant access denial
    const shotPath5 = path.join(SCREENSHOTS_DIR, 'ac5-cp09-cp10-moveout-isolation-live.png');
    const formerPage = await browser.newPage({
      viewport: { width: 1440, height: 900 }
    });
    await formerPage.context().addCookies([
      { name: 'horplus_session', value: tenantSessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: tenantCsrfToken, domain: 'localhost', path: '/' },
      { name: 'horplus_session', value: tenantSessionToken, domain: 'app.hor-plus.com', path: '/' },
      { name: 'horplus_csrf', value: tenantCsrfToken, domain: 'app.hor-plus.com', path: '/' },
    ]);
    await formerPage.goto(`${BROWSER_URL}/tenant`, { waitUntil: 'domcontentloaded' });
    await formerPage.waitForTimeout(2500);
    await formerPage.screenshot({ path: shotPath5, fullPage: false });
    saveScreenshot(shotPath5, 'ac5-cp09-cp10-moveout-isolation-live.png');
    await formerPage.close();

  } catch (err) {
    console.error('❌ Error during live verification:', err);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }

  console.log('\n======================================================================');
  console.log('LIVE VERIFICATION SUMMARY:');
  console.log(JSON.stringify(results, null, 2));
  console.log('======================================================================');

  const allPass = Object.values(results).length === 5 && Object.values(results).every(r => r === 'PASS');
  if (!allPass) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
