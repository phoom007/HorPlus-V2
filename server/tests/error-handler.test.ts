import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Error Handling and Standard Error Envelope', () => {
  const app = createApp();

  it('returns 404 with ROUTE_NOT_FOUND error envelope for unknown routes', async () => {
    const response = await request(app).get('/api/v1/auth/non-existent-endpoint');

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toEqual({
      code: 'ROUTE_NOT_FOUND',
      message: 'ไม่พบเส้นทางหรือทรัพยากรที่ร้องขอ',
      fieldErrors: null,
      requestId: expect.stringMatching(/^req_/),
      timestamp: expect.any(String),
    });
    expect(response.body.error).not.toHaveProperty('stack');
  });

  it('preserves incoming X-Request-Id header in error response', async () => {
    const customRequestId = 'test-client-req-id-12345';
    const response = await request(app)
      .get('/api/v1/auth/unknown-route')
      .set('X-Request-Id', customRequestId);

    expect(response.status).toBe(404);
    expect(response.headers['x-request-id']).toBe(customRequestId);
    expect(response.body.error.requestId).toBe(customRequestId);
  });
});
