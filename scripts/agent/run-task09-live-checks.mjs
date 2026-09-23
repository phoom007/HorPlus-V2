import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://app.hor-plus.com';

function getSessionCookie(role) {
  const sessionPath = path.resolve(`.agents/local/sessions/${role}.json`);
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session file not found: ${sessionPath}`);
  }
  const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  const cookies = sessionData.cookies || [];
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function runLiveChecks() {
  console.log('====================================================');
  console.log('  TASK 09 Live Pilot Verification on app.hor-plus.com');
  console.log('====================================================\n');

  const results = [];
  const ownerCookie = getSessionCookie('owner');

  // --- AC-1: Dormitory Scoping and Fallback Removal ---
  console.log('[AC-1] Testing Dormitory Scoping & Fallback Removal...');
  
  // Test 1.1: Unauthenticated call to /api/v1/bills
  const res1 = await fetch(`${BASE_URL}/api/v1/bills`);
  const status1 = res1.status;
  const isRejected1 = status1 === 400 || status1 === 401 || status1 === 403;
  console.log(`  - GET /api/v1/bills (no auth): HTTP ${status1} (Rejected: ${isRejected1})`);

  // Test 1.2: Unauthenticated call to /api/v1/contracts
  const res2 = await fetch(`${BASE_URL}/api/v1/contracts`);
  const status2 = res2.status;
  const isRejected2 = status2 === 400 || status2 === 401 || status2 === 403;
  console.log(`  - GET /api/v1/contracts (no auth): HTTP ${status2} (Rejected: ${isRejected2})`);

  // Test 1.3: Unauthenticated call to /api/v1/meters/readings
  const res3 = await fetch(`${BASE_URL}/api/v1/meters/readings`);
  const status3 = res3.status;
  const isRejected3 = status3 === 400 || status3 === 401 || status3 === 403;
  console.log(`  - GET /api/v1/meters/readings (no auth): HTTP ${status3} (Rejected: ${isRejected3})`);

  // Test 1.4: Unauthenticated call to /api/v1/tenants
  const res4 = await fetch(`${BASE_URL}/api/v1/tenants`);
  const status4 = res4.status;
  const isRejected4 = status4 === 400 || status4 === 401 || status4 === 403;
  console.log(`  - GET /api/v1/tenants (no auth): HTTP ${status4} (Rejected: ${isRejected4})`);

  const ac1Pass = isRejected1 && isRejected2 && isRejected3 && isRejected4;
  results.push({
    ac: 'AC-1',
    name: 'Dormitory Scoping & Fallback Removal',
    pass: ac1Pass,
    details: `Unauthenticated calls strictly fail-closed: bills=${status1}, contracts=${status2}, meters=${status3}, tenants=${status4}`,
  });

  // --- AC-2: Free Plan LINE Quota (N-04 / ARC-05) ---
  console.log('\n[AC-2] Testing Free Plan Message Quota...');
  const resPlans = await fetch(`${BASE_URL}/api/v1/public/plans`);
  let freeQuota = null;
  if (resPlans.ok) {
    const plansData = await resPlans.json();
    const plans = plansData.data || plansData || [];
    const freePlan = plans.find((p) => p.code === 'FREE');
    freeQuota = freePlan ? freePlan.messageQuotaMonthly : null;
    console.log(`  - Public plans response: Free Plan quota = ${freeQuota}`);
  } else {
    console.log(`  - GET /api/v1/public/plans status: ${resPlans.status}`);
  }
  const ac2Pass = freeQuota === 30;
  results.push({
    ac: 'AC-2',
    name: 'Free Plan LINE Message Quota Alignment',
    pass: ac2Pass,
    details: `Free plan messageQuotaMonthly is strictly 30 (got ${freeQuota})`,
  });

  // --- AC-5: Server-Side PageSize Max Ceiling (PERF-08) ---
  console.log('\n[AC-5] Testing PageSize Maximum Ceiling (200)...');
  
  // Test 5.1: Bills with pageSize=999999
  const resBillsPage = await fetch(`${BASE_URL}/api/v1/bills?pageSize=999999`, {
    headers: { Cookie: ownerCookie },
  });
  const billsBody = await resBillsPage.json();
  const billsPageSize = billsBody.pagination?.pageSize;
  console.log(`  - GET /api/v1/bills?pageSize=999999: pagination.pageSize = ${billsPageSize}`);

  // Test 5.2: Contracts with pageSize=1000
  const resContractsPage = await fetch(`${BASE_URL}/api/v1/contracts?pageSize=1000`, {
    headers: { Cookie: ownerCookie },
  });
  const contractsBody = await resContractsPage.json();
  const contractsPageSize = contractsBody.pagination?.pageSize;
  console.log(`  - GET /api/v1/contracts?pageSize=1000: pagination.pageSize = ${contractsPageSize}`);

  // Test 5.3: Tenants with pageSize=5000
  const resTenantsPage = await fetch(`${BASE_URL}/api/v1/tenants?pageSize=5000`, {
    headers: { Cookie: ownerCookie },
  });
  const tenantsBody = await resTenantsPage.json();
  const tenantsPageSize = tenantsBody.pagination?.pageSize;
  console.log(`  - GET /api/v1/tenants?pageSize=5000: pagination.pageSize = ${tenantsPageSize}`);

  const ac5Pass = billsPageSize === 200 && contractsPageSize === 200 && tenantsPageSize === 200;
  results.push({
    ac: 'AC-5',
    name: 'PageSize Maximum Ceiling Clamping',
    pass: ac5Pass,
    details: `All clamped to 200 ceiling: bills=${billsPageSize}, contracts=${contractsPageSize}, tenants=${tenantsPageSize}`,
  });

  // --- AC-6: Redis Readiness and Backoff Recovery (PERF-10) ---
  console.log('\n[AC-6] Testing Redis Resilience & Readiness...');
  const resReadiness = await fetch(`${BASE_URL}/api/v1/health/readiness`);
  const readiness = await resReadiness.json();
  console.log('  - Live Readiness status:', JSON.stringify(readiness));
  const ac6Pass = readiness.status === 'UP' && readiness.redis === 'UP';
  results.push({
    ac: 'AC-6',
    name: 'Redis Connection Resilience',
    pass: ac6Pass,
    details: `Readiness check is UP: redis=${readiness.redis}, db=${readiness.database}`,
  });

  console.log('\n====================================================');
  console.log('  LIVE VERIFICATION SUMMARY');
  console.log('====================================================');
  for (const r of results) {
    console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'}: ${r.ac} - ${r.name} (${r.details})`);
  }

  const allPass = results.every((r) => r.pass);
  console.log(`\nOverall Result: ${allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  process.exit(allPass ? 0 : 1);
}

runLiveChecks().catch((err) => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
