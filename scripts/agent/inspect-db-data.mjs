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
  console.log('=== Tenancies / Tenants ===');
  const tenants = await prisma.tenant.findMany({
    where: { dormitoryId: DORM_ID },
    include: { contracts: true },
  });
  for (const t of tenants) {
    console.log(`Tenant ID: ${t.id}, linkedUserId: ${t.linkedUserId}, name: ${t.firstName} ${t.lastName}, contracts: ${t.contracts.map(c => c.id).join(', ')}`);
  }

  console.log('\n=== Maintenance Requests ===');
  const mr = await prisma.maintenanceRequest.findMany({
    where: { dormitoryId: DORM_ID },
    take: 5,
  });
  for (const m of mr) {
    console.log(`MR ID: ${m.id}, title: ${m.title}, status: ${m.status}, assignedTo: ${m.assignedToUserId}`);
  }

  console.log('\n=== Users & Memberships ===');
  const users = await prisma.user.findMany({
    where: {
      id: {
        in: [
          '20000002-0000-4000-8000-000000000002',
          '20000003-0000-4000-8000-000000000003',
          '20000004-0000-4000-8000-000000000004',
          '20000005-0000-4000-8000-000000000005',
        ],
      },
    },
    include: { memberships: true },
  });
  for (const u of users) {
    console.log(`User: ${u.email} (${u.id}) -> memberships:`, u.memberships.map(m => ({ dorm: m.dormitoryId, role: m.roleCode })));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
