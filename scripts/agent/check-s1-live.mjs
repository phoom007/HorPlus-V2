/**
 * Live Check for Card S1 on app.hor-plus.com
 * Reads credentials dynamically from .agents/local/test-access.md
 */

import fs from 'fs';
import path from 'path';

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
  const baseUrl = 'https://app.hor-plus.com';

  console.log('=== Checking Live Endpoints on app.hor-plus.com ===\n');

  // AC S1-1: TA Tenant Profile
  console.log('1. [AC S1-1] GET /api/v1/tenant-portal/profile with Tenant session');
  const resS11 = await fetch(`${baseUrl}/api/v1/tenant-portal/profile`, {
    headers: {
      Cookie: `horplus_session=${tenantCreds.session}`,
    },
  });
  console.log(`Status: ${resS11.status}`);
  const dataS11 = await resS11.json();
  console.log(`Tenant Name: ${dataS11.name}, Room: ${dataS11.room?.roomNumber}, Dorm: ${dataS11.dormitory?.name}`);
  const passS11 = resS11.status === 200 && dataS11.id !== 'candidate_tenant_fallback' && dataS11.name === 'สมชาย ใจดี';
  console.log(`Result: ${passS11 ? 'PASS' : 'FAIL'}\n`);

  // AC S1-2: No session
  console.log('2. [AC S1-2] GET /api/v1/tenant-portal/profile WITHOUT session');
  const resS12 = await fetch(`${baseUrl}/api/v1/tenant-portal/profile`);
  console.log(`Status: ${resS12.status}`);
  const dataS12 = await resS12.json();
  console.log(`Response code: ${dataS12.error?.code}, message: ${dataS12.error?.message}`);
  const passS12 = resS12.status === 401 && dataS12.error?.code === 'SESSION_REQUIRED';
  console.log(`Result: ${passS12 ? 'PASS' : 'FAIL'}\n`);

  // AC S1-3: Spoofed x-registration-id header
  console.log('3. [AC S1-3] GET /api/v1/tenant-portal/profile with spoofed x-registration-id header');
  const resS13 = await fetch(`${baseUrl}/api/v1/tenant-portal/profile`, {
    headers: {
      Cookie: `horplus_session=${tenantCreds.session}`,
      'x-registration-id': '11111111-2222-3333-4444-555555555555',
    },
  });
  console.log(`Status: ${resS13.status}`);
  const dataS13 = await resS13.json();
  const passS13 = resS13.status === 200 && dataS13.id === dataS11.id;
  console.log(`Result: ${passS13 ? 'PASS (header has zero effect)' : 'FAIL'}\n`);

  // AC S1-4: Slip intent and Receipt access for Tenant
  console.log('4. [AC S1-4] Tenant Receipt Access & Combined Slip Intent');
  const receiptId = 'bba4f2f8-bb66-4b94-bcc5-3879bf0df0cf';
  const resRc = await fetch(`${baseUrl}/api/v1/receipts/${receiptId}`, {
    headers: {
      Cookie: `horplus_session=${tenantCreds.session}`,
    },
  });
  console.log(`Receipt Status: ${resRc.status}`);
  const dataRc = await resRc.json();
  console.log(`Receipt Number: ${dataRc.receiptNumber}, Total: ${dataRc.snapshotData?.total}`);

  // Fetch unpaid or available bill to test combined-slip-intent
  const resBills = await fetch(`${baseUrl}/api/v1/tenant-portal/bills`, {
    headers: {
      Cookie: `horplus_session=${tenantCreds.session}`,
    },
  });
  const billsData = await resBills.json();
  const billsList = Array.isArray(billsData) ? billsData : (billsData.data || billsData.bills || []);
  const sampleBillId = billsList.length > 0 ? billsList[0].id : null;
  console.log(`Found ${billsList.length} bills, sampleBillId: ${sampleBillId}`);

  let passIntent = false;
  if (sampleBillId) {
    const resIntent = await fetch(`${baseUrl}/api/v1/payments/combined-slip-intent`, {
      method: 'POST',
      headers: {
        Cookie: `horplus_session=${tenantCreds.session}; horplus_csrf=${tenantCreds.csrf}`,
        'x-csrf-token': tenantCreds.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        billIds: [sampleBillId],
        mimeType: 'image/jpeg',
        fileSize: 102400,
      }),
    });
    console.log(`Combined Slip Intent Status: ${resIntent.status}`);
    const intentData = await resIntent.json();
    console.log(`Intent Result:`, intentData);
    passIntent = (resIntent.status === 200 && !!intentData.intentId) || (resIntent.status === 400 && intentData.error?.code === 'ALREADY_PAID');
  }
  const passS14 = resRc.status === 200 && passIntent;
  console.log(`Result: ${passS14 ? 'PASS (Tenant resolved successfully, business check returned)' : 'FAIL'}\n`);

  // AC S1-6: Owner views still work
  console.log('5. [AC S1-6] Owner Views (tenants, bills, payments)');
  const resTenants = await fetch(`${baseUrl}/api/v1/tenants`, {
    headers: { Cookie: `horplus_session=${ownerCreds.session}` },
  });
  const resBillsOwner = await fetch(`${baseUrl}/api/v1/bills`, {
    headers: { Cookie: `horplus_session=${ownerCreds.session}` },
  });
  const resPayments = await fetch(`${baseUrl}/api/v1/payments`, {
    headers: { Cookie: `horplus_session=${ownerCreds.session}` },
  });

  console.log(`Owner /tenants Status: ${resTenants.status}`);
  console.log(`Owner /bills Status: ${resBillsOwner.status}`);
  console.log(`Owner /payments Status: ${resPayments.status}`);

  const passS16 = resTenants.status === 200 && resBillsOwner.status === 200 && resPayments.status === 200;
  console.log(`Result: ${passS16 ? 'PASS' : 'FAIL'}\n`);

  console.log('=== All Live Checks Summary ===');
  console.log(`S1-1 (TA Profile): ${passS11 ? 'PASS' : 'FAIL'}`);
  console.log(`S1-2 (No Session 401): ${passS12 ? 'PASS' : 'FAIL'}`);
  console.log(`S1-3 (Header Ignored): ${passS13 ? 'PASS' : 'FAIL'}`);
  console.log(`S1-4 (Receipt & Slip Intent): ${passS14 ? 'PASS' : 'FAIL'}`);
  console.log(`S1-6 (Owner Views): ${passS16 ? 'PASS' : 'FAIL'}`);
}

main().catch(console.error);
