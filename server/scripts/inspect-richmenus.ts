import { PrismaClient } from '@prisma/client';
import { decryptText } from '../src/utils/crypto-encryption.js';
import { LineChannelTokenProvider } from '../src/services/line-channel-token-provider.js';

async function run() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });
  const c = await prisma.dormitoryLineConfig.findUnique({
    where: { dormitoryId: 'd99948ec-49d4-4629-9fea-567241e5049d' }
  });
  if (!c) {
    console.log('No line config found for d99948ec-49d4-4629-9fea-567241e5049d');
    return;
  }
  console.log('Dormitory ID:', c.dormitoryId, 'Channel ID:', c.channelId);
  const secret = decryptText(c.channelSecretEncrypted!);
  const provider = new LineChannelTokenProvider();
  const token = await provider.getChannelAccessToken(c.channelId!, secret);
  
  const listRes = await fetch('https://api.line.me/v2/bot/richmenu/list', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const list = await listRes.json();
  console.log('All Rich Menus in LINE:');
  for (const m of (list.richmenus || [])) {
    console.log(`Menu ID: ${m.richMenuId}, Name: ${m.name}`);
    console.log('Areas:', JSON.stringify(m.areas, null, 2));
  }

  const allRes = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Default Rich Menu ID for all users:', await allRes.text());

  const friends = await prisma.dormitoryLineFriend.findMany({
    where: { dormitoryId: c.dormitoryId }
  });
  for (const f of friends) {
    const uid = decryptText(f.lineUserIdEncrypted);
    const ures = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    console.log(`Friend ${f.displayName} (${uid}) linked menu:`, await ures.text());
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
