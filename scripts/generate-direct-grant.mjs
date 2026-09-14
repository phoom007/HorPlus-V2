import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../server/node_modules/@prisma/client/index.js');
import { AccessGrantService } from '../server/dist/services/access-grant.service.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://horplus_app:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public'
    }
  }
});

async function main() {
  try {
    const compDormId = '20000001-0000-4000-8000-000000000002';
    let dorm = await prisma.dormitory.findUnique({
      where: { id: compDormId },
      include: { rooms: true }
    });

    if (!dorm) {
      const dorms = await prisma.dormitory.findMany({
        where: { deletedAt: null },
        include: { rooms: true },
        orderBy: { createdAt: 'desc' }
      });
      dorm = dorms.find(d => d.rooms.length > 0) || dorms[0];
    }

    if (!dorm) {
      console.error('No active dormitory found in database.');
      process.exit(1);
    }

    const ownerMember = await prisma.dormitoryMember.findFirst({
      where: { dormitoryId: dorm.id, role: { code: 'OWNER' }, status: 'active' },
      include: { user: true }
    });

    const ownerId = ownerMember?.userId || 'usr_owner_seed';
    const grantService = new AccessGrantService(prisma);

    // Clean up old active grants for this dormitory under RLS context to stay within 10-slot limit
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dorm.id}, true)`;
      await tx.dormitoryAccessGrant.updateMany({
        where: { dormitoryId: dorm.id, status: 'ACTIVE' },
        data: { status: 'REVOKED' }
      });
    });

    const roles = [
      { code: 'OWNER', label: 'เจ้าของหอพัก (Full Access)' },
      { code: 'MANAGER', label: 'ผู้จัดการ (Operational Manager)' },
      { code: 'STAFF', label: 'ช่าง / แม่บ้าน (Staff Maintenance & Meters)' }
    ];

    console.log('\n========================================================================');
    console.log(`🏠 HORPLUS MULTI-ROLE DIRECT ACCESS GRANTS`);
    console.log(`หอพัก: ${dorm.name} (${dorm.rooms.length} ห้อง)`);
    console.log(`Dormitory ID: ${dorm.id}`);
    console.log('========================================================================\n');

    for (const r of roles) {
      const result = await grantService.createAccessGrant(
        dorm.id,
        null,
        r.code,
        ownerId
      );

      console.log(`🔑 [${r.code}] ${r.label}`);
      console.log(`   - Grant ID : ${result.grant.id}`);
      console.log(`   - Direct Link : ${result.bearerUrl}\n`);
    }

    console.log('========================================================================\n');
  } catch (err) {
    console.error('Failed to create grant:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
