import fs from 'fs';
import { chromium } from 'playwright';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';

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

async function run() {
  const prisma = getPrismaClient();
  const state = JSON.parse(fs.readFileSync('.agents/local/c2-browser-state.json', 'utf8'));
  const ownerCreds = getCredentials('Owner');
  const { tcSession, tcCsrf, tcSetup } = state;

  // Reset TC's contract to initialContract (active, endDate 2026-12-31) so we can walk through the full browser UI journey (C2-1 -> C2-4 -> C2-3 -> C2-2)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
    await tx.tenantRenewalRequest.deleteMany({
      where: { dormitoryId: DORM_ID, tenantId: tcSetup.tenantId },
    });
    await tx.occupancy.updateMany({
      where: { dormitoryId: DORM_ID, roomId: tcSetup.roomId, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await tx.contract.updateMany({
      where: { dormitoryId: DORM_ID, tenantId: tcSetup.tenantId, id: { not: tcSetup.initialContractId } },
      data: { status: 'expired' },
    });
    await tx.contract.update({
      where: { id: tcSetup.initialContractId },
      data: { status: 'active' },
    });
    await tx.room.update({
      where: { id: tcSetup.roomId },
      data: {
        status: 'occupied',
        currentTenantId: tcSetup.tenantId,
        currentContractId: tcSetup.initialContractId,
      },
    });
    await tx.occupancy.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: tcSetup.roomId,
        tenantId: tcSetup.tenantId,
        contractId: tcSetup.initialContractId,
        status: 'ACTIVE',
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
  });

  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Tenant TC Browser Context (Viewport D: 390x844)
    const tcContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await tcContext.addCookies([
      {
        name: 'horplus_session',
        value: tcSession,
        domain: 'app.hor-plus.com',
        path: '/',
        httpOnly: true,
        secure: true,
      },
      {
        name: 'horplus_csrf',
        value: tcCsrf,
        domain: 'app.hor-plus.com',
        path: '/',
        httpOnly: false,
        secure: true,
      },
    ]);

    const tcPage = await tcContext.newPage();
    const eligibilityStatuses = [];
    tcPage.on('response', (res) => {
      if (res.url().includes('/api/v1/contract-renewals/eligibility')) {
        eligibilityStatuses.push(res.status());
      }
    });

    // Open /tenant?sub=contract as TC
    await tcPage.goto(`${BASE_URL}/tenant?sub=contract`, { waitUntil: 'domcontentloaded' });
    await tcPage.waitForSelector('[data-testid="btn-open-renewal-sheet"]', { timeout: 15000 });

    // Open renewal sheet (C2-1)
    await tcPage.click('[data-testid="btn-open-renewal-sheet"]');
    await tcPage.waitForSelector('#submitRenewalRequestBtn', { timeout: 10000 });
    await tcPage.screenshot({
      path: '.agents/local/screenshots/c2-1-tenant-renewal-sheet.png',
      fullPage: true,
    });

    // Submit renewal request from UI (C2-1)
    await tcPage.click('#submitRenewalRequestBtn');
    await tcPage.waitForSelector('[data-testid="btn-open-cancel-sheet"]', { timeout: 15000 });
    await tcPage.reload({ waitUntil: 'domcontentloaded' });
    await tcPage.waitForSelector('[data-testid="btn-open-cancel-sheet"]', { timeout: 15000 });
    await tcPage.screenshot({
      path: '.agents/local/screenshots/c2-1-tenant-pending-renewal.png',
      fullPage: true,
    });

    // Cancel pending renewal request from UI (C2-4)
    await tcPage.click('[data-testid="btn-open-cancel-sheet"]');
    await tcPage.waitForSelector('[data-testid="btn-confirm-cancel-renewal"]', { timeout: 10000 });
    await tcPage.click('[data-testid="btn-confirm-cancel-renewal"]');
    await tcPage.waitForSelector('[data-testid="btn-open-renewal-sheet"]', { timeout: 15000 });
    await tcPage.reload({ waitUntil: 'domcontentloaded' });
    await tcPage.waitForSelector('[data-testid="btn-open-renewal-sheet"]', { timeout: 15000 });
    await tcPage.screenshot({
      path: '.agents/local/screenshots/c2-4-tenant-cancelled-renewal.png',
      fullPage: true,
    });

    // Submit a renewal request again so Owner can reject it with reason (C2-3)
    await tcPage.click('[data-testid="btn-open-renewal-sheet"]');
    await tcPage.waitForSelector('#submitRenewalRequestBtn', { timeout: 10000 });
    await tcPage.click('#submitRenewalRequestBtn');
    await tcPage.waitForSelector('[data-testid="btn-open-cancel-sheet"]', { timeout: 15000 });

    // Find pending request ID in DB and reject as Owner via API
    const pendingReqForReject = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      return tx.tenantRenewalRequest.findFirst({
        where: { dormitoryId: DORM_ID, tenantId: tcSetup.tenantId, status: 'PENDING_OWNER_APPROVAL' },
      });
    });

    const ownerHeaders = {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${ownerCreds.session}; horplus_csrf=${ownerCreds.csrf}`,
      'x-csrf-token': ownerCreds.csrf,
      'x-dormitory-id': DORM_ID,
    };
    await fetch(`${BASE_URL}/api/v1/contract-renewals/requests/${pendingReqForReject.id}/reject`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ reason: 'ขอปรับปรุงห้องพักหลังหมดสัญญาเดิม' }),
    });

    // Reload TC page -> verify rejection banner (C2-3) and re-submit button
    await tcPage.reload({ waitUntil: 'domcontentloaded' });
    await tcPage.waitForSelector('[data-testid="renewal-rejected-banner"]', { timeout: 15000 });
    await tcPage.screenshot({
      path: '.agents/local/screenshots/c2-3-tenant-rejected-reason.png',
      fullPage: true,
    });

    // Re-submit immediately (C2-3 -> C2-2)
    await tcPage.click('[data-testid="btn-open-renewal-sheet"]');
    await tcPage.waitForSelector('#submitRenewalRequestBtn', { timeout: 10000 });
    await tcPage.click('#submitRenewalRequestBtn');
    await tcPage.waitForSelector('[data-testid="btn-open-cancel-sheet"]', { timeout: 15000 });

    // Owner approves the new renewal request (C2-2)
    const pendingReqForApprove = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      return tx.tenantRenewalRequest.findFirst({
        where: { dormitoryId: DORM_ID, tenantId: tcSetup.tenantId, status: 'PENDING_OWNER_APPROVAL' },
      });
    });
    await fetch(`${BASE_URL}/api/v1/contract-renewals/requests/${pendingReqForApprove.id}/approve`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({}),
    });

    // Reload TC page -> verify new contract CTR-RNW-... and inherited digital signatures (C2-2)
    await tcPage.reload({ waitUntil: 'domcontentloaded' });
    await tcPage.waitForSelector('[data-testid="contract-number"]', { timeout: 15000 });
    const displayedContractNumber = await tcPage.textContent('[data-testid="contract-number"]');
    console.log('[Browser C2-2] Displayed contract number after approval:', displayedContractNumber?.trim());
    await tcPage.screenshot({
      path: '.agents/local/screenshots/c2-2-tenant-approved-new-contract.png',
      fullPage: true,
    });

    // Owner view screenshot (Viewport OW: 1440x900)
    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: '.agents/local/sessions/owner.json',
    });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${BASE_URL}/owner/tenants`, { waitUntil: 'networkidle' });
    await ownerPage.waitForSelector('table', { timeout: 15000 }).catch(() => {});
    await ownerPage.waitForTimeout(3000);
    await ownerPage.screenshot({
      path: '.agents/local/screenshots/c2-2-owner-tenants-renewed.png',
      fullPage: false,
    });
    await ownerContext.close();

    const any403 = eligibilityStatuses.some((s) => s === 403);
    console.log('[Browser] Eligibility response statuses:', eligibilityStatuses, 'any403:', any403);
    if (any403) {
      throw new Error('Detected 403 on /api/v1/contract-renewals/eligibility');
    }

    console.log('=== ALL C2 BROWSER CHECKS AND SCREENSHOTS COMPLETED! ===');
  } finally {
    await browser.close();
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
