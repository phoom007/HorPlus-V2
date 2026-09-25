/**
 * Live Check for Card S7 on app.hor-plus.com
 * Verifies S7-1, S7-2, S7-3, S7-4, S7-5 against live endpoints.
 */

import fs from 'fs';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sharp = require('../../server/node_modules/sharp');
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const APP_URL = 'https://app.hor-plus.com';
const PRIMARY_DORM_ID = '20000001-0000-4000-8000-000000000002'; // Comprehensive Manor
const TC_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b'; // Somchai
const TC_USER_ID = '20000005-0000-4000-8000-000000000005';
const UNPAID_BILL_ID = 'b0447f96-611b-4417-bdd6-862c7c5c4d52'; // Bill INV-2026-10-0001

function clearSlipRateLimit() {
  try {
    execSync(`docker exec horplus-v2-redis-1 redis-cli del rate_limit:slip:user:${PRIMARY_DORM_ID}:${TC_USER_ID} rate_limit:slip:ip:127.0.0.1`, { stdio: 'ignore' });
  } catch {}
}

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

async function createTestImageBase64(width = 150, height = 150) {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 60, g: 120, b: 180 },
    },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function main() {
  const tenantCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');
  const prisma = getPrismaClient();

  clearSlipRateLimit();

  console.log('=== Checking Card S7 Live Endpoints on app.hor-plus.com ===\n');

  // =========================================================================
  // 1. [AC S7-1] TC Uploads ID Card Photo -> Reload retains; Owner can view
  // =========================================================================
  console.log('1. [AC S7-1] Upload ID Card Photo & Owner Verification');
  const idCardBase64 = await createTestImageBase64(250, 160);

  const resUploadIdCard = await fetch(`${APP_URL}/api/v1/tenant-portal/id-card-photo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `horplus_session=${tenantCreds.session}; horplus_csrf=${tenantCreds.csrf}`,
      'x-csrf-token': tenantCreds.csrf,
    },
    body: JSON.stringify({ image: idCardBase64 }),
  });
  const dataUploadIdCard = await resUploadIdCard.json();
  console.log(`Upload status: ${resUploadIdCard.status}`, dataUploadIdCard);

  // Reload / verification from tenant perspective
  const resTenantIdCard = await fetch(`${APP_URL}/api/v1/tenant-portal/id-card-photo`, {
    headers: {
      'Cookie': `horplus_session=${tenantCreds.session}`,
    },
  });
  console.log(`Tenant GET ID Card status: ${resTenantIdCard.status}, Content-Type: ${resTenantIdCard.headers.get('content-type')}`);

  // Owner views ID card
  const resOwnerIdCard = await fetch(`${APP_URL}/api/v1/tenants/${TC_TENANT_ID}/identity-document`, {
    headers: {
      'Cookie': `horplus_session=${ownerCreds.session}`,
      'x-dormitory-id': PRIMARY_DORM_ID,
    },
  });
  console.log(`Owner GET ID Card status: ${resOwnerIdCard.status}, Content-Type: ${resOwnerIdCard.headers.get('content-type')}`);

  const passS71 =
    resUploadIdCard.status === 200 &&
    dataUploadIdCard?.success === true &&
    resTenantIdCard.status === 200 &&
    resOwnerIdCard.status === 200;
  console.log(`Result S7-1: ${passS71 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 2. [AC S7-2] Tenant Forbidden on Owner Endpoint; Expired Signed URL Rejected
  // =========================================================================
  console.log('2. [AC S7-2] Role Hard Deny on Owner Document & Signed URL Expiration');

  // Tenant session calls owner's identity document endpoint
  const resTenantOnOwner = await fetch(`${APP_URL}/api/v1/tenants/${TC_TENANT_ID}/identity-document`, {
    headers: {
      'Cookie': `horplus_session=${tenantCreds.session}`,
      'x-dormitory-id': PRIMARY_DORM_ID,
    },
  });
  const dataTenantOnOwner = await resTenantOnOwner.json().catch(() => ({}));
  console.log(`Tenant on Owner endpoint status: ${resTenantOnOwner.status}`, dataTenantOnOwner);

  // Owner requests signed URL
  const resSignedUrl = await fetch(`${APP_URL}/api/v1/tenants/${TC_TENANT_ID}/identity-document/signed-url`, {
    headers: {
      'Cookie': `horplus_session=${ownerCreds.session}`,
      'x-dormitory-id': PRIMARY_DORM_ID,
    },
  });
  const dataSignedUrl = await resSignedUrl.json();
  const signedPath = dataSignedUrl?.data?.signedUrl;
  console.log(`Owner signed URL status: ${resSignedUrl.status}, signedUrl: ${signedPath}`);

  // Fetch with valid signed URL (no cookies needed)
  const resValidSigned = await fetch(`${APP_URL}${signedPath}`);
  console.log(`Valid Signed URL fetch status: ${resValidSigned.status}, Content-Type: ${resValidSigned.headers.get('content-type')}`);

  // Construct expired signed URL with signature
  const pastExpires = Date.now() - 60000; // 1 minute in the past
  const secret = process.env.SESSION_SECRET || 'horplus-identity-doc-secret';
  const expiredSig = crypto.createHmac('sha256', secret).update(`${TC_TENANT_ID}:${PRIMARY_DORM_ID}:${pastExpires}`).digest('hex');
  const resExpiredSigned = await fetch(`${APP_URL}/api/v1/tenants/${TC_TENANT_ID}/identity-document?expires=${pastExpires}&sig=${expiredSig}`);
  const dataExpiredSigned = await resExpiredSigned.json().catch(() => ({}));
  console.log(`Expired Signed URL fetch status: ${resExpiredSigned.status}`, dataExpiredSigned);

  const passS72 =
    resTenantOnOwner.status === 403 &&
    resSignedUrl.status === 200 &&
    resValidSigned.status === 200 &&
    resExpiredSigned.status === 403 &&
    dataExpiredSigned?.error?.code === 'EXPIRED_SIGNED_URL';
  console.log(`Result S7-2: ${passS72 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 3. [AC S7-3] Non-Image / Oversized File Upload -> Thai Error, Not 500
  // =========================================================================
  console.log('3. [AC S7-3] Non-Image & Oversized File Rejections (Thai message, no 500)');
  clearSlipRateLimit();

  // 3a. TC uploads plain text to ID card
  const resTextIdCard = await fetch(`${APP_URL}/api/v1/tenant-portal/id-card-photo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `horplus_session=${tenantCreds.session}; horplus_csrf=${tenantCreds.csrf}`,
      'x-csrf-token': tenantCreds.csrf,
    },
    body: JSON.stringify({ image: 'data:text/plain;base64,' + Buffer.from('plain text').toString('base64') }),
  });
  const dataTextIdCard = await resTextIdCard.json().catch(() => ({}));
  console.log(`Text ID Card status: ${resTextIdCard.status}`, dataTextIdCard);

  // 3b. TC attempts slip intent with PDF
  const resPdfSlipIntent = await fetch(`${APP_URL}/api/v1/payments/slip/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `horplus_session=${tenantCreds.session}; horplus_csrf=${tenantCreds.csrf}`,
      'x-csrf-token': tenantCreds.csrf,
    },
    body: JSON.stringify({
      billId: UNPAID_BILL_ID,
      fileName: 'bank-slip.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
    }),
  });
  const dataPdfSlipIntent = await resPdfSlipIntent.json().catch(() => ({}));
  console.log(`PDF Slip Intent status: ${resPdfSlipIntent.status}`, dataPdfSlipIntent);

  // 3c. TC attempts slip intent with > 5MB file size
  const resOversizedSlip = await fetch(`${APP_URL}/api/v1/payments/slip/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `horplus_session=${tenantCreds.session}; horplus_csrf=${tenantCreds.csrf}`,
      'x-csrf-token': tenantCreds.csrf,
    },
    body: JSON.stringify({
      billId: UNPAID_BILL_ID,
      fileName: 'huge-slip.png',
      mimeType: 'image/png',
      fileSize: 6 * 1024 * 1024, // 6MB
    }),
  });
  const dataOversizedSlip = await resOversizedSlip.json().catch(() => ({}));
  console.log(`Oversized Slip Intent status: ${resOversizedSlip.status}`, dataOversizedSlip);

  const passS73 =
    resTextIdCard.status === 400 &&
    Boolean(dataTextIdCard?.error?.message) &&
    resPdfSlipIntent.status === 400 &&
    dataPdfSlipIntent?.error?.code === 'PDF_NOT_ALLOWED' &&
    resOversizedSlip.status === 400 &&
    dataOversizedSlip?.error?.code === 'FILE_TOO_LARGE';
  console.log(`Result S7-3: ${passS73 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 5. [AC S7-5] Mobile Gallery Support (Accepts JPEG, PNG, WebP, HEIC)
  // =========================================================================
  console.log('5. [AC S7-5] Mobile Gallery & HEIC image acceptance');
  clearSlipRateLimit();

  const resHeicIntent = await fetch(`${APP_URL}/api/v1/payments/slip/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `horplus_session=${tenantCreds.session}; horplus_csrf=${tenantCreds.csrf}`,
      'x-csrf-token': tenantCreds.csrf,
    },
    body: JSON.stringify({
      billId: UNPAID_BILL_ID,
      fileName: 'IMG_4812.HEIC',
      mimeType: 'image/heic',
      fileSize: 204800,
    }),
  });
  const dataHeicIntent = await resHeicIntent.json().catch(() => ({}));
  console.log(`HEIC Slip Intent Status: ${resHeicIntent.status}`, dataHeicIntent);

  const passS75 =
    resHeicIntent.status === 200 &&
    Boolean(dataHeicIntent?.intentId) &&
    Boolean(dataHeicIntent?.uploadUrl);
  console.log(`Result S7-5: ${passS75 ? 'PASS' : 'FAIL'}\n`);

  // =========================================================================
  // 4. [AC S7-4] Rate Limiting on Slip Intent/Upload (3 requests / 15 minutes)
  // =========================================================================
  console.log('4. [AC S7-4] Slip Rate Limiter (3 requests / 15 minutes)');
  clearSlipRateLimit();

  let rateLimitHit = false;
  let rateLimitMessage = '';
  let hitStatus = 0;

  for (let i = 1; i <= 5; i++) {
    const resIntent = await fetch(`${APP_URL}/api/v1/payments/slip/intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `horplus_session=${tenantCreds.session}; horplus_csrf=${tenantCreds.csrf}`,
        'x-csrf-token': tenantCreds.csrf,
      },
      body: JSON.stringify({
        billId: UNPAID_BILL_ID,
        fileName: `slip-${i}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: 10240,
      }),
    });
    const dataIntent = await resIntent.json().catch(() => ({}));
    console.log(`Intent #${i} Status: ${resIntent.status}`, dataIntent?.error?.code || dataIntent?.intentId || dataIntent);
    if (resIntent.status === 429) {
      rateLimitHit = true;
      hitStatus = resIntent.status;
      rateLimitMessage = dataIntent?.error?.message || '';
      break;
    }
  }

  console.log(`Rate limit triggered: ${rateLimitHit}, Status: ${hitStatus}, Message: ${rateLimitMessage}`);
  const passS74 = rateLimitHit && hitStatus === 429 && rateLimitMessage.includes('คุณส่งคำขออัปโหลดสลิปถี่เกินไป');
  console.log(`Result S7-4: ${passS74 ? 'PASS' : 'FAIL'}\n`);

  // Final cleanup of rate limit
  clearSlipRateLimit();

  // Final summary
  console.log('====================================');
  console.log('Summary of Card S7 Live API Checks:');
  console.log(`S7-1: ${passS71 ? 'PASS' : 'FAIL'}`);
  console.log(`S7-2: ${passS72 ? 'PASS' : 'FAIL'}`);
  console.log(`S7-3: ${passS73 ? 'PASS' : 'FAIL'}`);
  console.log(`S7-4: ${passS74 ? 'PASS' : 'FAIL'}`);
  console.log(`S7-5: ${passS75 ? 'PASS' : 'FAIL'}`);
  console.log('====================================');

  if (passS71 && passS72 && passS73 && passS74 && passS75) {
    console.log('🎉 ALL S7 LIVE API CHECKS PASSED!');
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
