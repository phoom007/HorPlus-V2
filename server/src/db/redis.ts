import { Redis } from 'ioredis';
import { logger } from '../config/logger.js';

let redisInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisInstance = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy(times) {
        if (times > 3) {
          return null; // Stop retrying
        }
        return Math.min(times * 100, 2000);
      },
    });

    redisInstance.on('error', (err) => {
      logger.error({ err: err.message }, 'Redis client connection error');
    });

    redisInstance.on('connect', () => {
      logger.info('Connected to Redis server');
    });
  }
  return redisInstance;
}

export function setRedisClient(mockInstance: Redis | null): void {
  redisInstance = mockInstance;
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === 'PONG';
  } catch (err) {
    logger.error({ err }, 'Redis ping check failed');
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit().catch(() => redisInstance?.disconnect());
    redisInstance = null;
    logger.info('Redis client disconnected gracefully');
  }
}
