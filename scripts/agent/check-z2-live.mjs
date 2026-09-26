/**
 * Z2 Live Verification Script
 * Validates Z2-1, Z2-2 on live pilot app.hor-plus.com
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.agents/local/sessions');
const APP_URL = 'https://app.hor-plus.com';

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing session file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getCookieHeader(session) {
  return session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function main() {
  console.log('=== Starting Card Z2 Live Verification ===\n');

  const tenantSession = getSession('tenant');
  const cookieHeader = getCookieHeader(tenantSession);
  const csrfCookie = tenantSession.cookies.find(c => c.name === 'horplus_csrf');
  const csrfToken = csrfCookie?.value || '';

  const results = [];

  // --- AC Z2-1: Live Frontend Bundle Scrutiny ---
  console.log('Checking Z2-1: Live frontend bundle for hardcoded values...');
  const indexHtmlRes = await fetch(`${APP_URL}/tenant`, {
    headers: { Cookie: cookieHeader }
  });
  const indexHtml = await indexHtmlRes.text();
  
  // Look for js bundles referenced in html
  const jsMatch = indexHtml.match(/src="([^"]+\.js)"/g) || [];
  let foundForbiddenInLiveBundle = false;
  for (const match of jsMatch) {
    const jsPath = match.replace(/src="|"/g, '');
    const jsUrl = jsPath.startsWith('http') ? jsPath : `${APP_URL}${jsPath.startsWith('/') ? '' : '/'}${jsPath}`;
    try {
      const jsRes = await fetch(jsUrl);
      if (jsRes.ok) {
        const jsText = await jsRes.text();
        if (jsText.includes('2011672957-NOfBsIcJ')) {
          console.error(`Found hardcoded owner LIFF ID in live bundle ${jsUrl}`);
          foundForbiddenInLiveBundle = true;
        }
      }
    } catch {}
  }

  if (!foundForbiddenInLiveBundle) {
    console.log('✓ Z2-1: Live bundle clean of hardcoded owner LIFF ID.');
    results.push({ ac: 'Z2-1', status: 'PASS', detail: 'Live frontend bundle clean' });
  } else {
    console.error('✗ Z2-1: Live bundle contained hardcoded values.');
    results.push({ ac: 'Z2-1', status: 'FAIL', detail: 'Found hardcoded values in live bundle' });
  }

  // --- AC Z2-2: Live API Thai Error Messages ---
  console.log('\nChecking Z2-2: Localized Thai error messages on live API...');
  
  // Test 1: Message is required in maintenance comments
  const commentRes = await fetch(`${APP_URL}/api/v1/tenant-portal/maintenance/00000000-0000-0000-0000-000000000000/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify({ message: '' })
  });
  const commentJson = await commentRes.json();
  const commentMsg = commentJson?.error?.message;
  console.log(`- Maintenance comment without message: HTTP ${commentRes.status}, error.message: "${commentMsg}"`);
  const commentPass = commentRes.status === 400 && commentMsg === 'กรุณาระบุข้อความ';

  // Test 2: Tenant signature not found
  const sigRes = await fetch(`${APP_URL}/api/v1/tenant-portal/contract/signatures/tenant`, {
    headers: { Cookie: cookieHeader }
  });
  let sigMsg = '';
  try {
    const sigJson = await sigRes.json();
    sigMsg = sigJson?.error?.message;
  } catch {}
  console.log(`- Tenant signature check: HTTP ${sigRes.status}, message: "${sigMsg}"`);
  // If tenant has signature, it returns 200 image/png; if not, 404 with Thai message
  const sigPass = sigRes.status === 200 || sigMsg === 'ไม่พบลายเซ็นของผู้เช่า';

  // Test 3: Unauthenticated profile call -> Thai message (กรุณาเข้าสู่ระบบก่อนใช้งาน or ยังไม่ได้เข้าสู่ระบบ)
  const unauthRes = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`);
  const unauthJson = await unauthRes.json();
  const unauthMsg = unauthJson?.error?.message;
  console.log(`- Unauthenticated profile check: HTTP ${unauthRes.status}, message: "${unauthMsg}"`);
  const unauthPass = unauthRes.status === 401 && (unauthMsg === 'กรุณาเข้าสู่ระบบก่อนใช้งาน' || unauthMsg === 'ยังไม่ได้เข้าสู่ระบบ');

  if (commentPass && sigPass && unauthPass) {
    console.log('✓ Z2-2: All live error responses return concise Thai messages.');
    results.push({ ac: 'Z2-2', status: 'PASS', detail: 'All error responses verified in Thai' });
  } else {
    console.error('✗ Z2-2: One or more error responses failed Thai localization.');
    results.push({ ac: 'Z2-2', status: 'FAIL', detail: `comment: ${commentPass}, sig: ${sigPass}, unauth: ${unauthPass}` });
  }

  console.log('\n=== Summary of Live Checks ===');
  results.forEach(r => console.log(`[${r.ac}] ${r.status}: ${r.detail}`));

  const allPassed = results.every(r => r.status === 'PASS');
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Z2 Live verification error:', err);
  process.exit(1);
});
