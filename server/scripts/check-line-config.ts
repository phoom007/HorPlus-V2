import { PrismaClient } from '../node_modules/@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const configs = await prisma.dormitoryLineConfig.findMany();
  console.log('Configs:');
  for (const c of configs) {
    console.log({
      id: c.id,
      dormId: c.dormitoryId,
      webhookUrl: c.webhookUrl,
      channelId: c.channelId
    });
  }

  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
