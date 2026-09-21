import { PrismaClient } from '../node_modules/@prisma/client';
import { decryptText } from '../src/utils/crypto-encryption.js';

async function testFullFlow() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const invite = await prisma.tenantRegistrationInvite.findUnique({
    where: { id: '7e5b59e9-d0d4-4e28-84bf-817339b2a8bb' }
  });

  console.log('Invite:', invite?.id, invite?.status, invite?.expiresAt);
  const rawToken = decryptText(invite!.tokenEncrypted!);
  console.log('Decrypted raw token:', rawToken);

  // Step 1: Hit line-tenant-entry
  const entryRes = await fetch(`http://localhost:3001/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(rawToken)}`, {
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

  // Step 4: Call /api/v1/tenant-portal/contract
  const contractRes = await fetch('http://localhost:3001/api/v1/tenant-portal/contract', {
    headers: {
      cookie: cookies
    }
  });
  console.log('Contract HTTP Status:', contractRes.status);
  console.log('Contract Response:', await contractRes.text());

  await prisma.$disconnect();
}

testFullFlow().catch(console.error);
