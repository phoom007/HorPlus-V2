import { PrismaClient } from '../node_modules/@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  // Find dormitories containing "วงค์สวรรค์" or "Fresh Owner" or "HorPlus"
  const dorms = await prisma.dormitory.findMany({
    where: {
      OR: [
        { name: { contains: 'วงค์สวรรค์' } },
        { name: { contains: 'Fresh Owner' } },
        { name: { contains: 'HORPLUS' } },
        { id: 'eb729e0a-4502-4df5-8e25-c60b247fc64b' }
      ]
    },
    select: { id: true, name: true }
  });
  console.log('Matching Dormitories:', dorms);

  for (const d of dorms) {
    const rooms = await prisma.room.findMany({
      where: { dormitoryId: d.id },
      select: {
        id: true,
        roomNumber: true,
        status: true,
        dormitoryId: true,
        currentTenantId: true,
        currentContractId: true,
      }
    });
    console.log(`\nDormitory "${d.name}" (${d.id}) has ${rooms.length} rooms:`);
    for (const r of rooms) {
      console.log(`  Room ${r.roomNumber} (${r.id}): status=${r.status}, currentTenantId=${r.currentTenantId}, currentContractId=${r.currentContractId}`);
    }

    const requests = await prisma.tenantRegistrationRequest.findMany({
      where: { dormitoryId: d.id },
      select: {
        id: true,
        status: true,
        requestedRoomId: true,
        firstName: true,
        lastName: true,
        phone: true,
        submittedAt: true,
        lineFollowerId: true,
      }
    });
    console.log(`  Registration requests (${requests.length}):`, requests);
  }

  // Check Phoom's line follower record
  const phoomFollower = await prisma.lineFollower.findFirst({
    where: {
      OR: [
        { lineUserId: 'U85e0b77e64f03c0fe4345bf146100a0f' },
        { id: '9279c11f-817e-48c9-886a-2ec4284ae263' }
      ]
    },
    include: {
      dormitory: { select: { id: true, name: true } },
      invites: { select: { id: true, dormitoryId: true, status: true, rawTokenHash: true } }
    }
  });
  console.log('\nPhoom Follower:', JSON.stringify(phoomFollower, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
