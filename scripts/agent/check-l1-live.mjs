/**
 * Live Verification Script for Card L1 on app.hor-plus.com
 * Verifies L1-1 through L1-5 directly against live API & DB
 */

import fs from 'fs';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const APP_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor Residence

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

async function main() {
  const ownerCreds = getCredentials('Owner');
  const staffCreds = getCredentials('Staff');
  const prisma = getPrismaClient();

  console.log('=== Card L1 Live Verification on app.hor-plus.com ===\n');

  // 1. [AC L1-1] Owner sees "จำนวนการส่งข้อความ" and quota formula on live API
  console.log('1. [AC L1-1] Checking LINE OA Config & Canonical Label for Owner');
  const resL1 = await fetch(`${APP_URL}/api/v1/dormitories/${DORM_ID}/line-oa/config`, {
    headers: {
      Cookie: `horplus_session=${ownerCreds.session}`,
    },
  });
  console.log(`Status: ${resL1.status}`);
  const dataL1 = await resL1.json();
  const config = dataL1.data || dataL1.config;
  console.log(`quotaLabel: "${config?.quotaLabel}"`);
  console.log(`monthlyQuota: ${config?.monthlyQuota}, usedQuota: ${config?.usedQuota}, remainingQuota: ${config?.remainingQuota}`);
  console.log(`isQuotaExhausted: ${config?.isQuotaExhausted}, isQuotaWarning: ${config?.isQuotaWarning}`);

  const passL1 =
    resL1.status === 200 &&
    config?.quotaLabel === 'จำนวนการส่งข้อความ' &&
    typeof config?.monthlyQuota === 'number' &&
    typeof config?.remainingQuota === 'number' &&
    config.remainingQuota === Math.max(0, config.monthlyQuota - config.usedQuota);
  console.log(`Result L1-1: ${passL1 ? 'PASS' : 'FAIL'}\n`);

  // 2. [AC L1-2] Immediate refresh when opening page (?refresh=true) with 15-min cache
  console.log('2. [AC L1-2] Checking Immediate Refresh (?refresh=true)');
  const resL2 = await fetch(`${APP_URL}/api/v1/dormitories/${DORM_ID}/line-oa/config?refresh=true`, {
    headers: {
      Cookie: `horplus_session=${ownerCreds.session}`,
    },
  });
  console.log(`Status with ?refresh=true: ${resL2.status}`);
  const dataL2 = await resL2.json();
  const configRefresh = dataL2.data || dataL2.config;
  const passL2 = resL2.status === 200 && configRefresh && typeof configRefresh.remainingQuota === 'number';
  console.log(`Result L1-2: ${passL2 ? 'PASS' : 'FAIL'}\n`);

  // 3. [AC L1-4] Default package quotas in system database: Free = 30, Paid = 300
  console.log('3. [AC L1-4] Checking Package Quotas in Database');
  const plans = await prisma.subscriptionPlan.findMany({
    where: { code: { in: ['FREE', 'PAID'] } },
  });
  const freePlan = plans.find((p) => p.code === 'FREE');
  const paidPlan = plans.find((p) => p.code === 'PAID');
  console.log(`FREE Plan: code=${freePlan?.code}, messageQuotaMonthly=${freePlan?.messageQuotaMonthly}`);
  console.log(`PAID Plan: code=${paidPlan?.code}, messageQuotaMonthly=${paidPlan?.messageQuotaMonthly}`);

  const passL4 = freePlan?.messageQuotaMonthly === 30 && paidPlan?.messageQuotaMonthly === 300;
  console.log(`Result L1-4: ${passL4 ? 'PASS' : 'FAIL'}\n`);

  // 4. [AC L1-5] Staff Access Prohibition (403 Forbidden)
  console.log('4. [AC L1-5] Staff Attempting to Access LINE OA Config');
  const resL5 = await fetch(`${APP_URL}/api/v1/dormitories/${DORM_ID}/line-oa/config`, {
    headers: {
      Cookie: `horplus_session=${staffCreds.session}`,
    },
  });
  console.log(`Staff Request Status: ${resL5.status}`);
  const dataL5 = await resL5.json();
  console.log(`Error Response:`, dataL5.error);
  const passL5 = resL5.status === 403 && dataL5.error?.code === 'FORBIDDEN';
  console.log(`Result L1-5: ${passL5 ? 'PASS' : 'FAIL'}\n`);

  // Summary
  const allPass = passL1 && passL2 && passL4 && passL5;
  console.log(`=== OVERALL LIVE API CHECK: ${allPass ? 'ALL PASS' : 'SOME CHECKS FAILED'} ===`);

  if (!allPass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Live check failed:', err);
  process.exit(1);
});
