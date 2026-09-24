/**
 * Live Check for Card S2 on app.hor-plus.com
 * Verifies server-side LIFF verification endpoints, reusable entry links, and token validations.
 */

import fs from 'fs';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import { TenantRegistrationInviteService } from '../../server/dist/services/tenant-registration-invite.service.js';

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
  const prisma = getPrismaClient();

  console.log('=== Checking Card S2 Live Endpoints on app.hor-plus.com ===\n');

  // 1. [AC S2-5] Missing & Invalid ID token verification on POST /api/v1/auth/line-liff-session
  console.log('1. [AC S2-5] Missing & Invalid ID token verification');

  // Missing idToken
  const resMissing = await fetch(`${APP_URL}/api/v1/auth/line-liff-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const dataMissing = await resMissing.json();
  console.log(`Missing ID Token status: ${resMissing.status}, code: ${dataMissing.error?.code}`);
  const passMissing = resMissing.status === 401 && dataMissing.error?.code === 'MISSING_ID_TOKEN';

  // Bogus/Invalid idToken
  const resInvalid = await fetch(`${APP_URL}/api/v1/auth/line-liff-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'invalid.bogus.idtoken.test' }),
  });
  const dataInvalid = await resInvalid.json();
  console.log(`Invalid ID Token status: ${resInvalid.status}, code: ${dataInvalid.error?.code}`);
  const passInvalid = resInvalid.status === 401 && dataInvalid.error?.code === 'UNAUTHORIZED';

  const passS25 = passMissing && passInvalid;
  console.log(`[AC S2-5] Result: ${passS25 ? 'PASS' : 'FAIL'}\n`);

  // 2. [AC S2-3] Unlinked / No-session unauthorized access
  console.log('2. [AC S2-3] Access /api/v1/tenant-portal/profile without session');
  const resNoSession = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`);
  const dataNoSession = await resNoSession.json();
  console.log(`Status: ${resNoSession.status}, code: ${dataNoSession.error?.code}`);
  const passS23 = resNoSession.status === 401 && dataNoSession.error?.code === 'SESSION_REQUIRED';
  console.log(`[AC S2-3] Result: ${passS23 ? 'PASS' : 'FAIL'}\n`);

  // 3. [AC S2-4] Reusable entry token / persistent entry link (PO Decision A1)
  console.log('3. [AC S2-4] Reusable entry token verification');
  let passS24 = false;
  let somchaiFriendId = null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
    const somchai = await tx.tenant.findFirst({
      where: {
        dormitoryId: DORM_ID,
        displayName: 'นายสมชาย ใจดี',
        status: 'active',
      },
    });
    if (somchai && somchai.lineFriendId) {
      somchaiFriendId = somchai.lineFriendId;
    }
  });

  if (somchaiFriendId) {
    let invite = null;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      const inviteService = new TenantRegistrationInviteService(tx);
      invite = await inviteService.createInvite(DORM_ID, somchaiFriendId, tx);
    });

    if (invite && invite.rawToken) {
      console.log(`Created invite token for Somchai: ${invite.rawToken.substring(0, 8)}...`);

      // Entry 1
      const resEntry1 = await fetch(`${APP_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(invite.rawToken)}`, {
        redirect: 'manual',
      });
      console.log(`First entry status: ${resEntry1.status}, Location: ${resEntry1.headers.get('location')}`);
      const cookie1 = resEntry1.headers.get('set-cookie');
      const passEntry1 = resEntry1.status === 302 && resEntry1.headers.get('location')?.includes('/tenant');

      // Entry 2 (Reuse same token per PO Decision A1)
      const resEntry2 = await fetch(`${APP_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(invite.rawToken)}`, {
        redirect: 'manual',
      });
      console.log(`Second entry (reuse) status: ${resEntry2.status}, Location: ${resEntry2.headers.get('location')}`);
      const cookie2 = resEntry2.headers.get('set-cookie');
      const passEntry2 = resEntry2.status === 302 && resEntry2.headers.get('location')?.includes('/tenant');

      // Verify profile access with generated session
      let passProfile = false;
      if (cookie2) {
        const sessionMatch = cookie2.match(/horplus_session=([^;]+)/);
        if (sessionMatch) {
          const sessionVal = sessionMatch[1];
          const resProfile = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`, {
            headers: { Cookie: `horplus_session=${sessionVal}` },
          });
          const dataProfile = await resProfile.json();
          console.log(`Profile check status: ${resProfile.status}, Tenant: ${dataProfile.name}, Room: ${dataProfile.room?.roomNumber}`);
          passProfile = resProfile.status === 200 && dataProfile.name === 'สมชาย ใจดี';
        }
      }

      passS24 = passEntry1 && passEntry2 && passProfile;
    }
  }
  console.log(`[AC S2-4] Result: ${passS24 ? 'PASS' : 'FAIL'}\n`);

  // 4. [AC S2-6] Existing bound tenant session retains access
  console.log('4. [AC S2-6] Existing bound tenant session retains access');
  const resSomchai = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  const dataSomchai = await resSomchai.json();
  console.log(`Existing session status: ${resSomchai.status}, Tenant: ${dataSomchai.name}`);
  const passS26 = resSomchai.status === 200 && dataSomchai.name === 'สมชาย ใจดี';
  console.log(`[AC S2-6] Result: ${passS26 ? 'PASS' : 'FAIL'}\n`);

  // 5. [AC S2-7] Hardcoded LIFF ID check
  console.log('5. [AC S2-7] Check for hardcoded LIFF ID in source files');
  const bannedId = '2011672957-pIlWUt9e';
  let foundBanned = false;
  const searchDirs = ['src', 'server/src'];

  function searchInDir(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const fullPath = `${dir}/${f.name}`;
      if (f.isDirectory()) {
        searchInDir(fullPath);
      } else if (f.isFile() && (f.name.endsWith('.ts') || f.name.endsWith('.tsx') || f.name.endsWith('.js'))) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes(bannedId)) {
          console.error(`Found banned hardcoded LIFF ID in: ${fullPath}`);
          foundBanned = true;
        }
      }
    }
  }

  for (const dir of searchDirs) {
    searchInDir(dir);
  }

  const passS27 = !foundBanned;
  console.log(`No hardcoded '${bannedId}' found: ${passS27}`);
  console.log(`[AC S2-7] Result: ${passS27 ? 'PASS' : 'FAIL'}\n`);

  // Summary
  const allPass = passS25 && passS23 && passS24 && passS26 && passS27;
  console.log(`=== Overall Live Check Result: ${allPass ? 'ALL PASS' : 'SOME FAILED'} ===`);

  await prisma.$disconnect();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error in check-s2-live:', err);
  process.exit(1);
});
