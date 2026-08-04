import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

test.describe('Wave 1E - Payment Slip Flow (Unmocked)', () => {
  test('Tenant uploads slip and Owner approves', async ({ page }) => {
    test.setTimeout(60000);
    // Auto-accept all alerts/dialogs
    page.on('dialog', dialog => dialog.accept());

    // Intercept API calls for Tenant
    await page.route('**/api/v1/auth/session', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            user: { id: 'tenant-1', name: 'Tenant', role: 'TENANT' },
            tenant: { id: 'tenant-1', name: 'Tenant' },
            onboardingRequired: false
          }
        })
      });
    });

    await page.route('**/api/v1/payments/slip/intent', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ uploadUrl: 'http://mock-upload', intentId: 'intent-123' })
      });
    });

    await page.route('http://mock-upload', async route => {
      await route.fulfill({ status: 200, body: 'OK' });
    });

    await page.route('**/api/v1/payments/slip/submit', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: 'mock-payment-1',
            status: 'PENDING',
            amount: 1500,
            evidenceUrl: 'mock-url',
            billId: 'mock-bill-1'
          }
        })
      });
    });

    // Create dummy file
    const testFile = path.join(os.tmpdir(), 'test-slip.jpg');
    fs.writeFileSync(testFile, 'dummy');

    // 1. Tenant Side Flow
    await page.goto('/tenant');
    await page.evaluate(() => {
      localStorage.setItem('HorPlus_demo_session', JSON.stringify({
        sessionId: 'sess_tenant_test',
        userType: 'tenant',
        user: { id: 'tenant-1', name: 'Tenant', role: 'TENANT' },
        tenant: { id: 'tenant-1', name: 'Tenant', dormitoryId: 'dorm-1' },
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        isDemo: true
      }));
      localStorage.setItem('HorPlus_bills', JSON.stringify([{
        id: 'mock-bill-1', cycleId: '2026-07', status: 'pending', tenantId: 'tenant-1',
        totalAmount: 1500, billNumber: 'BILL-001', createdAt: new Date().toISOString(),
        dueDate: '2026-08-05', items: []
      }]));
    });
    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');

    // Pay Flow
    await page.getByRole('button', { name: 'ชำระเงิน' }).click();
    await page.getByRole('button', { name: 'แจ้งชำระเงิน' }).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=อัปโหลดรูปสลิปโอนเงิน').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testFile);
    await page.getByRole('button', { name: 'ส่งหลักฐาน' }).click();
    await expect(page.locator('text=ส่งหลักฐานสำเร็จ')).toBeVisible({ timeout: 10000 });

    // 2. Owner Side Setup
    await page.unroute('**/api/v1/auth/session');
    await page.route('**/api/v1/auth/session', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            user: { id: 'owner-1', name: 'Owner', roleId: 'role-owner', dormitories: [{ id: 'dorm-1', name: 'Mock Dorm' }] },
            onboardingRequired: false
          }
        })
      });
    });

    // Mock rooms and properties so isApiConnected is true
    await page.route('**/api/v1/properties/rooms*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'room-1', roomNumber: '101' }] }) });
    });
    await page.route('**/api/v1/properties/buildings*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'b-1', name: 'อาคาร A' }] }) });
    });
    await page.route('**/api/v1/tenants*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'tenant-1', name: 'สมชาย รักดี', roomId: 'room-1' }] }) });
    });
    await page.route('**/api/v1/contracts*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
    await page.route('**/api/v1/maintenance*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
    await page.route('**/api/v1/announcements*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });

    // Mock bills for owner (bill has been submitted and is under 'checking' status)
    await page.route('**/api/v1/bills*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'mock-bill-1',
              status: 'checking',
              totalAmount: 1500,
              tenantId: 'tenant-1',
              billNumber: 'BILL-001',
              cycleId: '2026-07'
            }
          ]
        })
      });
    });

    await page.evaluate(() => {
      localStorage.setItem('HorPlus_demo_session', JSON.stringify({
        sessionId: 'sess_owner_test',
        userType: 'owner',
        user: { id: 'owner-1', name: 'Owner', dormitoryId: 'dorm-1', roleId: 'role-owner', dormitories: [{ id: 'dorm-1', name: 'Mock Dorm' }] },
        dormitoryId: 'dorm-1',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        isDemo: true
      }));
    });

    await page.goto('/owner/payments');
    await page.waitForLoadState('networkidle');

    // Verify "อนุมัติ" button is visible in 'checking' tab
    const approveBtn = page.getByRole('button', { name: 'อนุมัติ' }).first();
    await expect(approveBtn).toBeVisible({ timeout: 10000 });

    // Update the mock to return bill as paid once approved
    await page.unroute('**/api/v1/bills*');
    await page.route('**/api/v1/bills*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'mock-bill-1',
              status: 'paid',
              totalAmount: 1500,
              tenantId: 'tenant-1',
              billNumber: 'BILL-001',
              cycleId: '2026-07'
            }
          ]
        })
      });
    });

    await approveBtn.click();
    await expect(approveBtn).not.toBeVisible({ timeout: 10000 });
  });
});
