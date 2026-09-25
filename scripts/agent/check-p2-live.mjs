/**
 * Live API and Database Verification Script for Card P2: แจ้งซ่อม (Tenant Maintenance & Repairs)
 * Target: https://app.hor-plus.com
 * Validates AC P2-1 to P2-5
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
const TC_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b'; // Somchai (TA)
const TC_USER_ID = '20000005-0000-4000-8000-000000000005';
const TC_ROOM_ID = '059c470e-82d7-4602-8e4b-c91537d0940f'; // Room 101

const TB_TENANT_ID = 'd6f6b099-d421-4b1e-8cf1-2f87c0b17aba'; // Somying (TB)
const TB_USER_ID = '4209cad5-8eff-4a7b-a1d2-2b6fdaf003e2';

const STAFF_ASSIGNED_MEMBER_ID = 'ab691e1c-dbf2-4b7f-9df6-8118ab332c6c'; // Surachai
const STAFF_ASSIGNED_USER_ID = '20000004-0000-4000-8000-000000000004';

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

async function createEphemeralSession(prisma, userId) {
  const sid = crypto.randomUUID();
  const sidHash = crypto.createHash('sha256').update(`horplus_sid_${sid}`).digest('hex');

  const rec = await prisma.session.create({
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
  return { rec, token, csrf };
}

async function main() {
  console.log('============================================================');
  console.log('  Card P2: Live Pilot Verification Script (app.hor-plus.com)');
  console.log('============================================================\n');

  const prisma = getPrismaClient();

  const ownerCreds = getCredentials('Owner');
  const staffAssignedCreds = getCredentials('Staff');
  const taCreds = getCredentials('Tenant');

  // Setup TB session
  const tbSession = await createEphemeralSession(prisma, TB_USER_ID);

  // Setup Unassigned Staff (Create user & member if needed)
  let unassignedStaffUser = await prisma.user.findFirst({
    where: { email: 'staff2.unassigned@horplus-uat.local' },
  });
  if (!unassignedStaffUser) {
    unassignedStaffUser = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: 'staff2.unassigned@horplus-uat.local',
        emailNormalized: 'staff2.unassigned@horplus-uat.local',
        googleSubject: 'google_sub_' + crypto.randomUUID(),
        name: 'นายช่าง สมใจ (Unassigned)',
        phone: '0899990002',
      },
    });
  }

  const staffRole = await prisma.role.findFirst({
    where: { dormitoryId: PRIMARY_DORM_ID, code: 'STAFF' },
  });

  let unassignedStaffMember = await prisma.dormitoryMember.findFirst({
    where: {
      dormitoryId: PRIMARY_DORM_ID,
      userId: unassignedStaffUser.id,
    },
  });
  if (!unassignedStaffMember) {
    unassignedStaffMember = await prisma.dormitoryMember.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: PRIMARY_DORM_ID,
        userId: unassignedStaffUser.id,
        roleId: staffRole ? staffRole.id : undefined,
        status: 'active',
      },
    });
  }

  const unassignedStaffSession = await createEphemeralSession(prisma, unassignedStaffUser.id);

  let createdRequestId1 = null;
  let createdRequestId2 = null;

  try {
    // =========================================================================
    // 1. [AC P2-1] TA submits repair request with image -> Owner sees request & image
    // =========================================================================
    console.log('--- 1. [AC P2-1] Tenant TA submits repair request with image ---');
    const mockImageBefore = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
    const resCreate = await fetch(`${APP_URL}/api/v1/tenant-portal/maintenance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${taCreds.session}`,
        'x-csrf-token': taCreds.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        category: 'plumbing',
        title: 'ท่อน้ำใต้อ่างล้างหน้ารั่วซึม P2-Live',
        description: 'น้ำหยดตลอดเวลา ทำให้พื้นห้องน้ำเปียกอย่างต่อเนื่อง',
        priority: 'medium',
        roomId: TC_ROOM_ID,
        imageBefore: mockImageBefore,
      }),
    });

    const dataCreate = await resCreate.json();
    console.log(`Create maintenance request status: ${resCreate.status}`, dataCreate);
    createdRequestId1 = dataCreate?.id || dataCreate?.data?.id;

    // Verify Owner sees request and image on /owner/maintenance
    const resOwnerList = await fetch(`${APP_URL}/api/v1/maintenance-requests/${createdRequestId1}`, {
      method: 'GET',
      headers: {
        Cookie: `horplus_session=${ownerCreds.session}`,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
    });
    const dataOwnerDetail = await resOwnerList.json();
    console.log(`Owner detail fetch status: ${resOwnerList.status}`, {
      id: dataOwnerDetail?.request?.id,
      title: dataOwnerDetail?.request?.title,
      roomId: dataOwnerDetail?.request?.roomId,
      hasImageBefore: !!dataOwnerDetail?.request?.imageBefore,
    });

    const passP21 =
      (resCreate.status === 201 || resCreate.status === 200) &&
      resOwnerList.status === 200 &&
      dataOwnerDetail?.request?.id === createdRequestId1 &&
      dataOwnerDetail?.request?.roomId === TC_ROOM_ID &&
      !!dataOwnerDetail?.request?.imageBefore;
    console.log(`Result P2-1: ${passP21 ? 'PASS' : 'FAIL'}\n`);

    // =========================================================================
    // 2. [AC P2-2] Owner assigns Staff -> Staff updates status to in_progress + notes -> TA sees
    // =========================================================================
    console.log('--- 2. [AC P2-2] Assigned Staff updates status to in_progress with note ---');
    const resAssign = await fetch(`${APP_URL}/api/v1/maintenance-requests/${createdRequestId1}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${ownerCreds.session}`,
        'x-csrf-token': ownerCreds.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        assignedMemberId: STAFF_ASSIGNED_MEMBER_ID,
      }),
    });
    const dataAssign = await resAssign.json();
    console.log(`Owner assign staff status: ${resAssign.status}`, dataAssign);

    const technicianNote = 'ช่างรับงานแล้ว กำลังเดินทางไปตรวจสอบระบบท่อใต้อ่างล้างหน้า';
    const resStaffUpdate = await fetch(`${APP_URL}/api/v1/maintenance-requests/${createdRequestId1}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${staffAssignedCreds.session}`,
        'x-csrf-token': staffAssignedCreds.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        status: 'in_progress',
        note: technicianNote,
      }),
    });
    const dataStaffUpdate = await resStaffUpdate.json();
    console.log(`Assigned staff status update status: ${resStaffUpdate.status}`, dataStaffUpdate);

    // TA views request in tenant portal
    const resTenantDetail = await fetch(`${APP_URL}/api/v1/tenant-portal/maintenance/${createdRequestId1}`, {
      method: 'GET',
      headers: {
        Cookie: `horplus_session=${taCreds.session}`,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
    });
    const dataTenantDetail = await resTenantDetail.json();
    console.log(`Tenant view detail status: ${resTenantDetail.status}`, {
      status: dataTenantDetail?.data?.request?.status,
      note: dataTenantDetail?.data?.request?.note,
    });

    const passP22 =
      resAssign.status === 200 &&
      resStaffUpdate.status === 200 &&
      resTenantDetail.status === 200 &&
      dataTenantDetail?.data?.request?.status === 'in_progress' &&
      dataTenantDetail?.data?.request?.note === technicianNote;
    console.log(`Result P2-2: ${passP22 ? 'PASS' : 'FAIL'}\n`);

    // =========================================================================
    // 3. [AC P2-3] TA cancels repair before work starts; in_progress cancellation rejected (400)
    // =========================================================================
    console.log('--- 3. [AC P2-3] Tenant cancellation rules ---');
    // Create second request for cancellation in submitted status
    const resCreate2 = await fetch(`${APP_URL}/api/v1/tenant-portal/maintenance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${taCreds.session}`,
        'x-csrf-token': taCreds.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        category: 'general',
        title: 'กลอนประตูด้านหน้าฝืด P2-Cancel-Live',
        description: 'เปิดปิดค่อนข้างยาก ขอยกเลิกเพราะหยอดน้ำมันแล้วหาย',
        priority: 'low',
        roomId: TC_ROOM_ID,
      }),
    });
    const dataCreate2 = await resCreate2.json();
    createdRequestId2 = dataCreate2?.id || dataCreate2?.data?.id;
    console.log(`Create second maintenance request status: ${resCreate2.status}`, { id: createdRequestId2 });

    // Cancel second request (status is submitted)
    const resCancel2 = await fetch(`${APP_URL}/api/v1/tenant-portal/maintenance/${createdRequestId2}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${taCreds.session}`,
        'x-csrf-token': taCreds.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        reason: 'ผู้เช่าหยอดน้ำมันเองแล้ว ใช้งานได้ปกติ',
      }),
    });
    const dataCancel2 = await resCancel2.json();
    console.log(`Tenant cancel submitted request status: ${resCancel2.status}`, dataCancel2);

    // Attempt to cancel first request (status is in_progress) -> should reject with 400
    const resCancelInProgress = await fetch(`${APP_URL}/api/v1/tenant-portal/maintenance/${createdRequestId1}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${taCreds.session}`,
        'x-csrf-token': taCreds.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        reason: 'ขอยกเลิกขณะช่างกำลังซ่อม',
      }),
    });
    const dataCancelInProgress = await resCancelInProgress.json();
    console.log(`Tenant cancel in_progress request status: ${resCancelInProgress.status}`, dataCancelInProgress);

    const passP23 =
      resCancel2.status === 200 &&
      dataCancel2?.data?.status === 'cancelled' &&
      resCancelInProgress.status === 400 &&
      dataCancelInProgress?.error?.message?.includes('สามารถยกเลิกได้เฉพาะก่อนที่ช่างจะเริ่มดำเนินงานซ่อม');
    console.log(`Result P2-3: ${passP23 ? 'PASS' : 'FAIL'}\n`);

    // =========================================================================
    // 4. [AC P2-4] Cross-tenant isolation: TB accessing or cancelling TA's request is 403 Forbidden
    // =========================================================================
    console.log('--- 4. [AC P2-4] Cross-tenant isolation (TB accessing TA request) ---');
    // TB tries to GET TA's request
    const resTbGet = await fetch(`${APP_URL}/api/v1/tenant-portal/maintenance/${createdRequestId1}`, {
      method: 'GET',
      headers: {
        Cookie: `horplus_session=${tbSession.token}`,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
    });
    const dataTbGet = await resTbGet.json();
    console.log(`TB GET TA request status: ${resTbGet.status}`, dataTbGet);

    // TB tries to Cancel TA's request
    const resTbCancel = await fetch(`${APP_URL}/api/v1/tenant-portal/maintenance/${createdRequestId1}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${tbSession.token}`,
        'x-csrf-token': tbSession.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        reason: 'TB แอบยกเลิกแทน',
      }),
    });
    const dataTbCancel = await resTbCancel.json();
    console.log(`TB cancel TA request status: ${resTbCancel.status}`, dataTbCancel);

    const passP24 =
      resTbGet.status === 403 &&
      dataTbGet?.error?.code === 'FORBIDDEN' &&
      resTbCancel.status === 403 &&
      dataTbCancel?.error?.code === 'FORBIDDEN';
    console.log(`Result P2-4: ${passP24 ? 'PASS' : 'FAIL'}\n`);

    // =========================================================================
    // 5. [AC P2-5] Unassigned Staff access control: 403 Forbidden and excluded from list
    // =========================================================================
    console.log('--- 5. [AC P2-5] Unassigned Staff access control ---');
    // Unassigned Staff tries to GET TA's request
    const resUnassignedGet = await fetch(`${APP_URL}/api/v1/maintenance-requests/${createdRequestId1}`, {
      method: 'GET',
      headers: {
        Cookie: `horplus_session=${unassignedStaffSession.token}`,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
    });
    const dataUnassignedGet = await resUnassignedGet.json();
    console.log(`Unassigned Staff GET TA request status: ${resUnassignedGet.status}`, dataUnassignedGet);

    // Unassigned Staff tries to update status of TA's request
    const resUnassignedUpdate = await fetch(`${APP_URL}/api/v1/maintenance-requests/${createdRequestId1}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${unassignedStaffSession.token}`,
        'x-csrf-token': unassignedStaffSession.csrf,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
      body: JSON.stringify({
        status: 'completed',
        note: 'ช่างที่ไม่ได้รับมอบหมายแอบเปลี่ยนสถานะ',
      }),
    });
    const dataUnassignedUpdate = await resUnassignedUpdate.json();
    console.log(`Unassigned Staff status update status: ${resUnassignedUpdate.status}`, dataUnassignedUpdate);

    // Unassigned Staff queries assigned jobs list
    const resUnassignedList = await fetch(`${APP_URL}/api/v1/maintenance-requests`, {
      method: 'GET',
      headers: {
        Cookie: `horplus_session=${unassignedStaffSession.token}`,
        'x-dormitory-id': PRIMARY_DORM_ID,
      },
    });
    const dataUnassignedList = await resUnassignedList.json();
    const items = dataUnassignedList?.items || [];
    const containsTaJob = items.some((item) => item.id === createdRequestId1);
    console.log(`Unassigned Staff list count: ${items.length}, contains TA job: ${containsTaJob}`);

    const passP25 =
      resUnassignedGet.status === 403 &&
      dataUnassignedGet?.error?.code === 'FORBIDDEN' &&
      resUnassignedUpdate.status === 403 &&
      dataUnassignedUpdate?.error?.code === 'FORBIDDEN' &&
      !containsTaJob;
    console.log(`Result P2-5: ${passP25 ? 'PASS' : 'FAIL'}\n`);

    // Summary
    console.log('=== Summary of Card P2 Live Checks ===');
    console.log(`P2-1 (Tenant Submit with Image & Owner View): ${passP21 ? 'PASS' : 'FAIL'}`);
    console.log(`P2-2 (Assigned Staff In-Progress & Notes):     ${passP22 ? 'PASS' : 'FAIL'}`);
    console.log(`P2-3 (Cancellation Rules & In-Progress Block): ${passP23 ? 'PASS' : 'FAIL'}`);
    console.log(`P2-4 (Cross-Tenant Isolation 403):             ${passP24 ? 'PASS' : 'FAIL'}`);
    console.log(`P2-5 (Unassigned Staff Access Control 403):    ${passP25 ? 'PASS' : 'FAIL'}`);

    if (passP21 && passP22 && passP23 && passP24 && passP25) {
      console.log('\n🎉 ALL CARD P2 LIVE CHECKS PASSED!');
      process.exit(0);
    } else {
      console.error('\n❌ SOME CHECKS FAILED!');
      process.exit(1);
    }
  } finally {
    // Cleanup sessions
    await prisma.session.delete({ where: { id: tbSession.rec.id } }).catch(() => {});
    await prisma.session.delete({ where: { id: unassignedStaffSession.rec.id } }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('Fatal error during Card P2 checks:', err);
  process.exit(1);
});
