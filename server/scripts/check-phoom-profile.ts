import { PrismaClient } from '@prisma/client';
import { AuthenticationService } from '../src/services/auth.service.js';
import { decryptText } from '../src/utils/crypto-encryption.js';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  // Phoom's friend ID in eb729e0a-4502-4df5-8e25-c60b247fc64b:
  const phoomFriend = await prisma.dormitoryLineFriend.findFirst({
    where: { displayName: 'Phoom', dormitoryId: 'eb729e0a-4502-4df5-8e25-c60b247fc64b' }
  });
  console.log('Phoom Friend:', phoomFriend?.id);

  const grant = await prisma.dormitoryAccessGrant.findFirst({
    where: { lineFriendId: phoomFriend?.id }
  });
  console.log('Phoom Grant:', grant);

  const session = await prisma.session.findFirst({
    where: { accessGrantId: grant?.id, status: 'active' },
    orderBy: { createdAt: 'desc' }
  });
  console.log('Phoom Latest Session:', session?.id);

  const tenant = await prisma.tenant.findFirst({
    where: { dormitoryId: 'eb729e0a-4502-4df5-8e25-c60b247fc64b', lineFriendId: phoomFriend?.id }
  });
  console.log('Phoom Tenant in DB:', tenant);

  const regRequests = await prisma.tenantRegistrationRequest.findMany({
    where: { dormitoryId: 'eb729e0a-4502-4df5-8e25-c60b247fc64b' }
  });
  console.log('Registration Requests count:', regRequests.length, regRequests.map(r => ({ id: r.id, status: r.status, lineFollowerId: r.lineFollowerId })));

  await prisma.$disconnect();
}
main().catch(console.error);
