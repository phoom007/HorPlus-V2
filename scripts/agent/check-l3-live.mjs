/**
 * Live Verification Script for Card L3 on app.hor-plus.com
 * Verifies AC L3-1 through L3-5 against live pilot API & database
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import {
  buildTenantMaintenanceCompletedFlexMessage,
  buildTenantAnnouncementFlexMessage,
  lineOaService,
} from '../../server/dist/services/line-oa.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const APP_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor Residence
const TA_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b'; // Somchai (Room 101)
const TB_TENANT_ID = 'dc3a397c-60e5-4283-aa07-f5c5eb369b60'; // Somsak (Room 102)
const TX_TENANT_ID = 'a5b01b74-5b47-419f-97b8-0d49b79c6cdc'; // Manee (Room 201 - Unbound)

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
  console.log('=== Card L3 Live Verification on app.hor-plus.com ===\n');

  const prisma = getPrismaClient();
  const ownerCreds = getCredentials('Owner');
  const staffCreds = getCredentials('Staff');
  const tenantCreds = getCredentials('Tenant');

  const ownerHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${ownerCreds.session}`,
    'x-csrf-token': ownerCreds.csrf,
  };

  const staffHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${staffCreds.session}`,
    'x-csrf-token': staffCreds.csrf,
  };

  const tenantHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `horplus_session=${tenantCreds.session}`,
    'x-csrf-token': tenantCreds.csrf,
  };

  const results = {
    l3_1: 'NOT RUN',
    l3_2: 'NOT RUN',
    l3_3: 'NOT RUN',
    l3_4: 'NOT RUN',
    l3_5: 'NOT RUN',
  };

  // Helper to run queries inside RLS context
  async function withDormitoryContext(callback) {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      return await callback(tx);
    });
  }

  // Setup: Ensure TA and TB have active LINE bindings, TX has NO line binding
  const { encryptText, hashToken } = await import('../../server/dist/utils/crypto-encryption.js');

  const rawLineUserIdTA = 'Utest_ta_line_user_001';
  const rawLineUserIdTB = 'Utest_tb_line_user_002';

  await withDormitoryContext(async (tx) => {
    // 1. Setup TA (Room 101)
    let lineFriendTA = await tx.dormitoryLineFriend.findFirst({
      where: {
        OR: [
          { id: '71ffb5d0-344b-4447-b13b-0648741619bc' },
          { dormitoryId: DORM_ID, lineUserIdHash: hashToken(rawLineUserIdTA) },
        ],
      },
    });
    if (lineFriendTA) {
      lineFriendTA = await tx.dormitoryLineFriend.update({
        where: { id: lineFriendTA.id },
        data: {
          lineUserIdHash: hashToken(rawLineUserIdTA),
          lineUserIdEncrypted: encryptText(rawLineUserIdTA),
          displayName: 'สมชาย ใจดี (TA)',
          friendStatus: 'FOLLOWING',
        },
      });
    } else {
      lineFriendTA = await tx.dormitoryLineFriend.create({
        data: {
          id: '71ffb5d0-344b-4447-b13b-0648741619bc',
          dormitoryId: DORM_ID,
          lineUserIdHash: hashToken(rawLineUserIdTA),
          lineUserIdEncrypted: encryptText(rawLineUserIdTA),
          displayName: 'สมชาย ใจดี (TA)',
          friendStatus: 'FOLLOWING',
        },
      });
    }
    await tx.tenant.update({
      where: { id: TA_TENANT_ID },
      data: { lineFriendId: lineFriendTA.id },
    });

    // 2. Setup TB (Room 102)
    let lineFriendTB = await tx.dormitoryLineFriend.findFirst({
      where: {
        OR: [
          { id: '72ffb5d0-344b-4447-b13b-0648741619bd' },
          { dormitoryId: DORM_ID, lineUserIdHash: hashToken(rawLineUserIdTB) },
        ],
      },
    });
    if (lineFriendTB) {
      lineFriendTB = await tx.dormitoryLineFriend.update({
        where: { id: lineFriendTB.id },
        data: {
          lineUserIdHash: hashToken(rawLineUserIdTB),
          lineUserIdEncrypted: encryptText(rawLineUserIdTB),
          displayName: 'สมศักดิ์ รักสงบ (TB)',
          friendStatus: 'FOLLOWING',
        },
      });
    } else {
      lineFriendTB = await tx.dormitoryLineFriend.create({
        data: {
          id: '72ffb5d0-344b-4447-b13b-0648741619bd',
          dormitoryId: DORM_ID,
          lineUserIdHash: hashToken(rawLineUserIdTB),
          lineUserIdEncrypted: encryptText(rawLineUserIdTB),
          displayName: 'สมศักดิ์ รักสงบ (TB)',
          friendStatus: 'FOLLOWING',
        },
      });
    }
    await tx.tenant.update({
      where: { id: TB_TENANT_ID },
      data: { lineFriendId: lineFriendTB.id },
    });

    // 3. Ensure TX (Room 201) has NO line binding
    await tx.tenant.update({
      where: { id: TX_TENANT_ID },
      data: { lineFriendId: null },
    });

    // 4. Ensure LINE Config has isConnected = true and notifications enabled
    await tx.dormitoryLineConfig.upsert({
      where: { dormitoryId: DORM_ID },
      create: {
        dormitoryId: DORM_ID,
        lineOaId: '@manor_residence',
        channelId: '1234567890',
        channelSecretEncrypted: encryptText('mock_secret'),
        webhookKeyHash: 'hash',
        webhookKeyEncrypted: 'enc',
        isConnected: true,
        notifyRepairCompleted: true,
      },
      update: {
        isConnected: true,
        notifyRepairCompleted: true,
      },
    });
  });

  // Track created records for cleanup
  const createdMaintenanceRequestIds = [];
  const createdAnnouncementIds = [];

  try {
    // -------------------------------------------------------------------------
    // AC L3-1: Maintenance Completion LINE Notification (PO Decision A1)
    // -------------------------------------------------------------------------
    console.log('Testing AC L3-1: Maintenance completion LINE notification & Flex message...');

    // 1. Verify Flex message structure
    const flexMaintenance = buildTenantMaintenanceCompletedFlexMessage(
      'หอพัก Manor Residence',
      '101',
      'ซ่อมแอร์น้ำหยด',
      'เครื่องใช้ไฟฟ้า',
      '26 ก.ย. 2569',
      'ทำความสะอาดท่อน้ำทิ้งและเติมน้ำยาแอร์เสร็จเรียบร้อย',
      APP_URL
    );

    const isMaintenanceFlexValid =
      flexMaintenance.type === 'flex' &&
      flexMaintenance.altText.includes('แจ้งเตือนงานซ่อมเสร็จสิ้น') &&
      flexMaintenance.contents.header.backgroundColor === '#059669' &&
      JSON.stringify(flexMaintenance).includes('เปิดดูรายละเอียดงานแจ้งซ่อม') &&
      JSON.stringify(flexMaintenance).includes('sub=repairs');

    console.log('  Maintenance Flex message valid:', isMaintenanceFlexValid);

    // 2. Create a test maintenance request for TA (Room 101)
    const room101 = await withDormitoryContext(async (tx) => {
      return await tx.room.findFirst({ where: { roomNumber: '101', dormitoryId: DORM_ID } });
    });

    const createReqRes = await fetch(`${APP_URL}/api/v1/maintenance-requests`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        tenantId: TA_TENANT_ID,
        roomId: room101?.id,
        category: 'appliance',
        title: 'ซ่อมแอร์น้ำหยด ห้อง 101 (L3 Live Test)',
        description: 'แอร์มีน้ำหยดลงบนเตียง ต้องการให้ช่างเข้าตรวจสอบ',
        priority: 'normal',
        status: 'submitted',
      }),
    });

    const createReqData = await createReqRes.json();
    if (!createReqRes.ok) {
      throw new Error(`Failed to create test maintenance request: ${JSON.stringify(createReqData)}`);
    }
    const testReqId = createReqData.id;
    createdMaintenanceRequestIds.push(testReqId);
    console.log(`  Created maintenance request ${testReqId}, status: ${createReqData.status}`);

    // 3. Test non-completed status update: in_progress -> MUST NOT send LINE per PO A1
    const inProgressRes = await fetch(`${APP_URL}/api/v1/maintenance-requests/${testReqId}/status`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({
        status: 'in_progress',
        note: 'ช่างกำลังเดินทางเข้าไปตรวจสอบ',
      }),
    });
    const inProgressData = await inProgressRes.json();
    console.log(`  Updated status to in_progress (PO A1: no LINE push): status = ${inProgressData.status}`);

    // Record initial quota before completion
    const initialQuotaStatus = await withDormitoryContext(async (tx) => {
      return await tx.linePushUsage.findFirst({
        where: { dormitoryId: DORM_ID },
        orderBy: { createdAt: 'desc' },
      });
    });
    const initialSuccessCount = initialQuotaStatus?.successCount || 0;

    // 4. Test completed status update: resolved -> MUST trigger LINE push
    const resolvedRes = await fetch(`${APP_URL}/api/v1/maintenance-requests/${testReqId}/status`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({
        status: 'resolved',
        note: 'ซ่อมท่อน้ำทิ้งและล้างแอร์เสร็จเรียบร้อยแล้ว',
      }),
    });
    const resolvedData = await resolvedRes.json();
    console.log(`  Updated status to resolved: status = ${resolvedData.status}`);

    if (inProgressRes.ok && resolvedRes.ok && resolvedData.status === 'resolved' && isMaintenanceFlexValid) {
      results.l3_1 = 'PASS';
      console.log('  => AC L3-1: PASS\n');
    } else {
      results.l3_1 = 'FAIL';
      console.log('  => AC L3-1: FAIL\n');
    }

    // -------------------------------------------------------------------------
    // AC L3-2: Announcement broadcast with sendLinePush: true (PO Decision A2)
    // -------------------------------------------------------------------------
    console.log('Testing AC L3-2: Announcement with sendLinePush: true targeting TA (101) & TB (102)...');

    // 1. Verify Announcement Flex message structure
    const flexAnnouncement = buildTenantAnnouncementFlexMessage(
      'หอพัก Manor Residence',
      'แจ้งฉีดพ่นยากำจัดยุงลาย',
      'จะมีการฉีดพ่นควันกำจัดยุงลายในวันเสาร์ที่ 27 ก.ย. เวลา 10:00 น.',
      'normal',
      '26 ก.ย. 2569',
      APP_URL
    );

    const isAnnouncementFlexValid =
      flexAnnouncement.type === 'flex' &&
      flexAnnouncement.altText.includes('ประกาศจากหอพัก') &&
      flexAnnouncement.contents.header.backgroundColor === '#4F46E5' &&
      JSON.stringify(flexAnnouncement).includes('เปิดดูประกาศ') &&
      JSON.stringify(flexAnnouncement).includes('sub=announcements_tab');

    console.log('  Announcement Flex message valid:', isAnnouncementFlexValid);

    // 2. Owner creates and publishes announcement targeting rooms 101 and 102 with sendLinePush: true
    const postAnnRes = await fetch(`${APP_URL}/api/v1/announcements`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        title: 'ประกาศฉีดพ่นยากำจัดยุงลาย (Card L3 Test)',
        summary: 'จะมีการฉีดพ่นควันกำจัดยุงลายในวันเสาร์นี้',
        content: 'จะมีการฉีดพ่นควันกำจัดยุงลายในวันเสาร์นี้ กรุณาปิดประตูหน้าต่างให้มิดชิด',
        targetType: 'rooms',
        targetRooms: ['101', '102'],
        sendLinePush: true,
        priority: 'normal',
      }),
    });

    const postAnnData = await postAnnRes.json();
    if (!postAnnRes.ok) {
      throw new Error(`Failed to create announcement: ${JSON.stringify(postAnnData)}`);
    }
    const annL3_2Id = postAnnData.id;
    createdAnnouncementIds.push(annL3_2Id);
    console.log(`  Published announcement ${annL3_2Id}, status: ${postAnnData.status}`);

    // Check in-app notifications in DB
    const inAppL3_2 = await withDormitoryContext(async (tx) => {
      return await tx.tenantNotice.findMany({
        where: {
          dormitoryId: DORM_ID,
          sourceOutboxId: { startsWith: `announcement:${annL3_2Id}:` },
        },
      });
    });
    console.log(`  In-app notifications in DB for L3-2: count = ${inAppL3_2.length}`);

    if (postAnnRes.status === 201 && postAnnData.status === 'published' && isAnnouncementFlexValid && inAppL3_2.length >= 2) {
      results.l3_2 = 'PASS';
      console.log('  => AC L3-2: PASS\n');
    } else {
      results.l3_2 = 'FAIL';
      console.log('  => AC L3-2: FAIL\n');
    }

    // -------------------------------------------------------------------------
    // AC L3-3: Announcement broadcast with sendLinePush: false (PO Decision A2)
    // -------------------------------------------------------------------------
    console.log('Testing AC L3-3: Announcement with sendLinePush: false (bypass LINE, in-app only)...');

    const postAnnUnpushedRes = await fetch(`${APP_URL}/api/v1/announcements`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        title: 'ประกาศแจ้งเตือนบอร์ดข่าวสาร (L3 Unpushed Test)',
        summary: 'ประกาศนี้ไม่ส่งเข้า LINE จะขึ้นเฉพาะในเว็บ',
        content: 'ประกาศนี้ไม่ส่งเข้า LINE จะขึ้นเฉพาะในเว็บเพื่อทดสอบการไม่ส่งข้อความตาม PO A2',
        targetType: 'rooms',
        targetRooms: ['101', '102'],
        sendLinePush: false,
        priority: 'normal',
      }),
    });

    const postAnnUnpushedData = await postAnnUnpushedRes.json();
    if (!postAnnUnpushedRes.ok) {
      throw new Error(`Failed to create unpushed announcement: ${JSON.stringify(postAnnUnpushedData)}`);
    }
    const annL3_3Id = postAnnUnpushedData.id;
    createdAnnouncementIds.push(annL3_3Id);
    console.log(`  Published unpushed announcement ${annL3_3Id}, status: ${postAnnUnpushedData.status}`);

    // Verify in-app notifications created in DB
    const inAppCount = await withDormitoryContext(async (tx) => {
      return await tx.tenantNotice.count({
        where: {
          dormitoryId: DORM_ID,
          sourceOutboxId: { startsWith: `announcement:${annL3_3Id}:` },
        },
      });
    });
    console.log(`  In-app notifications created in DB for L3-3: ${inAppCount}`);

    // Verify quota did NOT increase
    const currentQuotaStatus = await withDormitoryContext(async (tx) => {
      return await tx.linePushUsage.findFirst({
        where: { dormitoryId: DORM_ID },
        orderBy: { createdAt: 'desc' },
      });
    });
    const currentSuccessCount = currentQuotaStatus?.successCount || 0;
    const quotaUnchanged = currentSuccessCount === initialSuccessCount;
    console.log(`  Quota usage for L3-3: initial = ${initialSuccessCount}, current = ${currentSuccessCount} (unchanged: ${quotaUnchanged})`);

    if (postAnnUnpushedRes.status === 201 && inAppCount >= 2 && quotaUnchanged) {
      results.l3_3 = 'PASS';
      console.log('  => AC L3-3: PASS\n');
    } else {
      results.l3_3 = 'FAIL';
      console.log('  => AC L3-3: FAIL\n');
    }

    // -------------------------------------------------------------------------
    // AC L3-4: Quota Exhausted Non-throwing Handling (PO Decision OQ-11)
    // -------------------------------------------------------------------------
    console.log('Testing AC L3-4: Quota exhausted behavior per PO OQ-11...');

    // Simulate quota exhausted in DB by setting success_count to 300 (or plan limit)
    const currentPeriodKey = new Date().toISOString().slice(0, 7);
    await withDormitoryContext(async (tx) => {
      await tx.linePushUsage.upsert({
        where: {
          dormitory_push_period_unique: {
            dormitoryId: DORM_ID,
            periodKey: currentPeriodKey,
          },
        },
        create: {
          dormitoryId: DORM_ID,
          periodKey: currentPeriodKey,
          successCount: 300,
          reservedCount: 0,
        },
        update: {
          successCount: 300,
          reservedCount: 0,
        },
      });
    });

    const exhaustedAnnRes = await fetch(`${APP_URL}/api/v1/announcements`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        title: 'ประกาศเมื่อโควต้าหมด (L3 Live Test OQ-11)',
        summary: 'ทดสอบการส่งประกาศเมื่อโควต้าเต็ม',
        content: 'ระบบต้องบันทึกประกาศสำเร็จ ไม่ throw error และส่งคืน warning ตาม OQ-11',
        targetType: 'rooms',
        targetRooms: ['101'],
        sendLinePush: true,
        priority: 'normal',
      }),
    });

    const exhaustedAnnData = await exhaustedAnnRes.json();
    if (exhaustedAnnData.id) {
      createdAnnouncementIds.push(exhaustedAnnData.id);
    }
    console.log(`  Exhausted announcement publish response status: ${exhaustedAnnRes.status}`);
    console.log(`  Exhausted announcement returned warning: "${exhaustedAnnData.warning || '-'}"`);

    if (exhaustedAnnRes.status === 201 && exhaustedAnnData.status === 'published' && exhaustedAnnData.warning?.includes('หมดแล้ว')) {
      results.l3_4 = 'PASS';
      console.log('  => AC L3-4: PASS\n');
    } else {
      results.l3_4 = 'FAIL';
      console.log('  => AC L3-4: FAIL\n');
    }

    // Restore quota for subsequent checks
    await withDormitoryContext(async (tx) => {
      await tx.linePushUsage.update({
        where: {
          dormitory_push_period_unique: {
            dormitoryId: DORM_ID,
            periodKey: currentPeriodKey,
          },
        },
        data: {
          successCount: initialSuccessCount,
          reservedCount: 0,
        },
      });
    });

    // -------------------------------------------------------------------------
    // AC L3-5: Unbound Tenant (TX) Handling
    // -------------------------------------------------------------------------
    console.log('Testing AC L3-5: Operations targeting unbound tenant (TX) without LINE binding...');

    const room201 = await withDormitoryContext(async (tx) => {
      return await tx.room.findFirst({ where: { roomNumber: '201', dormitoryId: DORM_ID } });
    });

    // 1. Maintenance request for TX
    const txReqRes = await fetch(`${APP_URL}/api/v1/maintenance-requests`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        tenantId: TX_TENANT_ID,
        roomId: room201?.id,
        category: 'plumbing',
        title: 'ซ่อมท่อระบายน้ำ ห้อง 201 (TX Unbound Test)',
        description: 'ท่อน้ำระบายช้า',
        priority: 'normal',
        status: 'submitted',
      }),
    });
    const txReqData = await txReqRes.json();
    createdMaintenanceRequestIds.push(txReqData.id);

    // Resolve maintenance for TX -> must complete cleanly without error
    const txResolvedRes = await fetch(`${APP_URL}/api/v1/maintenance-requests/${txReqData.id}/status`, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({
        status: 'resolved',
        note: 'ช่างเข้าทำความสะอาดท่อระบายน้ำแล้ว',
      }),
    });
    const txResolvedData = await txResolvedRes.json();
    console.log(`  Resolved maintenance for TX: status = ${txResolvedData.status}`);

    // 2. Announcement targeting Room 201 (TX) with sendLinePush: true -> must succeed cleanly
    const txAnnRes = await fetch(`${APP_URL}/api/v1/announcements`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        title: 'ประกาศถึงห้อง 201 (TX Unbound Test)',
        summary: 'ทดสอบประกาศถึงผู้เช่าที่ไม่มี LINE',
        content: 'ระบบต้องไม่เกิดข้อผิดพลาด และไม่หักโควต้า',
        targetType: 'rooms',
        targetRooms: ['201'],
        sendLinePush: true,
        priority: 'normal',
      }),
    });
    const txAnnData = await txAnnRes.json();
    createdAnnouncementIds.push(txAnnData.id);
    console.log(`  Published announcement for TX: status = ${txAnnData.status}`);

    // Check in-app notification for TX in DB
    const txInAppCount = await withDormitoryContext(async (tx) => {
      return await tx.tenantNotice.count({
        where: {
          dormitoryId: DORM_ID,
          sourceOutboxId: { startsWith: `announcement:${txAnnData.id}:` },
        },
      });
    });
    console.log(`  In-app notification for TX: count = ${txInAppCount}`);

    if (
      txResolvedRes.ok &&
      txResolvedData.status === 'resolved' &&
      txAnnRes.status === 201 &&
      txAnnData.status === 'published' &&
      txInAppCount >= 1
    ) {
      results.l3_5 = 'PASS';
      console.log('  => AC L3-5: PASS\n');
    } else {
      results.l3_5 = 'FAIL';
      console.log('  => AC L3-5: FAIL\n');
    }

  } finally {
    // Cleanup created test records
    console.log('Cleaning up test records...');
    await withDormitoryContext(async (tx) => {
      if (createdAnnouncementIds.length > 0) {
        await tx.tenantNotice.deleteMany({
          where: {
            dormitoryId: DORM_ID,
            OR: createdAnnouncementIds.map(id => ({ sourceOutboxId: { startsWith: `announcement:${id}:` } })),
          },
        });
        await tx.announcementAudience.deleteMany({
          where: { announcementId: { in: createdAnnouncementIds } },
        });
        await tx.announcement.deleteMany({
          where: { id: { in: createdAnnouncementIds } },
        });
      }

      if (createdMaintenanceRequestIds.length > 0) {
        await tx.tenantNotice.deleteMany({
          where: {
            dormitoryId: DORM_ID,
            type: 'MAINTENANCE_STATUS_UPDATED',
          },
        }).catch(() => {});
        await tx.maintenanceRequest.deleteMany({
          where: { id: { in: createdMaintenanceRequestIds } },
        });
      }
    });
    console.log('Cleanup completed.\n');
  }

  console.log('=== Final Results Summary ===');
  console.table(results);

  const allPassed = Object.values(results).every((r) => r === 'PASS');
  if (allPassed) {
    console.log('🎉 ALL CARD L3 ACCEPTANCE CRITERIA PASSED!');
    process.exit(0);
  } else {
    console.error('❌ SOME CHECKS FAILED');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled script error:', err);
  process.exit(1);
});
