import { PrismaClient } from '@prisma/client';

async function run() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });
  const invites = await prisma.tenantRegistrationInvite.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Invites:', JSON.stringify(invites, null, 2));

  const receipts = await prisma.lineWebhookEventReceipt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Receipts:', JSON.stringify(receipts, null, 2));
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
