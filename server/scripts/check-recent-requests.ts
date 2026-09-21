import { PrismaClient } from '../node_modules/@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const dormId = 'eb729e0a-4502-4df5-8e25-c60b247fc64b';
  const reqs = await prisma.tenantRegistrationRequest.findMany({
    where: { dormitoryId: dormId },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log(`Recent requests for HorPlus (${dormId}):`, reqs.length);
  for (const r of reqs) {
    console.log(`- ID: ${r.id}, Name: ${r.firstName} ${r.lastName}, Phone: ${r.phone}, Status: ${r.status}, CreatedAt: ${r.createdAt}`);
  }

  const allRecent = await prisma.tenantRegistrationRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('\nAll recent requests across all dorms:', allRecent.length);
  for (const r of allRecent) {
    console.log(`- ID: ${r.id}, Dorm: ${r.dormitoryId}, Name: ${r.firstName} ${r.lastName}, Phone: ${r.phone}, Status: ${r.status}, CreatedAt: ${r.createdAt}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
