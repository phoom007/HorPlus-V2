import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('API Root Placeholder', () => {
  const app = createApp();

  it('returns foundation metadata at GET /', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      service: 'horplus-api',
      version: '0.1.0',
      status: 'foundation',
    });
  });

  it('returns foundation metadata at GET /api/v1', async () => {
    const response = await request(app).get('/api/v1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      service: 'horplus-api',
      version: '0.1.0',
      status: 'foundation',
    });
  });
});
