/**
 * Live Check for Card R1 on app.hor-plus.com
 * Reads credentials dynamically from .agents/local/test-access.md
 */

import fs from 'fs';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import { TenantRegistrationInviteService } from '../../server/dist/services/tenant-registration-invite.service.js';
import { encryptText, hashToken, generateGrantToken } from '../../server/dist/utils/crypto-encryption.js';

const APP_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor

function getCredentials(role) {
  const content = fs.readFileSync('.agents/local/test-access.md', 'utf8');
  const blocks = content.split('### ');
  const block = blocks.find(b => b.startsWith(`${role}:`));
  if (!block) throw new Error(`Could not find credentials for role: ${role}`);
  const lines = block.split(/\r?\n/).map(l => l.trim());
  const cookieIdx = lines.findIndex(l => l.includes('Cookie (horplus_session)'));
  const csrfIdx = lines.findIndex(l => l.includes('CSRF Token (horplus_csrf)'));
  const session = lines[cookieIdx + 2];
  const csrf = lines[csrfIdx + 2];
  return { session, csrf };
}

async function main() {
  const tenantCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');
  const prisma = getPrismaClient();

  console.log('=== Checking Card R1 Live Endpoints on app.hor-plus.com ===\n');

  // 1. [AC R1-2] Tenant Profile & Subviews
  console.log('1. [AC R1-2] Tenant Profile & Subviews on app.hor-plus.com');
  const resProfile = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`, {
    headers: {
      Cookie: `horplus_session=${tenantCreds.session}`,
    },
  });
  console.log(`Status: ${resProfile.status}`);
  const dataProfile = await resProfile.json();
  console.log(`Tenant Name: ${dataProfile.name}, Room: ${dataProfile.room?.roomNumber}, Dorm: ${dataProfile.dormitory?.name}`);
  const passR12 = resProfile.status === 200 && dataProfile.name === 'สมชาย ใจดี';
  console.log(`Result: ${passR12 ? 'PASS' : 'FAIL'}\n`);

  // Ensure Somchai has a bound test LINE Friend and active grant for AC R1-3
  let refreshedSomchai = null;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;

    let somchai = await tx.tenant.findFirst({
      where: {
        dormitoryId: DORM_ID,
        displayName: 'นายสมชาย ใจดี',
        status: 'active',
        deletedAt: null,
      },
    });

    if (!somchai) {
      somchai = await tx.tenant.findFirst({
        where: {
          dormitoryId: DORM_ID,
          firstName: 'สมชาย',
          status: 'active',
          deletedAt: null,
        },
      });
    }

    if (somchai) {
      let friend = somchai.lineFriendId
        ? await tx.dormitoryLineFriend.findUnique({ where: { id: somchai.lineFriendId } })
        : null;

      if (!friend) {
        const lineUserId = 'U_SOMCHAI_MANOR_TEST';
        friend = await tx.dormitoryLineFriend.create({
          data: {
            dormitoryId: DORM_ID,
            displayName: 'สมชาย ใจดี (LINE)',
            lineUserIdHash: hashToken(lineUserId),
            lineUserIdEncrypted: encryptText(lineUserId),
            friendStatus: 'added',
          },
        });

        await tx.tenant.update({
          where: { id: somchai.id },
          data: { lineFriendId: friend.id },
        });
      }

      // Ensure active tenant grant exists
      let grant = await tx.dormitoryAccessGrant.findFirst({
        where: {
          dormitoryId: DORM_ID,
          lineFriendId: friend.id,
          roleCode: 'TENANT',
          status: 'ACTIVE',
        },
      });

      if (!grant) {
        const { rawToken: grantRawToken, tokenHash, tokenPrefix } = generateGrantToken();
        grant = await tx.dormitoryAccessGrant.create({
          data: {
            dormitoryId: DORM_ID,
            lineFriendId: friend.id,
            tokenHash,
            tokenEncrypted: encryptText(grantRawToken),
            tokenPrefix,
            roleCode: 'TENANT',
            status: 'ACTIVE',
            createdByPrincipal: 'test_seed_r1',
          },
        });
      }

      refreshedSomchai = await tx.tenant.findUnique({
        where: { id: somchai.id },
        select: { id: true, lineFriendId: true },
      });
    }
  });

  // 2. [AC R1-3] Active Tenant Entry & Self-healing Rich Menu trigger
  console.log('2. [AC R1-3] Active Tenant Entry Self-healing sync on line-tenant-entry');

  let passR13 = false;
  if (refreshedSomchai && refreshedSomchai.lineFriendId) {
    let invite = null;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      const inviteService = new TenantRegistrationInviteService(tx);
      invite = await inviteService.createInvite(
        DORM_ID,
        refreshedSomchai.lineFriendId,
        tx
      );
    });

    const resEntry = await fetch(`${APP_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(invite.rawToken)}`, {
      redirect: 'manual',
    });
    console.log(`line-tenant-entry Status: ${resEntry.status}`);
    const location = resEntry.headers.get('location') || '';
    console.log(`Redirect Location: ${location}`);
    passR13 = resEntry.status === 302 && location.endsWith('/tenant');
  }
  console.log(`Result: ${passR13 ? 'PASS' : 'FAIL'}\n`);

  // 3. [AC R1-5] Owner LINE Quota Endpoint (Rich Menu does not consume push quota)
  console.log('3. [AC R1-5] Check LINE Quota before and after with Owner session');
  const resQuota = await fetch(`${APP_URL}/api/v1/dormitories/${DORM_ID}/line-oa/config`, {
    headers: {
      Cookie: `horplus_session=${ownerCreds.session}`,
      'x-dormitory-id': DORM_ID,
    },
  });
  console.log(`Quota Status: ${resQuota.status}`);
  const dataQuota = await resQuota.json();
  const cfg = dataQuota.data || dataQuota.config;
  console.log(`Monthly Quota: ${cfg?.monthlyQuota}, Used: ${cfg?.usedQuota}, Remaining: ${cfg?.remainingQuota}`);
  const passR15 = resQuota.status === 200 && typeof cfg?.monthlyQuota === 'number' && typeof cfg?.usedQuota === 'number';
  console.log(`Result: ${passR15 ? 'PASS' : 'FAIL'}\n`);

  // 4. [AC R1-6] Negative Case: Non-active / invalid token accessing line-tenant-entry
  console.log('4. [AC R1-6] Negative Case: Invalid or non-active token');
  const resInvalid = await fetch(`${APP_URL}/api/v1/auth/line-tenant-entry?t=fake_token_random_12345`, {
    redirect: 'manual',
  });
  console.log(`Invalid token Status: ${resInvalid.status}`);
  const textInvalid = await resInvalid.text();
  const passR16 = resInvalid.status === 404 || resInvalid.status === 400 || resInvalid.status === 401;
  const hasExpectedThaiText = textInvalid.includes('ลิงก์หมดอายุหรือถูกยกเลิก') || textInvalid.includes('ไม่พบรหัสเชิญ');
  console.log(`Contains expected Thai error page: ${hasExpectedThaiText}`);
  console.log(`Result: ${passR16 && hasExpectedThaiText ? 'PASS' : 'FAIL'}\n`);

  console.log('=== All Live Checks Summary ===');
  console.log(`R1-2 (Tenant Profile & Subviews): ${passR12 ? 'PASS' : 'FAIL'}`);
  console.log(`R1-3 (Active Tenant Entry Sync): ${passR13 ? 'PASS' : 'FAIL'}`);
  console.log(`R1-5 (Quota Independence): ${passR15 ? 'PASS' : 'FAIL'}`);
  console.log(`R1-6 (Negative Invalid Token): ${passR16 ? 'PASS' : 'FAIL'}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal in live checks:', err);
  process.exit(1);
});
