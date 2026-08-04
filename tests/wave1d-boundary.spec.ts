import { test, expect } from '@playwright/test';

test.describe('Wave 1D Boundary Smoke Tests', () => {
  test('Application shell loads successfully without fatal errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => {
      errors.push(err.message);
    });

    await page.goto('/');
    
    // Expect the title or main container to load
    await expect(page).toHaveURL(/.*localhost.*/);
    
    // No fatal page errors
    expect(errors).toHaveLength(0);
  });
  test.skip('Payment and Receipt navigation/action is absent on tenant dashboard', async ({ page }) => {
    // Mock auth session to avoid redirect to demo page
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('horplus_demo_session', JSON.stringify({
        sessionId: 'mock-session',
        userType: 'tenant',
        tenant: { id: 'tenant-1', name: 'Mock Tenant' },
        dormitoryId: 'dorm-1'
      }));
    });
    
    // Go to tenant dashboard
    await page.goto('/tenant/dashboard');

    // Navigation should not have Payment
    // await expect(billsTab).toBeVisible({ timeout: 10000 });
    
    // There should be no "ชำระเงินตอนนี้" (Pay now) or "ประวัติจ่าย" (Payment History) buttons
    await expect(page.locator('text=ชำระเงินตอนนี้')).toHaveCount(0);
    await expect(page.locator('text=ประวัติจ่าย')).toHaveCount(0);

    // There should be no payment upload UI or Receipt UI
    await expect(page.locator('text=แนบสลิป')).toHaveCount(0);
  });

  test.skip('Owner reports dashboard should not render payment toggle', async ({ page }) => {
    await page.goto('/owner/dashboard');
    // Ensure no 'แสดงข้อมูลการชำระเงิน' toggle exists
    await expect(page.locator('text=แสดงข้อมูลการชำระเงิน')).toHaveCount(0);
  });

  test.skip('Features page should not list Payment or Receipt', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=ออกใบเสร็จรับเงิน')).toHaveCount(0);
    await expect(page.locator('text=ตรวจสอบการชำระเงินและสลิป')).toHaveCount(0);
  });
});
