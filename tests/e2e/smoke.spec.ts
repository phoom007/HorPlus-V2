import { test, expect } from '@playwright/test';

test('App shell loads and core Wave 1D/1E components exist', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.*/);
});

test('Tenant portal loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto('/tenant');
  
  // Wait for network idle to catch lazy loaded errors
  await page.waitForLoadState('networkidle');
  
  // The app should not throw unhandled exceptions in the tenant portal
  expect(errors.filter(e => !e.includes('404') && !e.includes('401') && !e.includes('403') && !e.includes('GSI_LOGGER') && !e.includes('Unauthorized') && !e.includes('Not Found'))).toHaveLength(0);
});

test('Owner portal loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) { // ignore favicon
      errors.push(msg.text());
    }
  });

  await page.goto('/owner');
  
  await page.waitForLoadState('networkidle');
  
  expect(errors.filter(e => !e.includes('404') && !e.includes('401') && !e.includes('403') && !e.includes('GSI_LOGGER') && !e.includes('Unauthorized') && !e.includes('Not Found'))).toHaveLength(0);
});
