import { PrismaClient } from '../node_modules/@prisma/client';
import { AuthenticationService } from '../src/services/auth.service.js';
import { getEnv } from '../src/config/env.js';

async function testSessionAuth() {
  const env = getEnv();
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const authService = new AuthenticationService(env, {} as any, {
    sessionRepo: {
      updateLastSeen: async () => {}
    } as any,
    roleRepo: {
      findByCode: async (code: string, dormId: string) => ({ id: 'role-tenant', code: 'TENANT', permissions: [] })
    } as any
  });

  // Phoom's latest session: d6930e7b-527f-4f2a-9414-680fe4e88011
  const session = await prisma.session.findUnique({
    where: { id: 'd6930e7b-527f-4f2a-9414-680fe4e88011' }
  });

  console.log('Found session:', session?.id);

  const ttlSeconds = 86400;
  const sessionToken = authService.getSessionTokenService().encryptToken(
    { sub: `ag_${session!.accessGrantId}`, sid: session!.id, type: 'session', version: 1 },
    ttlSeconds
  );

  console.log('Encrypted Token generated.');

  // Now test calling GET /api/v1/tenant-portal/profile with this session cookie
  const res = await fetch('http://localhost:3001/api/v1/tenant-portal/profile', {
    headers: {
      cookie: `horplus_session=${sessionToken}; active_dormitory_id=eb729e0a-4502-4df5-8e25-c60b247fc64b`
    }
  });

  console.log('HTTP Status:', res.status);
  const text = await res.text();
  console.log('Response body:', text);

  await prisma.$disconnect();
}

testSessionAuth().catch(console.error);
