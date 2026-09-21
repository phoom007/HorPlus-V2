import { PrismaClient } from '@prisma/client';
import { decryptText } from '../src/utils/crypto-encryption.js';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });
  const grants = await prisma.dormitoryAccessGrant.findMany({
    where: { dormitoryId: 'eb729e0a-4502-4df5-8e25-c60b247fc64b' },
    include: { lineFriend: true }
  });
  console.log('Grants in eb729e0a-4502-4df5-8e25-c60b247fc64b:');
  for (const g of grants) {
    console.log({
      id: g.id,
      roleCode: g.roleCode,
      status: g.status,
      friendName: g.lineFriend?.displayName,
      friendLineId: g.lineFriend?.lineUserIdEncrypted ? decryptText(g.lineFriend.lineUserIdEncrypted) : null
    });
  }
  await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
