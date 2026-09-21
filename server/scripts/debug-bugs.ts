import { HttpLinePlatformAdapter } from '../src/services/line-platform-adapter.js';
import { LineChannelTokenProvider } from '../src/services/line-channel-token-provider.js';
import { PrismaClient } from '@prisma/client';
import { decryptText } from '../src/utils/crypto-encryption.js';

async function test() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });
  const config = await prisma.dormitoryLineConfig.findUnique({
    where: { dormitoryId: 'eb729e0a-4502-4df5-8e25-c60b247fc64b' }
  });
  if (!config?.channelSecretEncrypted || !config?.channelId) {
    console.log('No config');
    return;
  }
  const secret = decryptText(config.channelSecretEncrypted);
  const provider = new LineChannelTokenProvider();
  const token = await provider.getChannelAccessToken(config.channelId, secret);
  
  const res = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const defaultMenu = await res.json();
  console.log('Default Rich Menu for ALL users:', defaultMenu);

  const listRes = await fetch('https://api.line.me/v2/bot/richmenu/list', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const list = await listRes.json();
  console.log('All Rich Menus:', list.richmenus?.map((m: any) => ({ id: m.richMenuId, name: m.name, selected: m.selected })));

  const friends = await prisma.dormitoryLineFriend.findMany({
    where: { dormitoryId: 'eb729e0a-4502-4df5-8e25-c60b247fc64b' }
  });
  console.log('\nFriends and their individual linked menus:');
  for (const f of friends) {
    const uid = decryptText(f.lineUserIdEncrypted);
    const ures = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const udata = await ures.json();
    console.log(`Friend ${f.displayName} (${uid}):`, udata);
  }
}
test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
