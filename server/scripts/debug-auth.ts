import { PrismaClient } from '../node_modules/@prisma/client';
import { AuthenticationService } from '../src/services/auth.service.js';
import { getEnv } from '../src/config/env.js';
import { PrismaSessionRepository } from '../src/db/repositories/session.repository.js';
import { PrismaRoleRepository } from '../src/db/repositories/role.repository.js';
import { PrismaUserRepository } from '../src/db/repositories/user.repository.js';
import { PrismaMembershipRepository } from '../src/db/repositories/membership.repository.js';
import { setPrismaClient } from '../src/db/prisma.js';
import { SessionTokenService } from '../src/services/session-token.service.js';

async function debugAuth() {
  const env = getEnv();
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });
  setPrismaClient(prisma);

  const userRepo = new PrismaUserRepository(prisma);
  const sessionRepo = new PrismaSessionRepository(prisma);
  const membershipRepo = new PrismaMembershipRepository(prisma);
  const roleRepo = new PrismaRoleRepository(prisma);
  const auditService = { logSecurityEvent: () => {} } as any;

  const authService = new AuthenticationService(
    env,
    {} as any,
    userRepo,
    sessionRepo,
    membershipRepo,
    roleRepo,
    auditService
  );

  const session = await prisma.session.findUnique({
    where: { id: 'd6930e7b-527f-4f2a-9414-680fe4e88011' }
  });

  const ttlSeconds = 86400;
  const sessionToken = authService.getSessionTokenService().encryptToken(
    { sub: `ag_${session!.accessGrantId}`, sid: session!.id, type: 'session', version: 1 },
    ttlSeconds
  );

  console.log('1. Decrypt token...');
  const payload = authService.getSessionTokenService().decryptToken(sessionToken);
  console.log('Payload:', payload);

  console.log('2. Hash sessionId...');
  const hash = SessionTokenService.hashSessionId(payload!.sid);
  console.log('Hash:', hash);
  console.log('Session sessionIdHash in DB:', session!.sessionIdHash);
  console.log('Hashes match:', hash === session!.sessionIdHash);

  console.log('3. Find by sessionIdHash in sessionRepo...');
  const foundSession = await sessionRepo.findBySessionIdHash(hash);
  console.log('Found session:', foundSession);

  if (foundSession) {
    console.log('Status active?', foundSession.status === 'active');
    console.log('Not expired?', foundSession.expiresAt > new Date());
    console.log('Token version match?', foundSession.tokenVersion, payload!.version);

    let targetDormitoryId = (foundSession as any).dormitoryId;
    console.log('targetDormitoryId initial:', targetDormitoryId);
    if (!targetDormitoryId && foundSession.accessGrantId) {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT dormitory_id FROM public.resolve_access_grant_by_id(${foundSession.accessGrantId}::uuid)
      `.catch((e) => {
        console.error('resolve error:', e);
        return [];
      });
      console.log('rows:', rows);
      if (rows && rows.length > 0) {
        targetDormitoryId = rows[0].dormitory_id;
      }
    }
    console.log('targetDormitoryId final:', targetDormitoryId);

    const grant = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${targetDormitoryId}, true)`;
      return await tx.dormitoryAccessGrant.findUnique({
        where: { id: foundSession.accessGrantId! },
        include: { lineFriend: true, dormitory: true }
      });
    });
    console.log('Grant found?', !!grant, 'status:', grant?.status);

    const roleObj = await roleRepo.findByCode(grant!.roleCode, grant!.dormitoryId);
    console.log('Role found?', roleObj);
  }

  await prisma.$disconnect();
}

debugAuth().catch(console.error);
