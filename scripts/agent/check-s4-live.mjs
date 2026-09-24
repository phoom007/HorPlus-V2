/**
 * Card S4 Live Pilot Verification Script (https://app.hor-plus.com)
 */

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';

// Credentials from .agents/local/test-access.md
const TENANT_SESSION = 'HzRJeZVFZwkzPDRf.cYOigMNwBOqJFdIgPRXV1aVNFzUs_V-yWCJM3z1j6akbGC5_JDr2wH76FoEALKQUgPO8ujG0PODOYssn-yUgKWcC5GKQgQVhNr78TNSP8pbHMpEsKqmBKBd1St1hNkt1HxX-GG9UBSpSreSk8kvNocNo9LUK6gZ8JyFZhV3STy4ljzpwK_L10pgXiH9w7rR3QCbdiey3cHfAi4moSiLpdocUcn6p5Lx7rvjL0-8UN_B6HyoS6QGgOsi6-Bqq1245wTJxP-6O1g.wM79_iJK_1yrNoAXvX7DtA';
const TENANT_CSRF = '2e84ba4cc965b34d75f57b9f5192b72a.c3e995dab4b77dac5ca6eac507b8ec3c98f8f45380951639c6b350e5ae470967';

const OWNER_SESSION = 'gnkP5muOIDtymbRC.cu9DsgfZAGJK0Ycd-tu8wN3-MTkKqCgEEzE_OP_PrVB2o6cElP7ERFlDJi7vG_ERNCZXb8KMDXG_xl4CI3jQYw8qGRbdFgqVbnVDREgYP1fZSmFVaj4LUNwV0NvKag47JLJaQdtncxrfVLJ4F0PH8NwYokUvfPfq3V8V-d2tnsGreh-1B_5bArqqfWR5GOmwaKyH9o4tgUYEd5HouKeMfBxAPKwrHHlvNkd1LzqTYj21RH-PH0RwefMcxX0gOJalTCiX7-cKtw.uy1woNk2edNETPjIr5d7tw';
const OWNER_CSRF = 'd78b7ba0facaa38dfebd2ff5ceac7ba2.634e9e5e388afb48c4452b9ddf58d0f06427c6ebf8ac09c933462a6c8bb67352';

const headersForTenant = (withCsrf = false) => {
  const h = {
    Cookie: `horplus_session=${TENANT_SESSION}; horplus_csrf=${TENANT_CSRF}`,
    'x-dormitory-id': DORM_ID,
  };
  if (withCsrf) {
    h['x-csrf-token'] = TENANT_CSRF;
  }
  return h;
};

const headersForOwner = (withCsrf = false) => {
  const h = {
    Cookie: `horplus_session=${OWNER_SESSION}; horplus_csrf=${OWNER_CSRF}`,
    'x-dormitory-id': DORM_ID,
  };
  if (withCsrf) {
    h['x-csrf-token'] = OWNER_CSRF;
  }
  return h;
};

