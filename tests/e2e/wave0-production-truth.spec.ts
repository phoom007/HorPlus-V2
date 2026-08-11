import { test, expect } from '@playwright/test';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import crypto from 'crypto';

const prisma = getPrismaClient();

const SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
const CSRF_SIGNING_KEY = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';

const sessionTokenService = new SessionTokenService(SESSION_ENCRYPTION_KEY);
const csrfService = new CsrfService(CSRF_SIGNING_KEY);

test.describe.serial('Wave 0 Production Truth Acceptance Suite', () => {
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let ownerDormitoryId: string;

  test.beforeAll(async () => {
    const timestamp = Date.now();
    ownerDormitoryId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const roleId = crypto.randomUUID();

    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `w0-owner-${timestamp}@example.com`,
        emailNormalized: `w0-owner-${timestamp}@example.com`,
        name: 'Wave 0 Owner',
        googleSubject: `goog-w0-owner-${timestamp}`,
        status: 'active',
      },
    });

    await prisma.session.create({
      data: {
        userId: ownerUserId,
        sessionIdHash: SessionTokenService.hashSessionId(sessionId),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    ownerSessionToken = sessionTokenService.encryptToken({ sub: ownerUserId, sid: sessionId, type: 'session', version: 1 }, 86400);
    ownerCsrfToken = csrfService.generateCsrfToken(sessionId);

    await prisma.dormitory.create({
      data: {
        id: ownerDormitoryId,
        name: 'Wave 0 Residence',
        addressLine1: '100 Truth St',
        province: 'กรุงเทพมหานคร',
        createdByUserId: ownerUserId,
        status: 'active',
      },
    });

    let roleOwner = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!roleOwner) {
      roleOwner = await prisma.role.create({
        data: {
          id: roleId,
          code: 'OWNER',
          name: 'Owner Role',
          permissions: [],
        },
      });
    }

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: ownerDormitoryId,
        userId: ownerUserId,
        roleId: roleOwner.id,
        status: 'active',
      },
    });
  });

  test.afterAll(async () => {
    if (ownerDormitoryId) {
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.dormitory.delete({ where: { id: ownerDormitoryId } }).catch(() => {});
    }
    if (ownerUserId) {
      await prisma.session.deleteMany({ where: { userId: ownerUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
    }
  });

  async function setupOwnerContext(context: any, page: any, targetPath: string) {
    await context.addCookies([
      { name: 'horplus_session', value: ownerSessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
      { name: 'horplus_csrf', value: ownerCsrfToken, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
    ]);
    await page.addInitScript((dormId: string) => {
      localStorage.setItem('selected_dormitory_id', dormId);
      sessionStorage.setItem('active_dormitory_selected_for_session', dormId);
    }, ownerDormitoryId);

    await page.goto(`http://127.0.0.1:5174${targetPath}`);
    await page.waitForLoadState('networkidle');
  }

  test('disabled /demo route in normal production runtime', async ({ page }) => {
    await page.goto('http://127.0.0.1:5174/demo');
    await expect(page).not.toHaveURL(/\/demo$/);
  });

  test('no /tenant/login -> /demo redirect', async ({ page }) => {
    await page.goto('http://127.0.0.1:5174/tenant/login');
    await expect(page).not.toHaveURL(/\/demo/);
  });

  test('Dashboard authenticated owner subscription entitlement catalog integration', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/dashboard');
    expect(page.url()).toContain('/owner/dashboard');
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('เหลือ 90 วัน');
  });

  test('Owner Meters displays meter draft notice banner for authenticated owner', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/meters');

    expect(page.url()).toContain('/owner/meters');
    const draftNotice = page.locator('[data-testid="meter-draft-notice"]');
    await expect(draftNotice).toBeVisible();
    await expect(draftNotice).toContainText('(ร่างที่ยังไม่ได้บันทึกลงเซิร์ฟเวอร์)');

    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('+ 8');
    expect(pageText).not.toContain('+ 120');
  });

  test('Owner Tenants page remains active with zero demo tenants', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/tenants');
    expect(page.url()).toContain('/owner/tenants');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('สมชาย');
    expect(bodyText).not.toContain('สมศรี');
  });

  test('Owner Contracts page remains active with zero demo contracts', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/contracts');
    expect(page.url()).toContain('/owner/contracts');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('CTR-2026-DEMO');
  });

  test('Owner Maintenance page remains active with zero demo requests', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/maintenance');
    expect(page.url()).toContain('/owner/maintenance');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('ก๊อกน้ำรั่ว');
    expect(bodyText).not.toContain('แอร์ไม่เย็น');
  });

  test('Owner Announcements page remains active with zero demo announcements', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/announcements');
    expect(page.url()).toContain('/owner/announcements');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('แจ้งปิดปรับปรุง');
  });

  test('Owner Reports displays 0 / empty state when no data exists', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/reports');

    expect(page.url()).toContain('/owner/reports');
    const bodyContent = await page.content();
    expect(bodyContent).not.toContain('อาคาร A (วิวเขา)');
  });

  test('API 500 failures render empty state without fallback to demo data', async ({ context, page }) => {
    await page.route('**/api/v1/maintenance**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal Server Error' }) }));
    await page.route('**/api/v1/announcements**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal Server Error' }) }));
    await page.route('**/api/v1/bills**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal Server Error' }) }));

    await setupOwnerContext(context, page, '/owner/maintenance');
    expect(page.url()).toContain('/owner/maintenance');
    let text = await page.textContent('body');
    expect(text).not.toContain('ก๊อกน้ำรั่ว');

    await setupOwnerContext(context, page, '/owner/announcements');
    expect(page.url()).toContain('/owner/announcements');
    text = await page.textContent('body');
    expect(text).not.toContain('แจ้งปิดปรับปรุง');

    await setupOwnerContext(context, page, '/owner/meters');
    expect(page.url()).toContain('/owner/meters');
    text = await page.textContent('body');
    expect(text).not.toContain('+ 8');
  });
});
