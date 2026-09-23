import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.agents/local/screenshots');

async function capture() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  const roles = [
    { name: 'owner', url: 'https://app.hor-plus.com/owner/dashboard', state: path.join(ROOT_DIR, '.agents/local/sessions/owner.json') },
    { name: 'manager', url: 'https://app.hor-plus.com/owner/dashboard', state: path.join(ROOT_DIR, '.agents/local/sessions/manager.json') },
    { name: 'staff', url: 'https://app.hor-plus.com/owner/dashboard', state: path.join(ROOT_DIR, '.agents/local/sessions/staff.json') },
    { name: 'tenant', url: 'https://app.hor-plus.com/tenant/dashboard', state: path.join(ROOT_DIR, '.agents/local/sessions/tenant.json') },
  ];

  for (const r of roles) {
    console.log(`Navigating to ${r.url} as ${r.name}...`);
    const context = await browser.newContext({
      storageState: r.state,
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    try {
      await page.goto(r.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      const outPath = path.join(SCREENSHOTS_DIR, `${r.name}-dashboard.png`);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`✅ Saved screenshot: ${outPath} (URL: ${page.url()})`);
    } catch (e) {
      console.error(`❌ Error capturing ${r.name}:`, e.message);
    } finally {
      await context.close();
    }
  }

  await browser.close();
}

capture().catch((e) => {
  console.error('Fatal capture error:', e);
  process.exit(1);
});
