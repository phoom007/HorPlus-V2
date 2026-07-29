import { checkDatabaseConnection } from '../db/prisma.js';
import { checkRedisConnection } from '../db/redis.js';

let totalRequestsCount = 0;
let activeRequestsCount = 0;

export function incrementMetricsRequestCount(): void {
  totalRequestsCount++;
  activeRequestsCount++;
}

export function decrementMetricsActiveRequests(): void {
  if (activeRequestsCount > 0) {
    activeRequestsCount--;
  }
}

export interface HealthStatus {
  status: 'UP' | 'DOWN';
  service: string;
  timestamp: string;
}

export interface ReadinessStatus {
  status: 'READY' | 'NOT_READY';
  dependencies: {
    database: 'UP' | 'DOWN';
    redis: 'UP' | 'DOWN';
  };
  timestamp: string;
}

export interface MetricsStatus {
  uptimeSeconds: number;
  totalRequests: number;
  activeRequests: number;
  memoryUsageMb: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  timestamp: string;
}

export async function checkLiveness(): Promise<HealthStatus> {
  return {
    status: 'UP',
    service: 'horplus-api',
    timestamp: new Date().toISOString(),
  };
}

export async function checkReadiness(): Promise<{ isReady: boolean; data: ReadinessStatus }> {
  const [isDbUp, isRedisUp] = await Promise.all([
    checkDatabaseConnection(),
    checkRedisConnection(),
  ]);

  const isReady = isDbUp && isRedisUp;

  return {
    isReady,
    data: {
      status: isReady ? 'READY' : 'NOT_READY',
      dependencies: {
        database: isDbUp ? 'UP' : 'DOWN',
        redis: isRedisUp ? 'UP' : 'DOWN',
      },
      timestamp: new Date().toISOString(),
    },
  };
}

export function getMetrics(): MetricsStatus {
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    totalRequests: totalRequestsCount,
    activeRequests: activeRequestsCount,
    memoryUsageMb: {
      rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    },
    timestamp: new Date().toISOString(),
  };
}
