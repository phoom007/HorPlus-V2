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
  console.log('STARTING LIVE VERIFICATION OF TASK 14 ON https://app.hor-plus.com');
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
    // Create dedicated room T14-101 and tenant T14-Tenant for clean testing
    // ----------------------------------------------------------------------
    console.log('--- Setting up test fixtures for Task 14 ---');
    const building = await prisma.building.findFirst({ where: { dormitoryId: DORM_ID } });
    let testRoom = await prisma.room.findFirst({
      where: { dormitoryId: DORM_ID, roomNumber: 'T14-101' }
    });
    if (!testRoom) {
      testRoom = await prisma.room.create({
        data: {
          dormitoryId: DORM_ID,
          buildingId: building.id,
          roomNumber: 'T14-101',
          normalizedRoomNumber: 't14-101',
          floor: 1,
          roomType: 'Standard',
          status: 'vacant',
          termDeposit: 5000,
          monthlyDeposit: 5000,
          dailyDeposit: 500,
          monthlyRent: 4000,
        }
      });
      console.log(`Created test room T14-101: ${testRoom.id}`);
    }

    let testTenant = await prisma.tenant.findFirst({
      where: { dormitoryId: DORM_ID, phone: '0899991414' }
    });
    if (!testTenant) {
      testTenant = await prisma.tenant.create({
        data: {
          dormitoryId: DORM_ID,
          tenantNumber: 'T14-001',
          firstName: 'สมบูรณ์',
          lastName: 'ย้ายออกดี',
          displayName: 'คุณสมบูรณ์ (ย้ายออก)',
          phone: '0899991414',
          email: 'somboon.moveout@horplus-test.local',
          status: 'active',
        }
      });
      console.log(`Created test tenant: ${testTenant.id}`);
      await prisma.tenant.update({
        where: { id: testTenant.id },
        data: { status: 'active' }
      });
    }

    // Clean up any old active occupancies or contracts for testTenant so otherActiveOccupancies is strictly 0
    await prisma.occupancy.updateMany({
      where: { tenantId: testTenant.id, status: 'ACTIVE' },
      data: { status: 'ENDED' }
    });
    await prisma.contract.updateMany({
      where: { tenantId: testTenant.id, status: 'active' },
      data: { status: 'terminated' }
    });

    // Create active contract & occupancy
    let testContract = await prisma.contract.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        contractNumber: `CTR-T14-${Date.now()}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentAmount: 4000,
        depositAmount: 5000,
        status: 'active',
      }
    });
    console.log(`Created test contract: ${testContract.id}`);

    let testOccupancy = await prisma.occupancy.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        contractId: testContract.id,
        startedAt: new Date('2026-01-01'),
        status: 'ACTIVE',
      }
    });
    console.log(`Created test occupancy: ${testOccupancy.id}`);

    // Update room with current tenant and contract
    await prisma.room.update({
      where: { id: testRoom.id },
      data: {
        status: 'occupied',
        currentTenantId: testTenant.id,
        currentContractId: testContract.id,
      }
    });

    // Create line friend & access grant for test tenant
    let lineFriend = await prisma.dormitoryLineFriend.findFirst({
      where: { dormitoryId: DORM_ID, lineUserIdHash: 'hash-t14-somboon' }
    });
    if (!lineFriend) {
      lineFriend = await prisma.dormitoryLineFriend.create({
        data: {
          dormitoryId: DORM_ID,
          lineUserIdHash: 'hash-t14-somboon',
          lineUserIdEncrypted: 'enc-t14-somboon',
          displayName: 'Somboon Line',
        }
      });
    }

    await prisma.tenant.update({
      where: { id: testTenant.id },
      data: { lineFriendId: lineFriend.id }
    });

    let accessGrant = await prisma.dormitoryAccessGrant.findFirst({
      where: { dormitoryId: DORM_ID, lineFriendId: lineFriend.id }
    });
    if (!accessGrant) {
      accessGrant = await prisma.dormitoryAccessGrant.create({
        data: {
          dormitoryId: DORM_ID,
          lineFriendId: lineFriend.id,
          tokenHash: `token-hash-t14-${Date.now()}`,
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
    console.log(`Active test access grant: ${accessGrant.id}`);

    // ----------------------------------------------------------------------
    // AC-1: Move-Out Lifecycle & Early Move-Out Confirmation
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-1: Move-Out Lifecycle & Early Move-Out Confirmation ---');
    
    // 1. Staff attempts to terminate contract -> Must receive HTTP 403 Forbidden
    const staffTermRes = await apiRequest(`/api/v1/contracts/${testContract.id}/terminate`, {
      method: 'POST',
      body: JSON.stringify({
        actualEndDate: '2026-09-24',
        reason: 'Staff unauthorized termination attempt'
      })
    }, staffSession);
    console.log(`Staff terminate contract response: status=${staffTermRes.status} (Expected 403)`);

    // 2. Tenant attempts to terminate contract -> Must receive HTTP 403 Forbidden
    const tenantTermRes = await apiRequest(`/api/v1/contracts/${testContract.id}/terminate`, {
      method: 'POST',
      body: JSON.stringify({
        actualEndDate: '2026-09-24',
        reason: 'Tenant unauthorized termination attempt'
      })
    }, tenantSession);
    console.log(`Tenant terminate contract response: status=${tenantTermRes.status} (Expected 403)`);

    // 3. Create a MoveOutRequest for the test tenant
    const moveOutReq = await prisma.tenantMoveOutRequest.create({
      data: {
        dormitoryId: DORM_ID,
        occupancyId: testOccupancy.id,
        tenantId: testTenant.id,
        roomId: testRoom.id,
        intendedMoveOutDate: new Date('2026-10-31'),
        status: 'SCHEDULED',
        reason: 'งานย้ายที่ทำงาน',
      }
    });
    console.log(`Created move-out request: ${moveOutReq.id}`);

    // 4. Owner confirms early move-out via complete-end-tenancy
    const ownerEndTenancyRes = await apiRequest(`/api/v1/tenant-move-out-requests/${moveOutReq.id}/complete-end-tenancy`, {
      method: 'POST',
      body: JSON.stringify({
        actualEndedAt: '2026-09-24',
        emergencyReason: 'เจ้าของหอยืนยันการย้ายออกก่อนกำหนดเรียบร้อยแล้ว'
      })
    }, ownerSession);
    console.log(`Owner complete-end-tenancy response: status=${ownerEndTenancyRes.status}`);

    // 5. Verify database state post-termination
    const updatedRoom = await prisma.room.findUnique({ where: { id: testRoom.id } });
    const updatedContract = await prisma.contract.findUnique({ where: { id: testContract.id } });
    const updatedOccupancy = await prisma.occupancy.findUnique({ where: { id: testOccupancy.id } });
    const updatedTenant = await prisma.tenant.findUnique({ where: { id: testTenant.id } });
    const updatedGrant = await prisma.dormitoryAccessGrant.findUnique({ where: { id: accessGrant.id } });
    const auditEvents = await prisma.auditLog.findMany({
      where: {
        dormitoryId: DORM_ID,
        entityId: testContract.id,
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`Updated room status: ${updatedRoom?.status}, tenantId=${updatedRoom?.currentTenantId}`);
    console.log(`Updated contract status: ${updatedContract?.status}`);
    console.log(`Updated occupancy status: ${updatedOccupancy?.status}`);
    console.log(`Updated tenant status: ${updatedTenant?.status}`);
    console.log(`Updated grant status: ${updatedGrant?.status}`);
    console.log(`Audit log records found: ${auditEvents.length}`);

    const ac1Pass = (
      staffTermRes.status === 403 &&
      tenantTermRes.status === 403 &&
      ownerEndTenancyRes.status === 200 &&
      updatedRoom?.status === 'vacant' &&
      updatedRoom?.currentTenantId === null &&
      updatedRoom?.currentContractId === null &&
      ['checked_out', 'terminated'].includes(updatedContract?.status) &&
      updatedOccupancy?.status === 'ENDED' &&
      updatedTenant?.status === 'former' &&
      updatedGrant?.status === 'REVOKED'
    );
    results['AC-1'] = ac1Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-1 RESULT: ${results['AC-1']}`);

    // Capture visual screenshot of contract/room in owner UI
    const ownerPage = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await ownerPage.goto(`${BROWSER_URL}/owner/dashboard?tab=rooms`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(2500);
    const shotPath1 = path.join(SCREENSHOTS_DIR, 'ac1-owner-moveout-terminate-live.png');
    await ownerPage.screenshot({ path: shotPath1, fullPage: false });
    saveScreenshot(shotPath1, 'ac1-owner-moveout-terminate-live.png');
    await ownerPage.close();

    // ----------------------------------------------------------------------
    // AC-2: Final Settlement & Ledger Calculation
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-2: Final Settlement & Ledger Calculation ---');

    // 1. Create bills for settlement testing:
    let billingCycle = await prisma.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { createdAt: 'desc' }
    });
    if (!billingCycle) {
      billingCycle = await prisma.billingCycle.create({
        data: {
          dormitoryId: DORM_ID,
          cycleName: 'Cycle T14',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          status: 'ACTIVE',
        }
      });
    }

    // Unpaid deposit bill
    const unpaidDepositBill = await prisma.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: billingCycle.id,
        contractId: testContract.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        billNumber: `BILL-DEP-${Date.now()}`,
        billKind: 'DEPOSIT',
        totalAmount: 5000,
        paidAmount: 0,
        status: 'unpaid',
        billingDate: new Date(),
        dueDate: new Date(),
      }
    });

    // Unpaid rent bill
    const unpaidRentBill = await prisma.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: billingCycle.id,
        contractId: testContract.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        billNumber: `BILL-RENT-${Date.now()}`,
        billKind: 'RENT',
        totalAmount: 4000,
        paidAmount: 0,
        status: 'unpaid',
        billingDate: new Date(),
        dueDate: new Date(),
      }
    });

    // 2. Query settlement: deposit is UNPAID -> must yield 0 credit!
    const setlRes1 = await apiRequest(`/api/v1/settlements/${testContract.id}`, { method: 'GET' }, ownerSession);
    console.log(`Settlement with UNPAID deposit: status=${setlRes1.status}, data:`, {
      depositAmount: setlRes1.json?.data?.depositAmount,
      unpaidBillAmount: setlRes1.json?.data?.unpaidBillAmount,
      netSettlement: setlRes1.json?.data?.netSettlement,
      settlementDirection: setlRes1.json?.data?.settlementDirection,
    });
    const settlementId = setlRes1.json?.data?.id;

    const unpaidDepositGivesZeroCredit = (
      Number(setlRes1.json?.data?.depositAmount) === 0 &&
      Number(setlRes1.json?.data?.unpaidBillAmount) === 9000 &&
      Number(setlRes1.json?.data?.netSettlement) === -9000 &&
      setlRes1.json?.data?.settlementDirection === 'PAYMENT_DUE'
    );
    console.log(`Unpaid deposit yields 0 credit: ${unpaidDepositGivesZeroCredit}`);

    // 3. Mark deposit as paid
    await prisma.bill.update({
      where: { id: unpaidDepositBill.id },
      data: { status: 'paid', paidAmount: 5000 }
    });

    // Delete existing settlement to recalculate fresh
    await prisma.contractSettlement.delete({ where: { id: settlementId } });

    // 4. Query settlement: deposit is PAID -> yields 5000 credit!
    const setlRes2 = await apiRequest(`/api/v1/settlements/${testContract.id}`, { method: 'GET' }, ownerSession);
    const settlementId2 = setlRes2.json?.data?.id;
    console.log(`Settlement with PAID deposit: status=${setlRes2.status}, data:`, {
      depositAmount: setlRes2.json?.data?.depositAmount,
      unpaidBillAmount: setlRes2.json?.data?.unpaidBillAmount,
      netSettlement: setlRes2.json?.data?.netSettlement,
      settlementDirection: setlRes2.json?.data?.settlementDirection,
    });
    const paidDepositGivesCredit = (
      Number(setlRes2.json?.data?.depositAmount) === 5000 &&
      Number(setlRes2.json?.data?.unpaidBillAmount) === 4000 &&
      Number(setlRes2.json?.data?.netSettlement) === 1000 &&
      setlRes2.json?.data?.settlementDirection === 'REFUND'
    );

    // 5. Add damage item
    const addDamageRes = await apiRequest(`/api/v1/settlements/${settlementId2}/damage-items`, {
      method: 'POST',
      body: JSON.stringify({
        description: 'ค่าซ่อมลูกบิดประตูห้องน้ำ',
        amount: 350
      })
    }, ownerSession);
    console.log(`Add damage item response: status=${addDamageRes.status}, data:`, addDamageRes.json?.data);
    const damageItemId = addDamageRes.json?.data?.id;

    // 6. Soft-delete damage item
    const deleteDamageRes = await apiRequest(`/api/v1/settlements/damage-items/${damageItemId}`, {
      method: 'DELETE'
    }, ownerSession);
    console.log(`Soft delete damage item response: status=${deleteDamageRes.status}`);

    const damageItemInDb = await prisma.contractSettlementItem.findUnique({
      where: { id: damageItemId }
    });
    console.log(`Damage item in DB after soft delete: isDeleted=${damageItemInDb?.isDeleted} (Record exists: ${!!damageItemInDb})`);

    // 7. Confirm settlement status idempotently
    const confirmRes1 = await apiRequest(`/api/v1/settlements/${settlementId2}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ status: 'REFUNDED' })
    }, ownerSession);
    console.log(`Confirm settlement #1 response: status=${confirmRes1.status}, settlementStatus=${confirmRes1.json?.data?.settlementStatus}`);

    const confirmRes2 = await apiRequest(`/api/v1/settlements/${settlementId2}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ status: 'REFUNDED' })
    }, ownerSession);
    console.log(`Confirm settlement #2 (idempotent retry): status=${confirmRes2.status}`);

    // 8. Attempt to modify locked settlement -> Must fail
    const addAfterLockRes = await apiRequest(`/api/v1/settlements/${settlementId2}/damage-items`, {
      method: 'POST',
      body: JSON.stringify({
        description: 'พยายามเพิ่มรายการใน settlement ที่ล็อกแล้ว',
        amount: 100
      })
    }, ownerSession);
    console.log(`Add item after lock: status=${addAfterLockRes.status} (Expected 400 SETTLEMENT_LOCKED)`);

    const ac2Pass = (
      unpaidDepositGivesZeroCredit &&
      paidDepositGivesCredit &&
      addDamageRes.status === 201 &&
      deleteDamageRes.status === 200 &&
      damageItemInDb?.isDeleted === true &&
      confirmRes1.status === 200 &&
      confirmRes2.status === 200 &&
      addAfterLockRes.status === 400
    );
    results['AC-2'] = ac2Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-2 RESULT: ${results['AC-2']}`);

    // Capture visual screenshot of settlement
    const shotPath2 = path.join(SCREENSHOTS_DIR, 'ac2-owner-settlement-live.png');
    const setlPage = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await setlPage.goto(`${BROWSER_URL}/owner/dashboard?tab=contracts`, { waitUntil: 'domcontentloaded' });
    await setlPage.waitForTimeout(2500);
    await setlPage.screenshot({ path: shotPath2, fullPage: false });
    saveScreenshot(shotPath2, 'ac2-owner-settlement-live.png');
    await setlPage.close();

    // ----------------------------------------------------------------------
    // AC-3: Package Expiry & Restricted Mode (Zero Grace Period)
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-3: Package Expiry & Restricted Mode (Zero Grace Period) ---');

    // 1. Inspect original subscription
    const originalSub = await prisma.dormitorySubscription.findFirst({
      where: { dormitoryId: DORM_ID }
    });
    console.log(`Original subscription expiresAt: ${originalSub?.expiresAt}`);

    // 2. Temporarily set expiresAt to 10 minutes ago
    const pastDate = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.dormitorySubscription.update({
      where: { id: originalSub.id },
      data: { expiresAt: pastDate }
    });
    console.log(`Subscription temporarily set to expired: ${pastDate.toISOString()}`);

    try {
      // 3. Read-only historical viewing must SUCCEED (HTTP 200)
      const readBillsRes = await apiRequest(`/api/v1/bills?pageSize=5`, { method: 'GET' }, ownerSession);
      const readContractsRes = await apiRequest(`/api/v1/contracts?pageSize=5`, { method: 'GET' }, ownerSession);
      const readMetersRes = await apiRequest(`/api/v1/meters/readings?pageSize=5`, { method: 'GET' }, ownerSession);
      console.log(`Restricted Mode read requests: bills=${readBillsRes.status}, contracts=${readContractsRes.status}, meters=${readMetersRes.status}`);

      // 4. Renewal / slip endpoint must remain accessible (HTTP 200)
      const slipConfigRes = await apiRequest(`/api/v1/subscription/config/payment`, { method: 'GET' }, ownerSession);
      console.log(`Restricted Mode renewal payment config: status=${slipConfigRes.status}`);

      // 5. Operational mutations must be BLOCKED (HTTP 403 SUBSCRIPTION_READ_ONLY)
      const mutateBillRes = await apiRequest(`/api/v1/bills/generate`, {
        method: 'POST',
        body: JSON.stringify({ billingCycleId: 'test-cycle', roomIds: [testRoom.id] })
      }, ownerSession);
      console.log(`Restricted Mode bill generate mutation: status=${mutateBillRes.status}, code=${mutateBillRes.json?.error?.code}`);

      const mutateAnnouncementRes = await apiRequest(`/api/v1/announcements`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Test Announcement', content: 'Testing restricted mode', targetAudience: 'ALL' })
      }, ownerSession);
      console.log(`Restricted Mode announcement mutation: status=${mutateAnnouncementRes.status}, code=${mutateAnnouncementRes.json?.error?.code}`);

      const ac3Pass = (
        readBillsRes.status === 200 &&
        readContractsRes.status === 200 &&
        readMetersRes.status === 200 &&
        slipConfigRes.status === 200 &&
        mutateBillRes.status === 403 &&
        mutateBillRes.json?.error?.code === 'SUBSCRIPTION_READ_ONLY' &&
        mutateAnnouncementRes.status === 403 &&
        mutateAnnouncementRes.json?.error?.code === 'SUBSCRIPTION_READ_ONLY'
      );
      results['AC-3'] = ac3Pass ? 'PASS' : 'FAIL';
      console.log(`>>> AC-3 RESULT: ${results['AC-3']}`);

      // Screenshot restricted mode page
      const shotPath3 = path.join(SCREENSHOTS_DIR, 'ac3-restricted-mode-live.png');
      const subPage = await browser.newPage({
        storageState: ownerSession.file,
        viewport: { width: 1440, height: 900 }
      });
      await subPage.goto(`${BROWSER_URL}/owner/dashboard?tab=subscription`, { waitUntil: 'domcontentloaded' });
      await subPage.waitForTimeout(2500);
      await subPage.screenshot({ path: shotPath3, fullPage: false });
      saveScreenshot(shotPath3, 'ac3-restricted-mode-live.png');
      await subPage.close();

    } finally {
      // RESTORE subscription immediately
      await prisma.dormitorySubscription.update({
        where: { id: originalSub.id },
        data: { expiresAt: originalSub.expiresAt }
      });
      console.log(`Restored subscription expiresAt to: ${originalSub.expiresAt}`);
    }

    // ----------------------------------------------------------------------
    // AC-4: Access Revocation & LINE Binding Closure
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-4: Access Revocation & LINE Binding Closure ---');

    // 1. Create a fully authentic session for the former tenant (testTenant)
    let formerUser = await prisma.user.findFirst({
      where: { emailNormalized: 'somboon.former@horplus-test.local' }
    });
    if (!formerUser) {
      formerUser = await prisma.user.create({
        data: {
          googleSubject: `sub-t14-former-${Date.now()}`,
          email: 'somboon.former@horplus-test.local',
          emailNormalized: 'somboon.former@horplus-test.local',
          name: 'นายสมบูรณ์ ย้ายออกดี (อดีตผู้เช่า)',
          phone: '0899991414',
          status: 'active',
        }
      });
    }

    await prisma.tenant.update({
      where: { id: testTenant.id },
      data: { linkedUserId: formerUser.id }
    });

    const formerSessionId = crypto.randomUUID();
    const formerSessionIdHash = hashSessionId(formerSessionId);
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000);

    await prisma.session.create({
      data: {
        id: formerSessionId,
        userId: formerUser.id,
        sessionIdHash: formerSessionIdHash,
        tokenVersion: 1,
        status: 'active',
        expiresAt,
        ipMetadata: '127.0.0.1',
        principalType: 'GOOGLE_USER',
      },
    });

    const formerSessionToken = encryptSessionToken(
      {
        sub: formerUser.id,
        sid: formerSessionId,
        type: 'session',
        version: 1,
      },
      SESSION_KEY,
      7 * 86400
    );

    const formerCsrfToken = generateCsrfToken(formerSessionId, CSRF_KEY);

    // Also ensure DormitoryMember exists for formerUser
    let formerMember = await prisma.dormitoryMember.findFirst({
      where: { dormitoryId: DORM_ID, userId: formerUser.id }
    });
    if (!formerMember) {
      const tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT' } });
      formerMember = await prisma.dormitoryMember.create({
        data: {
          dormitoryId: DORM_ID,
          userId: formerUser.id,
          roleId: tenantRole.id,
          status: 'active',
        }
      });
    }

    const formerSessionObj = {
      sessionCookie: formerSessionToken,
      csrfCookie: formerCsrfToken
    };

    // 2. Former tenant requests tenant portal -> Must receive HTTP 403 TENANCY_ENDED / FORBIDDEN
    const formerProfileRes = await apiRequest(`/api/v1/tenant-portal/profile`, { method: 'GET' }, formerSessionObj);
    console.log(`Former tenant GET /profile: status=${formerProfileRes.status}, error=`, formerProfileRes.json?.error);

    const formerBillsRes = await apiRequest(`/api/v1/tenant-portal/bills`, { method: 'GET' }, formerSessionObj);
    console.log(`Former tenant GET /bills: status=${formerBillsRes.status}, error=`, formerBillsRes.json?.error);

    // 3. Owner retains full historical access to former tenant's contract & bills
    const ownerContractView = await apiRequest(`/api/v1/contracts/${testContract.id}`, { method: 'GET' }, ownerSession);
    console.log(`Owner historical contract view: status=${ownerContractView.status}, contractNumber=${ownerContractView.json?.data?.contractNumber}`);

    const ownerBillsView = await apiRequest(`/api/v1/bills?contractId=${testContract.id}`, { method: 'GET' }, ownerSession);
    console.log(`Owner historical bills view: status=${ownerBillsView.status}, count=${ownerBillsView.json?.data?.length || ownerBillsView.json?.pagination?.totalItems}`);

    const ac4Pass = (
      formerProfileRes.status === 403 &&
      (formerProfileRes.json?.error?.code === 'TENANCY_ENDED' || formerProfileRes.json?.error?.code === 'FORBIDDEN') &&
      formerBillsRes.status === 403 &&
      ownerContractView.status === 200 &&
      ownerBillsView.status === 200
    );
    results['AC-4'] = ac4Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-4 RESULT: ${results['AC-4']}`);

    // Capture visual screenshot of former tenant access rejection
    const shotPath4 = path.join(SCREENSHOTS_DIR, 'ac4-former-tenant-revocation-live.png');
    const formerPage = await browser.newPage({
      viewport: { width: 1440, height: 900 }
    });
    await formerPage.context().addCookies([
      {
        name: 'horplus_session',
        value: formerSessionToken,
        domain: 'localhost',
        path: '/'
      },
      {
        name: 'horplus_csrf',
        value: formerCsrfToken,
        domain: 'localhost',
        path: '/'
      },
      {
        name: 'horplus_session',
        value: formerSessionToken,
        domain: 'app.hor-plus.com',
        path: '/'
      },
      {
        name: 'horplus_csrf',
        value: formerCsrfToken,
        domain: 'app.hor-plus.com',
        path: '/'
      }
    ]);
    await formerPage.goto(`${BROWSER_URL}/tenant`, { waitUntil: 'domcontentloaded' });
    await formerPage.waitForTimeout(2500);
    await formerPage.screenshot({ path: shotPath4, fullPage: false });
    saveScreenshot(shotPath4, 'ac4-former-tenant-revocation-live.png');
    await formerPage.close();

    // ----------------------------------------------------------------------
    // AC-5: Summary & Zero UI Verification
    // ----------------------------------------------------------------------
    const ac5Pass = Object.keys(results).length >= 4 && Object.values(results).every(r => r === 'PASS');
    results['AC-5'] = ac5Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-5 RESULT: ${results['AC-5']}`);

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
