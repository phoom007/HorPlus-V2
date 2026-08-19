/**
 * HorPlus LOCAL-07 — External Local Browser Launcher
 * 
 * Launches a real headed Chromium browser session authenticated as one of the 5 review personas:
 * 1. fresh-owner (Fresh Owner - Just completed onboarding)
 * 2. comp-owner (Comprehensive Owner - Full 18 rooms)
 * 3. tenant-somchai (Tenant Somchai - Room 101)
 * 4. manager (Staff Manager - Pranee)
 * 5. tech (Staff Tech - Surachai)
 * 
 * Usage:
 *   npm run uat:open -- fresh-owner
 *   npm run uat:open -- comp-owner
 *   npm run uat:open -- tenant-somchai
 *   npm run uat:open -- manager
 *   npm run uat:open -- tech
 * 
 * @license Apache-2.0
 */

// Explicit Dev/Test runtime gate
if (process.env.NODE_ENV === 'production') {
  throw new Error('CRITICAL SAFETY ERROR: LOCAL-07 browser launcher refuses execution in production environment!');
}

import { chromium } from 'playwright';
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { createAllSessions, createGoldenOwnerSession } from './login-helper.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.local07-sessions');

const PERSONA_MAP = {
  'golden-owner': { file: 'golden-owner.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Golden Owner (หอพัก Golden Manor 24 ห้อง)' },
  'golden': { file: 'golden-owner.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Golden Owner (หอพัก Golden Manor 24 ห้อง)' },
  'registration-owner': { file: 'registration-owner.json', url: 'http://127.0.0.1:5173/owner/register', name: 'Registration Owner (กรอก Onboarding UI ด้วยตนเอง)' },
  'register': { file: 'registration-owner.json', url: 'http://127.0.0.1:5173/owner/register', name: 'Registration Owner (กรอก Onboarding UI ด้วยตนเอง)' },
  'fresh-owner': { file: 'fresh-owner.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Fresh Owner (เพิ่งเสร็จสิ้น Onboarding - Service Oracle)' },
  'fresh': { file: 'fresh-owner.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Fresh Owner (เพิ่งเสร็จสิ้น Onboarding - Service Oracle)' },
  'comp-owner': { file: 'comp-owner.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Comprehensive Owner (หอพักขนาดเต็ม 18 ห้อง)' },
  'comp': { file: 'comp-owner.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Comprehensive Owner (หอพักขนาดเต็ม 18 ห้อง)' },
  'owner': { file: 'comp-owner.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Comprehensive Owner (หอพักขนาดเต็ม 18 ห้อง)' },
  'tenant-somchai': { file: 'tenant-somchai.json', url: 'http://127.0.0.1:5173/tenant/dashboard', name: 'Tenant Somchai (ผู้เช่าห้อง 101)' },
  'tenant': { file: 'tenant-somchai.json', url: 'http://127.0.0.1:5173/tenant/dashboard', name: 'Tenant Somchai (ผู้เช่าห้อง 101)' },
  'somchai': { file: 'tenant-somchai.json', url: 'http://127.0.0.1:5173/tenant/dashboard', name: 'Tenant Somchai (ผู้เช่าห้อง 101)' },
  'manager': { file: 'manager.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Staff Manager (ผู้จัดการ - นางสาวปราณี)' },
  'tech': { file: 'tech.json', url: 'http://127.0.0.1:5173/owner/dashboard', name: 'Staff Tech (ช่างเทคนิค - นายสุรชัย)' },
};

async function main() {
  // 1. Safety Guard
  const safety = assertSafeDatabaseTarget();

  // 2. Resolve Persona Argument
  const rawArg = (process.argv[2] || 'register').toLowerCase().trim();
  const persona = PERSONA_MAP[rawArg];

  if (!persona) {
    console.error(`\n❌ Unknown persona "${rawArg}"!`);
    console.log('Available personas:');
    console.log('  - golden-owner       (alias: golden)');
    console.log('  - registration-owner (alias: register)');
    console.log('  - fresh-owner        (alias: fresh)');
    console.log('  - comp-owner         (aliases: comp, owner)');
    console.log('  - tenant-somchai     (aliases: tenant, somchai)');
    console.log('  - manager');
    console.log('  - tech\n');
    console.log('Example: npm run uat:open -- golden-owner\n');
    process.exit(1);
  }

  // 3. Validate loopback target URL
  const parsedUrl = new URL(persona.url);
  if (parsedUrl.hostname !== '127.0.0.1' && parsedUrl.hostname !== 'localhost') {
    throw new Error(`CRITICAL SAFETY ERROR: Target URL host must be loopback (127.0.0.1/localhost). Found: '${parsedUrl.hostname}'`);
  }

  const sessionFile = path.join(SESSIONS_DIR, persona.file);

  // 3. Ensure Session Exists
  if (!fs.existsSync(sessionFile)) {
    console.log(`⚠️ Session state ${persona.file} not found. Generating session now...`);
    if (rawArg === 'golden-owner' || rawArg === 'golden') {
      await createGoldenOwnerSession();
    } else {
      await createAllSessions();
    }
  }

  if (!fs.existsSync(sessionFile)) {
    console.error(`❌ Failed to create or locate session state file: ${sessionFile}`);
    process.exit(1);
  }

  console.log('\n================================================================================');
  console.log(`  HORPLUS LOCAL-07 — OPENING MANUAL UAT BROWSER`);
  console.log('================================================================================');
  console.log(`👤 Persona:    ${persona.name}`);
  console.log(`🌐 Target URL: ${persona.url}`);
  console.log(`📁 Session:    .local07-sessions/${persona.file}`);
  console.log(`🔒 Safety:     PostgreSQL ${safety.host}:${safety.port} | Redis ${safety.host}:${safety.redisPort}`);
  console.log('--------------------------------------------------------------------------------');
  console.log('💡 Note: The browser window will stay open for your manual inspection.');
  console.log('   Press Ctrl+C in this terminal when you are done.');
  console.log('================================================================================\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    storageState: sessionFile,
    viewport: null, // Full window
  });

  const page = await context.newPage();

  try {
    await page.goto(persona.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (err) {
    console.warn(`⚠️ Note: Unable to reach ${persona.url} immediately (${err.message}).`);
    console.warn('   Please make sure frontend dev server is running on http://127.0.0.1:5173 (npm run dev)');
  }

  // Keep alive until browser is closed
  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
    process.on('SIGINT', async () => {
      console.log('\nClosing browser session...');
      await browser.close().catch(() => {});
      resolve();
    });
  });
}

main().catch((err) => {
  console.error(`❌ [LAUNCH ERROR] ${err.message}`);
  process.exit(1);
});
