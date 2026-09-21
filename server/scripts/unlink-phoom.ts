import { HttpLinePlatformAdapter } from '../src/services/line-platform-adapter.js';
import { LineChannelTokenProvider } from '../src/services/line-channel-token-provider.js';
import { LineRichMenuService } from '../src/services/line-richmenu.service.js';
import { PrismaClient } from '@prisma/client';
import { decryptText } from '../src/utils/crypto-encryption.js';

async function unlinkTenant() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const adapter = new HttpLinePlatformAdapter();
  const tokenProvider = new LineChannelTokenProvider();
  const richMenuService = new LineRichMenuService(prisma, adapter, tokenProvider);

  const targetDormId = 'eb729e0a-4502-4df5-8e25-c60b247fc64b';
  const phoomLineId = 'U85e0b77e64f03c0fe4345bf146100a0f';

  console.log('Unlinking Phoom from Owner rich menu...');
  const success = await richMenuService.unlinkOwnerRichMenu(targetDormId, phoomLineId);
  console.log('Unlink result:', success ? 'SUCCESS' : 'FAILED');

  const config = await prisma.dormitoryLineConfig.findUnique({
    where: { dormitoryId: targetDormId }
  });
  const secret = decryptText(config!.channelSecretEncrypted!);
  const token = await tokenProvider.getChannelAccessToken(config!.channelId!, secret);

  const res = await fetch(`https://api.line.me/v2/bot/user/${phoomLineId}/richmenu`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  console.log('Phoom active individual rich menu:', data);

  const defRes = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const defData = await defRes.json();
  console.log('Default menu for all users:', defData);

  await prisma.$disconnect();
}
unlinkTenant().catch(console.error);
