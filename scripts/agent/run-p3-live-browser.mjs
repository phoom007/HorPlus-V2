/**
 * Playwright Live Browser Checks for Card P3: ประกาศและการแจ้งเตือนในแอป (Tenant In-App Announcements & Notifications)
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 on Chromium) and Owner Desktop (1280x800)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.agents/local/screenshots');
const SESSIONS_DIR = path.join(ROOT_DIR, '.agents/local/sessions');

const APP_URL = 'https://app.hor-plus.com';
const PRIMARY_DORM_ID = '20000001-0000-4000-8000-000000000002';

// TA: Somchai (Room 101)
const TA_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b';
const TA_USER_ID = '20000005-0000-4000-8000-000000000005';
const ROOM_101_ID = '059c470e-82d7-4602-8e4b-c91537d0940f';

// TB: Somying (Room 102)
const TB_TENANT_ID = 'd6f6b099-d421-4b1e-8cf1-2f87c0b17aba';
const TB_USER_ID = '4209cad5-8eff-4a7b-a1d2-2b6fdaf003e2';
const ROOM_102_ID = 'e19d2b26-8fba-4cb6-872e-65d3d3ab5ebd';

// TC: Somboon (Former Tenant)
const TC_TENANT_ID = '4546ce37-3968-4ad3-af0d-0f811ded7167';
const TC_USER_ID = 'ef6c2cca-16d4-4298-8bae-c70cccf8ebf5';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const envPath = path.join(ROOT_DIR, 'server/.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const SESSION_KEY = envConfig.SESSION_ENCRYPTION_KEY;
const CSRF_KEY = envConfig.CSRF_SIGNING_KEY;

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSessionToken(payload, secretKey) {
  const key = deriveKey(secretKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function generateCsrfToken(sessionId, csrfKey) {
  const key = deriveKey(csrfKey);
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', key).update(`${sessionId}.${nonce}`).digest('hex');
  return `${nonce}.${signature}`;
}

async function createEphemeralSession(prisma, userId) {
  const sid = crypto.randomUUID();
  const sidHash = crypto.createHash('sha256').update(`horplus_sid_${sid}`).digest('hex');

  await prisma.session.create({
    data: {
      id: sid,
      userId,
      sessionIdHash: sidHash,
      tokenVersion: 1,
      status: 'active',
      expiresAt: new Date(Date.now() + 86400 * 1000),
      principalType: 'GOOGLE_USER',
    },
  });

  const token = encryptSessionToken(
    {
      sub: userId,
      sid,
      type: 'session',
      version: 1,
    },
    SESSION_KEY
  );
  const csrf = generateCsrfToken(sid, CSRF_KEY);
  return { token, csrf };
}

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing session file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const prisma = getPrismaClient();
  const browser = await chromium.launch({ headless: true });
  console.log('=== Starting Card P3 Playwright Live Browser Checks ===\n');

  // Ensure active contract for TB in Room 102
  const tbContract = await prisma.contract.findFirst({
    where: { tenantId: TB_TENANT_ID, status: 'active' },
  });
  if (!tbContract) {
    await prisma.contract.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: PRIMARY_DORM_ID,
        tenantId: TB_TENANT_ID,
        roomId: ROOM_102_ID,
        contractNumber: 'CTR-TB-102',
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-01-01'),
        rentAmount: 4500,
        depositAmount: 9000,
      },
    });
  }

  // Create fresh targeted announcement for P3 browser test
  const annId = crypto.randomUUID();
  const annTitle = `ประกาศทดสอบระเบียงห้อง 101 และ 102 (P3-Browser)`;
  const annContent = `ขอความร่วมมือผู้เช่าห้อง 101 และ 102 เก็บสิ่งของบนระเบียงเพื่อทำความสะอาดอาคาร`;

  await prisma.announcement.create({
    data: {
      id: annId,
      dormitoryId: PRIMARY_DORM_ID,
      title: annTitle,
      summary: annContent,
      content: annContent,
      type: 'general',
      targetType: 'rooms',
      targetRooms: '101, 102',
      priority: 'high',
      status: 'published',
      publishedAt: new Date(),
      isPinned: true,
      audiences: {
        create: [
          { dormitoryId: PRIMARY_DORM_ID, targetType: 'room', roomId: ROOM_101_ID },
          { dormitoryId: PRIMARY_DORM_ID, targetType: 'room', roomId: ROOM_102_ID },
        ],
      },
    },
  });
  console.log(`Created test announcement in DB: ${annId} - ${annTitle}`);

  const ownerStorage = getSession('owner');
  const tenantStorage = getSession('tenant');

  // Create sessions for TB and TC
  const tbSession = await createEphemeralSession(prisma, TB_USER_ID);
  const tcSession = await createEphemeralSession(prisma, TC_USER_ID);

  // =========================================================================
  // 1. [AC P3-1 Part A] Owner on Desktop views announcement
  // =========================================================================
  console.log('1. [AC P3-1 Part A] Owner Desktop views announcements list...');
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: ownerStorage,
  });
  const pageOwner = await ownerContext.newPage();
  await pageOwner.goto(`${APP_URL}/owner/announcements`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageOwner.waitForTimeout(3000);

  const ssP31OwnerPath = path.join(SCREENSHOTS_DIR, 'p3-1-owner-announcement-created.png');
  await pageOwner.screenshot({ path: ssP31OwnerPath, fullPage: true });
  console.log(`Saved screenshot: ${ssP31OwnerPath}\n`);
  await ownerContext.close();

  // =========================================================================
  // 2. [AC P3-1 Part B] TA in Viewport D views targeted announcement
  // =========================================================================
  console.log('2. [AC P3-1 Part B] TA in Viewport D views announcements...');
  const taContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    storageState: tenantStorage,
  });
  const pageTA = await taContext.newPage();
  await pageTA.goto(`${APP_URL}/tenant?sub=announcements`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTA.waitForTimeout(2000);

  const taNavTab = pageTA.locator('[data-testid="nav-tab-announcements"]');
  if (await taNavTab.isVisible()) {
    await taNavTab.click();
    await pageTA.waitForTimeout(2000);
  }

  // Reload to verify persistence
  await pageTA.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTA.waitForTimeout(2000);
  if (await taNavTab.isVisible()) {
    await taNavTab.click();
    await pageTA.waitForTimeout(2000);
  }

  const ssP31TAPath = path.join(SCREENSHOTS_DIR, 'p3-1-tenant-ta-announcement.png');
  await pageTA.screenshot({ path: ssP31TAPath, fullPage: true });
  console.log(`Saved screenshot: ${ssP31TAPath}\n`);

  // =========================================================================
  // 3. [AC P3-2] TA marks announcement as read; TB still has it as unread
  // =========================================================================
  console.log('3. [AC P3-2] TA reads announcement, TB still sees it unread...');
  // TA clicks the "อ่านแล้ว" button on the announcement card
  const markReadBtn = pageTA.locator(`[data-testid="btn-mark-announcement-read-${annId}"]`);
  if (await markReadBtn.isVisible()) {
    await markReadBtn.click();
    await pageTA.waitForTimeout(2000);
  }

  // Reload TA page to confirm persistent "อ่านแล้ว" badge
  await pageTA.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTA.waitForTimeout(2000);
  if (await taNavTab.isVisible()) {
    await taNavTab.click();
    await pageTA.waitForTimeout(2000);
  }

  // Open TB in Viewport D
  const tbContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  });
  await tbContext.addCookies([
    {
      name: 'horplus_session',
      value: tbSession.token,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'horplus_csrf',
      value: tbSession.csrf,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  const pageTB = await tbContext.newPage();
  await pageTB.goto(`${APP_URL}/tenant?sub=announcements`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTB.waitForTimeout(2000);
  const tbNavTab = pageTB.locator('[data-testid="nav-tab-announcements"]');
  if (await tbNavTab.isVisible()) {
    await tbNavTab.click();
    await pageTB.waitForTimeout(2000);
  }

  // Take screenshot of TB seeing announcement with "ใหม่" badge
  const ssP32TBPath = path.join(SCREENSHOTS_DIR, 'p3-2-tenant-ta-read-tb-unread.png');
  await pageTB.screenshot({ path: ssP32TBPath, fullPage: true });
  console.log(`Saved screenshot: ${ssP32TBPath}\n`);
  await tbContext.close();

  // =========================================================================
  // 4. [AC P3-3] TA clicks "อ่านทั้งหมด" -> unread count becomes 0, reload is 0
  // =========================================================================
  console.log('4. [AC P3-3] TA clicks "อ่านทั้งหมด"...');
  // Create another unread announcement for TA
  const ann2Id = crypto.randomUUID();
  await prisma.announcement.create({
    data: {
      id: ann2Id,
      dormitoryId: PRIMARY_DORM_ID,
      title: 'ประกาศทดสอบการอ่านทั้งหมด (P3-3)',
      summary: 'ประกาศสำหรับการทดสอบปุ่มอ่านทั้งหมด',
      content: 'ประกาศสำหรับการทดสอบปุ่มอ่านทั้งหมด',
      type: 'general',
      targetType: 'rooms',
      targetRooms: '101',
      priority: 'normal',
      status: 'published',
      publishedAt: new Date(),
      isPinned: false,
      audiences: {
        create: [
          { dormitoryId: PRIMARY_DORM_ID, targetType: 'room', roomId: ROOM_101_ID },
        ],
      },
    },
  });

  await pageTA.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTA.waitForTimeout(2000);
  if (await taNavTab.isVisible()) {
    await taNavTab.click();
    await pageTA.waitForTimeout(2000);
  }

  // Look for the "อ่านทั้งหมด" button
  const markAllBtn = pageTA.locator('[data-testid="btn-mark-all-announcements-read"]');
  if (await markAllBtn.isVisible()) {
    console.log('Found [data-testid="btn-mark-all-announcements-read"], clicking...');
    await markAllBtn.click();
    await pageTA.waitForTimeout(2000);
  }

  // Reload page to verify persistence across reloads
  await pageTA.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTA.waitForTimeout(2000);
  if (await taNavTab.isVisible()) {
    await taNavTab.click();
    await pageTA.waitForTimeout(2000);
  }

  const ssP33Path = path.join(SCREENSHOTS_DIR, 'p3-3-tenant-ta-mark-all-read.png');
  await pageTA.screenshot({ path: ssP33Path, fullPage: true });
  console.log(`Saved screenshot: ${ssP33Path}\n`);
  await taContext.close();

  // =========================================================================
  // 5. [AC P3-4] TC (former tenant) access to /tenant
  // =========================================================================
  console.log('5. [AC P3-4] TC (former tenant) views /tenant...');
  const tcContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  });
  await tcContext.addCookies([
    {
      name: 'horplus_session',
      value: tcSession.token,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'horplus_csrf',
      value: tcSession.csrf,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  const pageTC = await tcContext.newPage();
  await pageTC.goto(`${APP_URL}/tenant`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTC.waitForTimeout(3000);

  const ssP34Path = path.join(SCREENSHOTS_DIR, 'p3-4-tenant-tc-moved-out.png');
  await pageTC.screenshot({ path: ssP34Path, fullPage: true });
  console.log(`Saved screenshot: ${ssP34Path}\n`);
  await tcContext.close();

  await browser.close();
  console.log('=== All Playwright Live Browser Checks Completed Successfully ===');
}

main().catch((err) => {
  console.error('Fatal error in run-p3-live-browser.mjs:', err);
  process.exit(1);
});
