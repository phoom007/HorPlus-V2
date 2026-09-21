import { PrismaClient } from '../node_modules/@prisma/client';
import { TenantRegistrationInviteService } from '../src/services/tenant-registration-invite.service.js';

async function testInviteAndEntry() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const inviteService = new TenantRegistrationInviteService(prisma as any);
  const dormId = 'eb729e0a-4502-4df5-8e25-c60b247fc64b';
  const lineFriendId = '9279c11f-817e-48c9-886a-2ec4284ae263'; // Phoom

  console.log('Generating fresh invite for Phoom...');
  const res = await inviteService.createInvite(dormId, lineFriendId);

  console.log('Fresh invite created:', res.id);
  console.log('Fresh rawToken:', res.rawToken);

  // Step 1: Hit line-tenant-entry
  const entryRes = await fetch(`http://localhost:3001/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(res.rawToken)}`, {
    redirect: 'manual'
  });

  console.log('Entry HTTP Status:', entryRes.status);
  console.log('Entry Location:', entryRes.headers.get('location'));
  const rawSetCookie = entryRes.headers.get('set-cookie');
  console.log('Entry Set-Cookie:', rawSetCookie);

  if (!rawSetCookie) {
    console.error('No cookies returned!');
    await prisma.$disconnect();
    return;
  }

  // Parse cookies
  const cookies = rawSetCookie.split(',').map(c => c.trim().split(';')[0]).join('; ');
  console.log('Cookie string for next requests:', cookies);

  // Step 2: Call /api/v1/tenant-portal/profile with these cookies
  const profileRes = await fetch('http://localhost:3001/api/v1/tenant-portal/profile', {
    headers: {
      cookie: cookies
    }
  });

  console.log('Profile HTTP Status:', profileRes.status);
  const profileData = await profileRes.text();
  console.log('Profile Response:', profileData);

  // Step 3: Call /api/v1/tenant-portal/rooms
  const roomsRes = await fetch('http://localhost:3001/api/v1/tenant-portal/rooms', {
    headers: {
      cookie: cookies
    }
  });
  console.log('Rooms HTTP Status:', roomsRes.status);
  console.log('Rooms Response:', await roomsRes.text());

  await prisma.$disconnect();
}

testInviteAndEntry().catch(console.error);
