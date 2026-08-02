import { Redis } from 'ioredis';
import { logger } from '../config/logger.js';

let redisInstance: Redis | null = null;
let connectionPromise: Promise<void> | null = null;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisInstance = new Redis(redisUrl, {
      lazyConnect: true,
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
  connectionPromise = null;
}

export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  
  // If already connected or ready, do nothing
  if (client.status === 'ready' || client.status === 'connect') {
    return;
  }
  
  // If connection is in progress, await the existing promise
  if (connectionPromise) {
    return connectionPromise;
  }
  
  // Initiate new connection
  connectionPromise = client.connect().catch((err) => {
    connectionPromise = null;
    throw err;
  });
  
  return connectionPromise;
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const client = getRedisClient();
    // Do not attempt to ping if the client isn't ready
    if (client.status !== 'ready') {
      return false;
    }
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
    connectionPromise = null;
    logger.info('Redis client disconnected gracefully');
  }
}
