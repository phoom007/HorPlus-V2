import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public'
      }
    }
  });
  const configs: any = await prisma.dormitoryLineConfig.findMany({
    where: { channelId: { not: null } },
    include: { dormitory: true }
  });
  console.log('Configs with channelId:', configs.map((c: any) => ({
    dormitoryId: c.dormitoryId,
    dormitoryName: c.dormitory.name,
    channelId: c.channelId,
    botDisplayName: c.botDisplayName,
    lineOaId: c.lineOaId,
    isConnected: c.isConnected,
    webhookActive: c.webhookActive,
    webhookKeyHash: c.webhookKeyHash
  })));

  const targetDorms = ['eb729e0a-4502-4df5-8e25-c60b247fc64b', '20000001-0000-4000-8000-000000000002'];
  for (const dormId of targetDorms) {
    const c: any = await prisma.dormitoryLineConfig.findUnique({
      where: { dormitoryId: dormId },
      include: { dormitory: true }
    });
    if (!c) {
      console.log(`Dorm ${dormId} not found`);
      continue;
    }
    console.log(`Dorm: ${c.dormitory.name} (${dormId})`);
    console.log(`  channelId: ${c.channelId}`);
    console.log(`  hasSecret: ${!!c.channelSecretEncrypted}`);
    console.log(`  hasToken: ${!!c.channelAccessTokenEncrypted}`);
    console.log(`  botDisplayName: ${c.botDisplayName}`);
    console.log(`  lineOaId: ${c.lineOaId}`);

    const { decryptText } = await import('../src/utils/crypto-encryption.js');
    const { HttpLinePlatformAdapter } = await import('../src/services/line-platform-adapter.js');
    const { LineChannelTokenProvider } = await import('../src/services/line-channel-token-provider.js');

    let token: string | null = null;
    if (c.channelAccessTokenEncrypted) {
      try {
        token = decryptText(c.channelAccessTokenEncrypted);
      } catch (e: any) {
        console.log('  decrypt token error:', e.message);
      }
    }
    if (!token && c.channelId && c.channelSecretEncrypted) {
      try {
        const secret = decryptText(c.channelSecretEncrypted);
        const provider = new LineChannelTokenProvider();
        token = await provider.getChannelAccessToken(c.channelId, secret);
        console.log('  fetched token from LineChannelTokenProvider:', !!token);
      } catch (e: any) {
        console.log('  provider error:', e.message);
      }
    }

    const friends: any = await prisma.dormitoryLineFriend.findMany({
      where: { dormitoryId: dormId }
    });
    console.log(`  Friends in DB (${friends.length}):`, friends.map((f: any) => ({
      id: f.id,
      lineUserId: f.lineUserId,
      displayName: f.displayName,
      followStatus: f.followStatus
    })));

    for (const f of friends) {
      const lineUserId = decryptText(f.lineUserIdEncrypted);
      console.log(`  Friend: ${f.displayName} (${lineUserId})`);
      if (token) {
        try {
          const res = await fetch(`https://api.line.me/v2/bot/user/${lineUserId}/richmenu`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          console.log(`    User ${f.displayName} linked rich menu:`, data);
        } catch (e: any) {
          console.log(`    User rich menu check error:`, e.message);
        }
      }
    }
  }
  process.exit(0);
}
main();
