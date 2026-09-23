import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const envConfig = dotenv.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/.env')));
const prisma = new PrismaClient({
  datasources: { db: { url: envConfig.DIRECT_URL || envConfig.DATABASE_URL } },
});

const DORM_ID = '20000001-0000-4000-8000-000000000002';

async function main() {
  const cycles = await prisma.billingCycle.findMany({
    where: { dormitoryId: DORM_ID },
    orderBy: { periodStart: 'desc' },
    take: 5,
  });
  console.log('=== Cycles ===');
  console.log(JSON.stringify(cycles.map(c => ({ id: c.id, code: c.cycleCode, status: c.status })), null, 2));

  const rooms = await prisma.room.findMany({
    where: { dormitoryId: DORM_ID },
    take: 5,
  });
  console.log('=== Rooms ===');
  console.log(JSON.stringify(rooms.map(r => ({ id: r.id, number: r.roomNumber })), null, 2));

  const billWithItems = await prisma.bill.findUnique({
    where: { id: '39e7ffc6-bb99-45be-9acd-3a95e67eb1b0' },
    include: { items: true },
  });
  console.log('=== Bill with Items ===');
  console.log(JSON.stringify(billWithItems, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
