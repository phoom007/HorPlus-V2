import { PrismaClient } from '@prisma/client';

async function run() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });
  const grants = await prisma.dormitoryAccessGrant.findMany({
    where: { lineFriendId: 'fe4f13e0-759c-4e72-bd17-3ab401778d8e' }
  });
  console.log('Phoom Grants:', JSON.stringify(grants, null, 2));
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
