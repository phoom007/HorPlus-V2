import { PrismaClient } from '@prisma/client';
import { decryptText } from '../src/utils/crypto-encryption.js';
import { LinePlatformAdapter, HttpLinePlatformAdapter } from '../src/services/line-platform-adapter.js';
import { LineChannelTokenProvider } from '../src/services/line-channel-token-provider.js';
import { LineRichMenuService } from '../src/services/line-richmenu.service.js';

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public'
      }
    }
  });

  const targetDormId = 'eb729e0a-4502-4df5-8e25-c60b247fc64b';
  const adapter = new HttpLinePlatformAdapter();
  const tokenProvider = new LineChannelTokenProvider();
  const richMenuService = new LineRichMenuService(prisma, adapter, tokenProvider);

  console.log('=== Step 1: Querying Dormitory Config ===');
  const config = await prisma.dormitoryLineConfig.findUnique({
    where: { dormitoryId: targetDormId },
    include: { dormitory: true }
  });
  if (!config) {
    console.error('Target dorm not found');
    process.exit(1);
  }

  const secret = decryptText(config.channelSecretEncrypted!);
  const accessToken = await tokenProvider.getChannelAccessToken(config.channelId!, secret);
  console.log(`Access Token resolved: ${accessToken ? 'SUCCESS' : 'FAILED'}`);
  if (!accessToken) process.exit(1);

  console.log('\n=== Step 2: Listing Current Rich Menus on LINE Platform ===');
  const existingMenus = await adapter.getRichMenuList(accessToken);
  console.log(`Found ${existingMenus.length} menus:`, existingMenus.map((m: any) => ({
    id: m.richMenuId,
    name: m.name,
    chatBarText: m.chatBarText,
    selected: m.selected
  })));

  console.log('\n=== Step 3: Deleting ALL Stale Rich Menus ===');
  for (const m of existingMenus) {
    console.log(`Deleting menu ${m.richMenuId} (${m.name})...`);
    await adapter.deleteRichMenu(m.richMenuId, accessToken);
  }

  console.log('\n=== Step 4: Provisioning Fresh Tenant & Owner Menus ===');
  const result = await richMenuService.syncDormitoryRichMenus(targetDormId, true);
  console.log('Sync Result:', result);

  console.log('\n=== Step 5: Linking Owner Rich Menu to authorized owners ===');
  const owners = [
    { name: 'GoDRoger', lineUserId: 'U088c5030e0f7be0c0475d2b2ec55c350' }
  ];

  for (const o of owners) {
    const linked = await richMenuService.linkOwnerRichMenu(targetDormId, o.lineUserId);
    console.log(`Linked ${o.name} (${o.lineUserId}): ${linked ? 'SUCCESS' : 'FAILED'}`);
  }

  console.log('\n=== Step 6: Verifying Updated Rich Menus on LINE Platform ===');
  const updatedMenus = await adapter.getRichMenuList(accessToken);
  console.log(`Currently active menus on LINE (${updatedMenus.length}):`, updatedMenus.map((m: any) => ({
    id: m.richMenuId,
    name: m.name,
    chatBarText: m.chatBarText,
    areas: m.areas?.length
  })));

  for (const o of owners) {
    const res = await fetch(`https://api.line.me/v2/bot/user/${o.lineUserId}/richmenu`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    console.log(`User ${o.name} active rich menu:`, data);
  }

  console.log('\n=== ALL DONE SUCCESSFULLY ===');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
