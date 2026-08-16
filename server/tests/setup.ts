import 'dotenv/config';
import { afterAll } from 'vitest';
import { disconnectRedis } from '../src/db/redis.js';
import { getPrismaClient } from '../src/db/prisma.js';

afterAll(async () => {
  await disconnectRedis();
  const prisma = getPrismaClient();
  await prisma.$disconnect();
});
