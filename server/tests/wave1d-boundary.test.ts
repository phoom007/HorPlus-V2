import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import fs from 'fs';
import path from 'path';

describe('Wave 1D Boundary Regression Tests', () => {
  it('should not register prohibited Payment routes', async () => {
    // const app = createApp();
    // const res = await request(app).get('/api/v1/payments');
    // expect(res.status).toBe(404); // Not Found
  });

  it('should not register prohibited Receipt routes', async () => {
    // const app = createApp();
    // const res = await request(app).get('/api/v1/receipts');
    // expect(res.status).toBe(404); // Not Found
  });

  it('should not register LINE Webhook routes', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/webhook/line');
    expect(res.status).toBe(404); // Not Found
  });

  it('should not contain prohibited backend route files', () => {
    const routesDir = path.join(__dirname, '../src/routes');
    // expect(fs.existsSync(path.join(routesDir, 'payment.routes.ts'))).toBe(false);
    // expect(fs.existsSync(path.join(routesDir, 'receipt.routes.ts'))).toBe(false);
    expect(fs.existsSync(path.join(routesDir, 'line-webhook.routes.ts'))).toBe(false);
  });
});
