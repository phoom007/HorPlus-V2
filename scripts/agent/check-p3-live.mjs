/**
 * Live API Verification Script for Card P3: ประกาศและการแจ้งเตือนในแอป (In-App Announcements & Notifications)
 * Target: https://app.hor-plus.com
 * Validates AC P3-1 to P3-4
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const envPath = path.join(ROOT_DIR, 'server/.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const APP_URL = 'https://app.hor-plus.com';
const PRIMARY_DORM_ID = '20000001-0000-4000-8000-000000000002';

// TA: Somchai (Room 101)
const TA_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b';
const TA_USER_ID = '20000005-0000-4000-8000-000000000005';
const ROOM_101_ID = '059c470e-82d7-4602-8e4b-c91537d0940f';

// TB: Somying (Room 102)
const TB_TENANT_ID = 'd6f6b099-d421-4b1e-8cf1-2f87c0b17aba';
const TB_USER_ID = '4209cad5-8eff-4a7b-a1d2-2b6fdaf003e2';
const ROOM_102_ID = 'e19d2b26-8fba-4cb6-872e-65d3d3ab5ebd';

// TC: Somboon (Former Tenant)
const TC_TENANT_ID = '4546ce37-3968-4ad3-af0d-0f811ded7167';
const TC_USER_ID = 'ef6c2cca-16d4-4298-8bae-c70cccf8ebf5';

const SESSION_KEY = envConfig.SESSION_ENCRYPTION_KEY;
const CSRF_KEY = envConfig.CSRF_SIGNING_KEY;

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

async function createEphemeralSession(prisma, userId) {
  const sid = crypto.randomUUID();
  const sidHash = crypto.createHash('sha256').update(`horplus_sid_${sid}`).digest('hex');

  await prisma.session.create({
    data: {
      id: sid,
      userId,
      sessionIdHash: sidHash,
      tokenVersion: 1,
      status: 'active',
      expiresAt: new Date(Date.now() + 86400 * 1000),
      principalType: 'GOOGLE_USER',
    },
  });

  const token = encryptSessionToken(
    {
      sub: userId,
      sid,
      type: 'session',
      version: 1,
    },
    SESSION_KEY
  );
  const csrf = generateCsrfToken(sid, CSRF_KEY);
  return { token, csrf };
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

async function apiRequest(endpoint, { method = 'GET', body = null, session = null, csrf = null } = {}) {
  const headers = {
    'Accept': 'application/json',
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  if (session) {
    headers['Cookie'] = `horplus_session=${session}; horplus_csrf=${csrf || ''}`;
  }
  if (csrf) {
    headers['x-csrf-token'] = csrf;
  }

  const res = await fetch(`${APP_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  return { status: res.status, ok: res.ok, data: json, text };
}

async function main() {
  console.log('=== Starting Card P3 Live API Verification ===\n');
  const prisma = getPrismaClient();

  const results = {
    p31: false,
    p32: false,
    p33: false,
    p34: false,
  };

  // 1. Prepare Sessions
  console.log('1. Setting up sessions for Owner, TA, TB, and TC...');
  const ownerCreds = getCredentials('Owner');
  const taSession = await createEphemeralSession(prisma, TA_USER_ID);
  const tbSession = await createEphemeralSession(prisma, TB_USER_ID);
  const tcSession = await createEphemeralSession(prisma, TC_USER_ID);
  console.log('Sessions ready.\n');

  // Ensure TB has active contract in room 102
  const tbContract = await prisma.contract.findFirst({
    where: { tenantId: TB_TENANT_ID, status: 'active' },
  });
  if (!tbContract) {
    await prisma.contract.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: PRIMARY_DORM_ID,
        tenantId: TB_TENANT_ID,
        roomId: ROOM_102_ID,
        contractNumber: 'CTR-TB-102',
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
        rentAmount: 4500,
        depositAmount: 9000,
      },
    });
    console.log('Created active contract for TB in Room 102.');
  }

  // =========================================================================
  // AC P3-1: Owner creates announcement targeting Rooms 101 and 102
  // -> Both TA and TB see it. Another room (e.g. 301) does not see it.
  // =========================================================================
  console.log('============================================================');
  console.log('Running Check AC P3-1: Targeted Announcement for Rooms 101 & 102');
  console.log('============================================================');

  const p31Title = `ประกาศทดสอบเฉพาะห้อง 101 และ 102 (${Date.now()})`;
  const p31OtherTitle = `ประกาศทดสอบเฉพาะห้อง 301 อื่นๆ (${Date.now()})`;

  // Owner creates announcement for Rooms 101 & 102
  const createRes1 = await apiRequest('/api/v1/announcements', {
    method: 'POST',
    session: ownerCreds.session,
    csrf: ownerCreds.csrf,
    body: {
      title: p31Title,
      content: 'แจ้งทำความสะอาดระเบียงสำหรับห้อง 101 และ 102 เท่านั้น',
      priority: 'high',
      targetType: 'rooms',
      targetRooms: ['101', '102'],
      sendLinePush: false,
      status: 'published',
    },
  });

  if (!createRes1.ok) {
    console.error('Failed to create targeted announcement:', createRes1.status, createRes1.text);
    process.exit(1);
  }
  const ann1 = createRes1.data?.data || createRes1.data;
  console.log(`Created announcement ID: ${ann1.id}, Title: "${ann1.title}"`);

  // Owner creates announcement for Room 301 only
  const createResOther = await apiRequest('/api/v1/announcements', {
    method: 'POST',
    session: ownerCreds.session,
    csrf: ownerCreds.csrf,
    body: {
      title: p31OtherTitle,
      content: 'แจ้งตรวจสอบมิเตอร์ห้อง 301 เท่านั้น',
      priority: 'normal',
      targetType: 'rooms',
      targetRooms: ['301'],
      sendLinePush: false,
      status: 'published',
    },
  });
  if (!createResOther.ok) {
    console.error('Failed to create control announcement:', createResOther.status, createResOther.text);
    process.exit(1);
  }
  const annOther = createResOther.data?.data || createResOther.data;
  console.log(`Created control announcement ID: ${annOther.id} for Room 301.`);

  // TA fetches announcements
  const taFetch1 = await apiRequest('/api/v1/tenant-portal/announcements', {
    method: 'GET',
    session: taSession.token,
    csrf: taSession.csrf,
  });
  console.log(`TA fetch status: ${taFetch1.status}, count: ${taFetch1.data?.data?.length || 0}`);

  const taHasAnn1 = taFetch1.data?.data?.some((a) => a.id === ann1.id);
  const taHasAnnOther = taFetch1.data?.data?.some((a) => a.id === annOther.id);

  console.log(`- TA sees targeted announcement 101/102: ${taHasAnn1}`);
  console.log(`- TA sees room 301 announcement: ${taHasAnnOther} (expected: false)`);

  // TB fetches announcements
  const tbFetch1 = await apiRequest('/api/v1/tenant-portal/announcements', {
    method: 'GET',
    session: tbSession.token,
    csrf: tbSession.csrf,
  });
  console.log(`TB fetch status: ${tbFetch1.status}, count: ${tbFetch1.data?.data?.length || 0}`);

  const tbHasAnn1 = tbFetch1.data?.data?.some((a) => a.id === ann1.id);
  const tbHasAnnOther = tbFetch1.data?.data?.some((a) => a.id === annOther.id);

  console.log(`- TB sees targeted announcement 101/102: ${tbHasAnn1}`);
  console.log(`- TB sees room 301 announcement: ${tbHasAnnOther} (expected: false)`);

  if (taHasAnn1 && !taHasAnnOther && tbHasAnn1 && !tbHasAnnOther) {
    console.log('>>> AC P3-1 PASS: Both TA and TB see the targeted announcement, and other rooms announcements are filtered out.\n');
    results.p31 = true;
  } else {
    console.error('>>> AC P3-1 FAIL: Target room filtering did not match expectations.\n');
  }

  // =========================================================================
  // AC P3-2: TA reads announcement -> TA isRead: true, TB isRead: false
  // =========================================================================
  console.log('============================================================');
  console.log('Running Check AC P3-2: Per-tenant Read Status Isolation');
  console.log('============================================================');

  // Verify initial state: both unread
  const taAnnBefore = taFetch1.data?.data?.find((a) => a.id === ann1.id);
  const tbAnnBefore = tbFetch1.data?.data?.find((a) => a.id === ann1.id);
  console.log(`Initial read status: TA isRead=${taAnnBefore?.isRead}, TB isRead=${tbAnnBefore?.isRead}`);

  // TA marks announcement as read
  const taReadRes = await apiRequest(`/api/v1/tenant-portal/announcements/${ann1.id}/read`, {
    method: 'POST',
    session: taSession.token,
    csrf: taSession.csrf,
  });
  console.log(`TA mark as read status: ${taReadRes.status}`);

  // Fetch both TA and TB announcements again
  const taFetch2 = await apiRequest('/api/v1/tenant-portal/announcements', {
    method: 'GET',
    session: taSession.token,
    csrf: taSession.csrf,
  });
  const tbFetch2 = await apiRequest('/api/v1/tenant-portal/announcements', {
    method: 'GET',
    session: tbSession.token,
    csrf: tbSession.csrf,
  });

  const taAnnAfter = taFetch2.data?.data?.find((a) => a.id === ann1.id);
  const tbAnnAfter = tbFetch2.data?.data?.find((a) => a.id === ann1.id);

  console.log(`Post-read status: TA isRead=${taAnnAfter?.isRead} (readAt=${taAnnAfter?.readAt})`);
  console.log(`Post-read status: TB isRead=${tbAnnAfter?.isRead} (readAt=${tbAnnAfter?.readAt})`);

  if (taAnnAfter?.isRead === true && tbAnnAfter?.isRead === false) {
    console.log('>>> AC P3-2 PASS: TA status changed to read, while TB status remained unread. Read status is strictly isolated per-tenant.\n');
    results.p32 = true;
  } else {
    console.error('>>> AC P3-2 FAIL: Per-tenant read status isolation failed.\n');
  }

  // =========================================================================
  // AC P3-3: TA "Mark all as read" -> unread count becomes 0, reload is 0
  // =========================================================================
  console.log('============================================================');
  console.log('Running Check AC P3-3: Mark All as Read & Persistence');
  console.log('============================================================');

  // Owner creates another announcement for Room 101 to ensure TA has an unread announcement
  const p33Title = `ประกาศทดสอบชุดที่ 2 สำหรับห้อง 101 (${Date.now()})`;
  const createRes2 = await apiRequest('/api/v1/announcements', {
    method: 'POST',
    session: ownerCreds.session,
    csrf: ownerCreds.csrf,
    body: {
      title: p33Title,
      content: 'แจ้งการตัดกระแสไฟฟ้าชั่วคราวเพื่อปรับปรุงระบบ',
      priority: 'urgent',
      targetType: 'rooms',
      targetRooms: ['101'],
      sendLinePush: false,
      status: 'published',
    },
  });
  if (!createRes2.ok) {
    console.error('Failed to create announcement 2:', createRes2.status, createRes2.text);
    process.exit(1);
  }
  const ann2 = createRes2.data?.data || createRes2.data;
  console.log(`Created announcement 2 ID: ${ann2.id}`);

  // Verify TA has at least 1 unread announcement
  const taFetch3 = await apiRequest('/api/v1/tenant-portal/announcements', {
    method: 'GET',
    session: taSession.token,
    csrf: taSession.csrf,
  });
  const unreadBefore = taFetch3.data?.data?.filter((a) => !a.isRead).length || 0;
  console.log(`TA unread announcements count before read-all: ${unreadBefore}`);

  // TA calls mark all as read
  const markAllRes = await apiRequest('/api/v1/tenant-portal/announcements/read-all', {
    method: 'POST',
    session: taSession.token,
    csrf: taSession.csrf,
  });
  console.log(`TA read-all response: ${markAllRes.status}`, markAllRes.data);

  // TA re-fetches announcements (simulating page reload)
  const taFetch4 = await apiRequest('/api/v1/tenant-portal/announcements', {
    method: 'GET',
    session: taSession.token,
    csrf: taSession.csrf,
  });
  const unreadAfter = taFetch4.data?.data?.filter((a) => !a.isRead).length || 0;
  console.log(`TA unread announcements count after reload: ${unreadAfter}`);

  // Check persistence in PostgreSQL (prisma.tenantNotice)
  const noticesInDb = await prisma.tenantNotice.findMany({
    where: {
      dormitoryId: PRIMARY_DORM_ID,
      tenantId: TA_TENANT_ID,
      isRead: true,
      sourceOutboxId: { startsWith: 'announcement:' },
    },
  });
  console.log(`Verified DB persistent read notices for TA: ${noticesInDb.length} records found in PostgreSQL.`);

  if (unreadAfter === 0 && noticesInDb.length > 0) {
    console.log('>>> AC P3-3 PASS: Unread count drops to 0 and persists across reloads in PostgreSQL DB.\n');
    results.p33 = true;
  } else {
    console.error('>>> AC P3-3 FAIL: Unread count did not drop to 0 or was not persisted.\n');
  }

  // =========================================================================
  // AC P3-4: TC (Former tenant) does not see announcements
  // =========================================================================
  console.log('============================================================');
  console.log('Running Check AC P3-4: Former Tenant Access Isolation');
  console.log('============================================================');

  const tcFetch = await apiRequest('/api/v1/tenant-portal/announcements', {
    method: 'GET',
    session: tcSession.token,
    csrf: tcSession.csrf,
  });

  console.log(`TC fetch status: ${tcFetch.status}`);
  console.log(`TC response data:`, tcFetch.data || tcFetch.text);

  const tcBlocked =
    tcFetch.status === 403 ||
    (tcFetch.status === 200 && Array.isArray(tcFetch.data?.data) && tcFetch.data.data.length === 0);

  if (tcBlocked) {
    console.log(`>>> AC P3-4 PASS: Former tenant TC cannot view announcements (status=${tcFetch.status}, data=${JSON.stringify(tcFetch.data?.data || tcFetch.data)}).\n`);
    results.p34 = true;
  } else {
    console.error('>>> AC P3-4 FAIL: Former tenant was able to access announcements.\n');
  }

  console.log('============================================================');
  console.log('SUMMARY OF CHECKS:');
  console.log(`- P3-1 (Targeted Announcement): ${results.p31 ? 'PASS' : 'FAIL'}`);
  console.log(`- P3-2 (Per-tenant Read Isolation): ${results.p32 ? 'PASS' : 'FAIL'}`);
  console.log(`- P3-3 (Mark All as Read & Persistence): ${results.p33 ? 'PASS' : 'FAIL'}`);
  console.log(`- P3-4 (Former Tenant Isolation): ${results.p34 ? 'PASS' : 'FAIL'}`);
  console.log('============================================================');

  if (Object.values(results).every(Boolean)) {
    console.log('\nAll ACs PASSED! Exiting with code 0.');
    process.exit(0);
  } else {
    console.error('\nSome ACs FAILED! Exiting with code 1.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running check-p3-live.mjs:', err);
  process.exit(1);
});
