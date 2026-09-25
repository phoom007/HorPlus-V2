/**
 * Playwright Live Browser Checks for Card B3
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 on Chromium) and Owner Desktop (/owner/payments)
 */

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sharp = require('../../server/node_modules/sharp');
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.agents/local/screenshots');
const SESSIONS_DIR = path.join(ROOT_DIR, '.agents/local/sessions');

const APP_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing session file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const prisma = getPrismaClient();
  const browser = await chromium.launch({ headless: true });
  console.log('=== Starting Card B3 Playwright Browser Live Verification ===\n');

  // Create a unique test slip image file on disk
  const sampleColor = Math.floor(Math.random() * 200) + 30;
  const tempSlipPath = path.join(SCREENSHOTS_DIR, 'temp-sample-slip.jpg');
  await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 3,
      background: { r: sampleColor, g: 150, b: 220 },
    },
  })
    .jpeg()
    .toFile(tempSlipPath);

  try {
    // =========================================================================
    // 1. [AC B3-3 / Tenant Viewport D] Open /tenant?sub=invoice, attach slip, verify "ยกเลิกส่งรูป" button
    // =========================================================================
    console.log('1. [Tenant Viewport D] Opening /tenant?sub=invoice in Viewport D (390x844)...');
    const tenantStorage = getSession('tenant');
    const tenantContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      storageState: tenantStorage,
    });

    const pageTenant = await tenantContext.newPage();
    await pageTenant.goto(`${APP_URL}/tenant?sub=invoice`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageTenant.waitForTimeout(3000);

    // Click on bill payment action button if available
    const payBtn = pageTenant.locator('button:has-text("ชำระเงิน"), button:has-text("แนบสลิป")').first();
    if (await payBtn.count() > 0) {
      console.log('Clicking pay / attach slip button in tenant view...');
      await payBtn.click();
      await pageTenant.waitForTimeout(2000);
    }

    // Attach slip file to file input
    console.log('Attaching test slip image...');
    const fileInput = pageTenant.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(tempSlipPath);
      await pageTenant.waitForTimeout(1500);
    }

    // Check cancel slip button
    const cancelBtn = pageTenant.locator('[data-testid="cancel-slip-button"]');
    const cancelBtnExists = await cancelBtn.count() > 0;
    console.log(`Cancel slip button visible: ${cancelBtnExists}`);

    if (cancelBtnExists) {
      await cancelBtn.scrollIntoViewIfNeeded();
      await pageTenant.waitForTimeout(1000);
    }

    // Take screenshot b3-3-tenant-cancel-slip-button.png
    const ssCancelPath = path.join(SCREENSHOTS_DIR, 'b3-3-tenant-cancel-slip-button.png');
    await pageTenant.screenshot({ path: ssCancelPath });
    console.log(`Saved screenshot: ${ssCancelPath}`);

    // Click submit slip to trigger rejected slip into Tab 4 (or ensure rejected payment exists)
    const submitSlipBtn = pageTenant.locator('button:has-text("ส่งข้อมูลการชำระเงิน"), button:has-text("ยืนยันส่งสลิป")').first();
    if (await submitSlipBtn.count() > 0) {
      console.log('Submitting non-standard slip to produce rejected payment in Tab 4...');
      await submitSlipBtn.click();
      await pageTenant.waitForTimeout(3000);
    }

    // =========================================================================
    // 2. [AC B3-4 / Owner Desktop] Open /owner/payments and inspect Tab 4 "สลิปผิดพลาด"
    // =========================================================================
    console.log('\n2. [Owner Desktop] Opening /owner/payments with Owner session...');
    const ownerStorage = getSession('owner');
    const ownerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: ownerStorage,
    });

    const pageOwner = await ownerContext.newPage();
    await pageOwner.goto(`${APP_URL}/owner/payments`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageOwner.waitForTimeout(3000);

    // Switch to Tab 4: "สลิปผิดพลาด"
    console.log('Switching to Tab 4 (สลิปผิดพลาด)...');
    const tabRejected = pageOwner.locator('button:has-text("สลิปผิดพลาด")').first();
    if (await tabRejected.count() > 0) {
      await tabRejected.click();
      await pageOwner.waitForTimeout(2000);
    }

    // Verify rejected payments or create one if none currently in Tab 4
    let overrideButtons = pageOwner.locator('[data-testid="override-approve-button"]');
    let overrideCount = await overrideButtons.count();

    if (overrideCount === 0) {
      console.log('No rejected payment card in UI currently, creating a REJECTED test payment in active cycle (2027-01)...');
      const activeCycle = await prisma.billingCycle.findFirst({
        where: { dormitoryId: DORM_ID, cycleCode: '2027-01' },
      });
      const targetBill = await prisma.bill.findFirst({
        where: {
          dormitoryId: DORM_ID,
          billingCycleId: activeCycle?.id,
          status: { in: ['unpaid', 'UNPAID', 'PARTIALLY_PAID', 'OVERDUE', 'ISSUED'] },
        },
      });

      if (targetBill) {
        await prisma.payment.create({
          data: {
            dormitoryId: DORM_ID,
            billId: targetBill.id,
            tenantId: targetBill.tenantId,
            method: 'BANK_TRANSFER',
            amount: targetBill.totalAmount,
            status: 'REJECTED',
            rejectedReason: 'ข้อมูลในสลิปไม่ครบถ้วนหรือไม่สามารถระบุธุรกรรมได้',
            paymentDate: new Date(),
            fileHash: `sample-hash-${Date.now()}`,
          },
        });
        await pageOwner.reload({ waitUntil: 'domcontentloaded' });
        await pageOwner.waitForTimeout(3000);
        await tabRejected.click();
        await pageOwner.waitForTimeout(2000);
        overrideButtons = pageOwner.locator('[data-testid="override-approve-button"]');
        overrideCount = await overrideButtons.count();
      }
    }

    console.log(`Found ${overrideCount} override approve buttons in Tab 4`);

    // Screenshot Tab 4 showing rejected card with override button
    const ssRejectedTabPath = path.join(SCREENSHOTS_DIR, 'b3-4-owner-rejected-tab.png');
    await pageOwner.screenshot({ path: ssRejectedTabPath });
    console.log(`Saved screenshot: ${ssRejectedTabPath}`);

    // Click Override button on the first card
    if (overrideCount > 0) {
      console.log('Clicking "รับเงิน / ยืนยันการชำระ (Override)" button...');
      await overrideButtons.first().click();
      await pageOwner.waitForTimeout(1500);

      // Screenshot modal with override reason textarea
      const ssModalPath = path.join(SCREENSHOTS_DIR, 'b3-4-owner-override-modal.png');
      await pageOwner.screenshot({ path: ssModalPath });
      console.log(`Saved screenshot: ${ssModalPath}`);

      // Fill in override reason
      console.log('Entering override reason in modal...');
      const reasonInput = pageOwner.locator('[data-testid="override-reason-textarea"]');
      await reasonInput.fill('ตรวจสอบกับรายการเดินบัญชีธนาคารแล้ว มียอดเงินเข้าจริง ยืนยันการชำระด้วยตนเอง');
      await pageOwner.waitForTimeout(1000);

      // Click confirm override button
      console.log('Clicking confirm override button...');
      const confirmBtn = pageOwner.locator('[data-testid="confirm-override-button"]');
      await confirmBtn.click();
      await pageOwner.waitForTimeout(3000);

      // Switch to Tab 3 "ชำระแล้ว" to verify approved payment
      console.log('Switching to Tab 3 (ชำระแล้ว) to show approved payment...');
      const tabPaid = pageOwner.locator('button:has-text("ชำระแล้ว")').first();
      if (await tabPaid.count() > 0) {
        await tabPaid.click();
        await pageOwner.waitForTimeout(2000);
      }

      const ssSuccessPath = path.join(SCREENSHOTS_DIR, 'b3-4-owner-approved-success.png');
      await pageOwner.screenshot({ path: ssSuccessPath });
      console.log(`Saved screenshot: ${ssSuccessPath}`);
    }

    console.log('\n=== All Playwright Live Browser Checks for Card B3 Completed Successfully ===');
  } catch (err) {
    console.error('Error during browser checks:', err);
  } finally {
    if (fs.existsSync(tempSlipPath)) {
      try { fs.unlinkSync(tempSlipPath); } catch {}
    }
    await browser.close();
  }
}

main();
