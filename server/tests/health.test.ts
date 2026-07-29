import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as prismaModule from '../src/db/prisma.js';
import * as redisModule from '../src/db/redis.js';

describe('Health Checks & Metrics API', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /health/liveness', () => {
    it('returns 200 UP without querying database or redis', async () => {
      const dbSpy = vi.spyOn(prismaModule, 'checkDatabaseConnection');
      const redisSpy = vi.spyOn(redisModule, 'checkRedisConnection');

      const response = await request(app).get('/health/liveness');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'UP');
      expect(response.body).toHaveProperty('service', 'horplus-api');
      expect(response.headers).toHaveProperty('x-request-id');
      expect(dbSpy).not.toHaveBeenCalled();
      expect(redisSpy).not.toHaveBeenCalled();
    });
  });

  describe('GET /health/readiness', () => {
    it('returns 200 READY when DB and Redis are UP', async () => {
      vi.spyOn(prismaModule, 'checkDatabaseConnection').mockResolvedValue(true);
      vi.spyOn(redisModule, 'checkRedisConnection').mockResolvedValue(true);

      const response = await request(app).get('/health/readiness');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'READY',
        dependencies: {
          database: 'UP',
          redis: 'UP',
        },
        timestamp: expect.any(String),
      });
    });

    it('returns 503 NOT_READY when Database is DOWN', async () => {
      vi.spyOn(prismaModule, 'checkDatabaseConnection').mockResolvedValue(false);
      vi.spyOn(redisModule, 'checkRedisConnection').mockResolvedValue(true);

      const response = await request(app).get('/health/readiness');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'NOT_READY',
        dependencies: {
          database: 'DOWN',
          redis: 'UP',
        },
        timestamp: expect.any(String),
      });
    });

    it('returns 503 NOT_READY when Redis is DOWN', async () => {
      vi.spyOn(prismaModule, 'checkDatabaseConnection').mockResolvedValue(true);
      vi.spyOn(redisModule, 'checkRedisConnection').mockResolvedValue(false);

      const response = await request(app).get('/health/readiness');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'NOT_READY',
        dependencies: {
          database: 'UP',
          redis: 'DOWN',
        },
        timestamp: expect.any(String),
      });
    });

    it('returns 503 NOT_READY when both DB and Redis are DOWN', async () => {
      vi.spyOn(prismaModule, 'checkDatabaseConnection').mockResolvedValue(false);
      vi.spyOn(redisModule, 'checkRedisConnection').mockResolvedValue(false);

      const response = await request(app).get('/health/readiness');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'NOT_READY',
        dependencies: {
          database: 'DOWN',
          redis: 'DOWN',
        },
        timestamp: expect.any(String),
      });
    });
  });

  describe('GET /health/metrics', () => {
    it('returns process metrics with request statistics', async () => {
      const response = await request(app).get('/health/metrics');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('uptimeSeconds');
      expect(response.body).toHaveProperty('totalRequests');
      expect(response.body).toHaveProperty('activeRequests');
      expect(response.body).toHaveProperty('memoryUsageMb');
      expect(response.body.memoryUsageMb).toHaveProperty('rss');
      expect(response.body.memoryUsageMb).toHaveProperty('heapTotal');
      expect(response.body.memoryUsageMb).toHaveProperty('heapUsed');
    });
  });
});
