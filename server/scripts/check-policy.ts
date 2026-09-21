import { PrismaClient } from '../node_modules/@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const dormId = 'eb729e0a-4502-4df5-8e25-c60b247fc64b';
  const defaults = await prisma.dormitoryPropertyDefaults.findUnique({
    where: { dormitoryId: dormId }
  });
  console.log('dormitoryPropertyDefaults for HorPlus:', defaults?.id, 'version:', defaults?.version);

  // Also check public-policy API
  const res = await fetch(`http://localhost:3001/api/v1/tenant-registrations/public-policy?dormitoryId=${dormId}`);
  console.log('public-policy HTTP status:', res.status);
  const data = await res.json();
  console.log('public-policy response:', JSON.stringify(data, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
