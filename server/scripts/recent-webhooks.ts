import { PrismaClient } from '../node_modules/@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const receipts = await prisma.lineWebhookEventReceipt.findMany({
    orderBy: { receivedAt: 'desc' },
    take: 10
  });

  console.log('Recent Webhooks:');
  for (const r of receipts) {
    console.log({
      id: r.id,
      eventType: r.eventType,
      lineUserId: r.lineUserId,
      receivedAt: r.receivedAt,
      payload: (r as any).payloadSnippet || (r as any).payload
    });
  }

  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
