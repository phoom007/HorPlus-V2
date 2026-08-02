import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    const dbUrl = process.env.DATABASE_URL || '';
    if (process.env.NODE_ENV === 'test' && dbUrl.includes('/horplus_pilot?')) {
      throw new Error('Test environment must not connect to the Pilot database (horplus_pilot)');
    }
    prismaInstance = new PrismaClient({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return prismaInstance;
}

export function setPrismaClient(mockInstance: PrismaClient | null): void {
  prismaInstance = mockInstance;
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error({ err }, 'Database ping check failed');
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
    logger.info('Prisma client disconnected gracefully');
  }
}

// Note: Use getPrismaClient() instead of importing `prisma` directly.
// Eager instantiation at module-load time causes failures when DATABASE_URL
// is not yet available (e.g., before dotenv/config runs).