async function main() {
  console.log('=== Starting Card S4 Live Pilot Verification ===\n');

  let allPass = true;

  // 1. S4-1: Tenant calling owner APIs must return 403 Forbidden
  console.log('--- Checking S4-1: Blocking Tenant from Owner APIs ---');
  const ownerEndpoints = [
    { name: 'GET /api/v1/bills', url: `${BASE_URL}/api/v1/bills` },
    { name: 'GET /api/v1/properties/rooms', url: `${BASE_URL}/api/v1/properties/rooms` },
    { name: 'GET /api/v1/contracts', url: `${BASE_URL}/api/v1/contracts` },
    { name: 'GET /api/v1/tenant-move-out-requests', url: `${BASE_URL}/api/v1/tenant-move-out-requests` },
    { name: 'GET /api/v1/contract-renewals/requests', url: `${BASE_URL}/api/v1/contract-renewals/requests` },
  ];

  for (const ep of ownerEndpoints) {
    const res = await fetch(ep.url, { headers: headersForTenant(false) });
    const is403 = res.status === 403;
    console.log(`  [S4-1] ${ep.name} -> status ${res.status} ${is403 ? 'PASS (403 Forbidden)' : 'FAIL (Expected 403)'}`);
    if (!is403) allPass = false;
  }

  // 2. S4-2: Tenant legitimate actions
  console.log('\n--- Checking S4-2: Tenant Legitimate Operations ---');

  // 2.1 Profile
  const profileRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, { headers: headersForTenant() });
  const profileJson = await profileRes.json();
  const tenantId = profileJson?.id;
  const contractId = profileJson?.activeContract?.id;
  console.log(`  [S4-2] GET /tenant-portal/profile -> status ${profileRes.status}, tenantId=${tenantId}, contractId=${contractId}`);
  if (profileRes.status !== 200 || !tenantId) allPass = false;

  // 2.2 Receipt HTML for tenant's bill
  const receiptId = 'd2c31f65-261d-4e07-8678-76bf7d052a74'; // RC-202609-101-0001 (Somchai's bill)
  const receiptRes = await fetch(`${BASE_URL}/api/v1/receipts/${receiptId}/html`, { headers: headersForTenant() });
  console.log(`  [S4-2] GET /receipts/${receiptId}/html -> status ${receiptRes.status} ${receiptRes.status === 200 ? 'PASS' : 'FAIL'}`);
  if (receiptRes.status !== 200) allPass = false;

  // 2.3 Combined slip intent for tenant's bill
  const unpaidBillId = 'b0447f96-611b-4417-bdd6-862c7c5c4d52'; // INV-2026-10-0001 (Somchai's unpaid bill)
  const intentRes = await fetch(`${BASE_URL}/api/v1/payments/combined-slip-intent`, {
    method: 'POST',
    headers: { ...headersForTenant(true), 'Content-Type': 'application/json' },
    body: JSON.stringify({ billIds: [unpaidBillId], mimeType: 'image/jpeg', fileSize: 1024 }),
  });
  console.log(`  [S4-2] POST /payments/combined-slip-intent -> status ${intentRes.status} ${intentRes.status === 200 ? 'PASS' : 'FAIL'}`);
  if (intentRes.status !== 200) allPass = false;

  // 2.4 Contract renewal eligibility for tenant
  if (contractId && tenantId) {
    const eligRes = await fetch(`${BASE_URL}/api/v1/contract-renewals/eligibility?tenantId=${tenantId}&contractId=${contractId}`, {
      headers: headersForTenant(),
    });
    console.log(`  [S4-2] GET /contract-renewals/eligibility -> status ${eligRes.status} ${eligRes.status === 200 ? 'PASS' : 'FAIL'}`);
    if (eligRes.status !== 200) allPass = false;
  }

  // 2.5 Dormitory signature
  const sigRes = await fetch(`${BASE_URL}/api/v1/dormitories/${DORM_ID}/signature`, {
    headers: headersForTenant(),
  });
  const sigPass = sigRes.status === 200 || sigRes.status === 404; // 200 if signature exists, 404 if no image yet, but NEVER 403 Forbidden!
  console.log(`  [S4-2] GET /dormitories/${DORM_ID}/signature -> status ${sigRes.status} ${sigPass && sigRes.status !== 403 ? 'PASS (Not 403)' : 'FAIL'}`);
  if (sigRes.status === 403) allPass = false;

  // 3. S4-3: Renewal route rejects caller supplying another tenantId (TC)
  console.log('\n--- Checking S4-3: Rejecting Injected TenantId in Renewal Request ---');
  const fakeOtherTenantId = 'cccccccc-9999-4000-8000-000000000099';
  const renewalInjectRes = await fetch(`${BASE_URL}/api/v1/contract-renewals/request`, {
    method: 'POST',
    headers: { ...headersForTenant(true), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: fakeOtherTenantId,
      contractId: contractId || 'ffffffff-6666-4000-8000-000000000006',
      requestedDurationMonths: 6,
    }),
  });
  const renewalInjectJson = await renewalInjectRes.json().catch(() => ({}));
  const isS43Pass = renewalInjectRes.status === 403 && renewalInjectJson?.error?.message?.includes('คุณไม่มีสิทธิ์ดำเนินการต่อสัญญาของผู้เช่ารายอื่น');
  console.log(`  [S4-3] POST /contract-renewals/request with foreign tenantId -> status ${renewalInjectRes.status}, error="${renewalInjectJson?.error?.message}" ${isS43Pass ? 'PASS' : 'FAIL'}`);
  if (!isS43Pass) allPass = false;

  // 4. S4-4: CSRF enforcement on tenant mutations
  console.log('\n--- Checking S4-4: Strict CSRF Enforcement on Mutations ---');
  // 4.1 Mutation WITHOUT CSRF header
  const noCsrfRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    method: 'PATCH',
    headers: { ...headersForTenant(false), 'Content-Type': 'application/json' },
    body: JSON.stringify({ petInformation: 'Live Test Pet' }),
  });
  const noCsrfJson = await noCsrfRes.json().catch(() => ({}));
  const isNoCsrfBlocked = noCsrfRes.status === 403 && noCsrfJson?.error?.code === 'CSRF_TOKEN_REQUIRED';
  console.log(`  [S4-4] PATCH /tenant-portal/profile WITHOUT CSRF -> status ${noCsrfRes.status} (${noCsrfJson?.error?.code}) ${isNoCsrfBlocked ? 'PASS' : 'FAIL'}`);
  if (!isNoCsrfBlocked) allPass = false;

  // 4.2 Mutation WITH valid CSRF header
  const withCsrfRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    method: 'PATCH',
    headers: { ...headersForTenant(true), 'Content-Type': 'application/json' },
    body: JSON.stringify({ petInformation: 'ไม่มีสัตว์เลี้ยง' }),
  });
  console.log(`  [S4-4] PATCH /tenant-portal/profile WITH CSRF -> status ${withCsrfRes.status} ${withCsrfRes.status === 200 ? 'PASS' : 'FAIL'}`);
  if (withCsrfRes.status !== 200) allPass = false;

  // 5. S4-5: Owner endpoints still work normally for Owner role
  console.log('\n--- Checking S4-5: Owner Endpoints Functional for Owner ---');
  const ownerCheckEndpoints = [
    { name: 'GET /api/v1/bills', url: `${BASE_URL}/api/v1/bills` },
    { name: 'GET /api/v1/properties/rooms', url: `${BASE_URL}/api/v1/properties/rooms` },
    { name: 'GET /api/v1/contracts', url: `${BASE_URL}/api/v1/contracts` },
    { name: 'GET /api/v1/tenant-move-out-requests', url: `${BASE_URL}/api/v1/tenant-move-out-requests` },
  ];

  for (const ep of ownerCheckEndpoints) {
    const res = await fetch(ep.url, { headers: headersForOwner(false) });
    console.log(`  [S4-5] ${ep.name} (as Owner) -> status ${res.status} ${res.status === 200 ? 'PASS' : 'FAIL'}`);
    if (res.status !== 200) allPass = false;
  }

  console.log(`\n=== Card S4 Verification Result: ${allPass ? 'ALL CHECKS PASSED (PASS)' : 'FAILURES DETECTED (FAIL)'} ===`);
  if (!allPass) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error during Card S4 live check:', err);
  process.exit(1);
});
