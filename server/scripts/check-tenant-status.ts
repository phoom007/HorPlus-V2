import { PrismaClient } from '../node_modules/@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const friends = await prisma.dormitoryLineFriend.findMany({
    include: {
      accessGrants: true,
      tenants: true,
      tenantRegistrationInvites: {
        orderBy: { createdAt: 'desc' },
        take: 3
      }
    }
  });

  console.log('--- LINE FRIENDS ---');
  for (const f of friends) {
    console.log({
      id: f.id,
      lineUserId: f.lineUserId,
      displayName: f.displayName,
      accessGrants: f.accessGrants.map(g => ({ id: g.id, roleCode: g.roleCode, status: g.status, dormitoryId: g.dormitoryId })),
      tenants: f.tenants.map(t => ({ id: t.id, status: t.status, roomId: t.roomId })),
      invites: f.tenantRegistrationInvites.map(i => ({ id: i.id, status: i.status, rawTokenPrefix: i.tokenPrefix, expiresAt: i.expiresAt }))
    });
  }

  // Check latest sessions
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('--- LATEST SESSIONS ---');
  for (const s of sessions) {
    console.log({
      id: s.id,
      principalType: s.principalType,
      accessGrantId: s.accessGrantId,
      userId: s.userId,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      status: s.status
    });
  }

  await prisma.$disconnect();
}

main().catch(console.error);
