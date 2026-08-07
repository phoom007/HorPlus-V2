import crypto from 'crypto';
import { EnvConfig } from '../config/env.js';
import { GoogleIdentityVerifier } from './google-verifier.service.js';
import { SessionTokenService } from './session-token.service.js';
import { CsrfService } from './csrf.service.js';
import { AuditService } from './audit.service.js';
import { IUserRepository, UserEntity } from '../db/repositories/user.repository.js';
import { ISessionRepository, SessionEntity } from '../db/repositories/session.repository.js';
import { IMembershipRepository, DormitoryMemberEntity } from '../db/repositories/membership.repository.js';
import { IRoleRepository } from '../db/repositories/role.repository.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { getPrismaClient } from '../db/prisma.js';

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
  };
  memberships: Array<{
    id: string;
    dormitoryId: string;
    dormitoryName?: string;
    roleCode: string;
    status: string;
  }>;
  onboardingRequired: boolean;
  sessionToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
}

export class AuthenticationService {
  private googleVerifier: GoogleIdentityVerifier;
  private sessionTokenService: SessionTokenService;
  private csrfService: CsrfService;
  private auditService: AuditService;
  private userRepo: IUserRepository;
  private sessionRepo: ISessionRepository;
  private membershipRepo: IMembershipRepository;
  private roleRepo: IRoleRepository;
  private env: EnvConfig;

  constructor(
    env: EnvConfig,
    googleVerifier: GoogleIdentityVerifier,
    userRepo: IUserRepository,
    sessionRepo: ISessionRepository,
    membershipRepo: IMembershipRepository,
    roleRepo: IRoleRepository,
    auditService: AuditService
  ) {
    this.env = env;
    this.googleVerifier = googleVerifier;
    this.userRepo = userRepo;
    this.sessionRepo = sessionRepo;
    this.membershipRepo = membershipRepo;
    this.roleRepo = roleRepo;
    this.auditService = auditService;

    this.sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    this.csrfService = new CsrfService(env.CSRF_SIGNING_KEY);
  }

  public async authenticateGoogle(params: {
    idToken: string;
    intent?: 'owner' | 'staff';
    userAgent?: string;
    ipMetadata?: string;
    requestId?: string;
  }): Promise<AuthResult> {
    const { idToken, userAgent, ipMetadata, requestId } = params;

    let googleIdentity;
    try {
      googleIdentity = await this.googleVerifier.verifyIdToken(idToken);
    } catch (err: any) {
      this.auditService.logSecurityEvent({
        requestId,
        action: 'LOGIN_FAILURE',
        reason: err.message || 'Google token verification failed',
        severity: 'warn',
        ipMetadata,
        userAgent,
      });
      throw err;
    }

    const user = await this.userRepo.upsertFromGoogle({
      googleSubject: googleIdentity.sub,
      email: googleIdentity.email,
      name: googleIdentity.name,
      avatarUrl: googleIdentity.avatarUrl,
    });

    if (user.status === 'suspended') {
      this.auditService.logSecurityEvent({
        requestId,
        userId: user.id,
        action: 'LOGIN_FAILURE',
        reason: 'User account suspended',
        severity: 'warn',
        ipMetadata,
        userAgent,
      });
      throw new Error('USER_SUSPENDED: บัญชีผู้ใช้งานถูกระงับการใช้งาน');
    }

    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
    const ttlSeconds = this.env.SESSION_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const userAgentHash = userAgent
      ? crypto.createHash('sha256').update(userAgent).digest('hex')
      : undefined;

    await this.sessionRepo.createSession({
      userId: user.id,
      sessionIdHash,
      expiresAt,
      userAgentHash,
      ipMetadata,
      tokenVersion: 1,
    });

    const sessionToken = this.sessionTokenService.encryptToken(
      {
        sub: user.id,
        sid: sessionId,
        type: 'session',
        version: 1,
      },
      ttlSeconds
    );

    const csrfToken = this.csrfService.generateCsrfToken(sessionId);

    const memberships = await this.membershipRepo.findByUserId(user.id);
    const activeMemberships = memberships.filter((m) => m.status === 'active');
    const onboardingRequired = activeMemberships.length === 0;

    this.auditService.logSecurityEvent({
      requestId,
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      reason: 'Google identity verified and session established',
      severity: 'info',
      ipMetadata,
      userAgent,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      memberships: memberships.map((m) => ({
        id: m.id,
        dormitoryId: m.dormitoryId,
        dormitoryName: m.dormitoryName,
        roleCode: m.roleCode || '',
        status: m.status,
      })),
      onboardingRequired,
      sessionToken,
      csrfToken,
      sessionId,
      expiresAt,
    };
  }
  public async authenticateTestUser(userId: string): Promise<AuthResult> {
    if (this.env.NODE_ENV !== 'test' || !this.env.E2E_TEST_MODE) {
      throw new Error('Test authentication is disabled');
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error('Test user not found');
    }
    if (user.status === 'suspended') {
      throw new Error('USER_SUSPENDED: บัญชีผู้ใช้งานถูกระงับการใช้งาน');
    }

    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
    const ttlSeconds = this.env.SESSION_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.sessionRepo.createSession({
      userId: user.id,
      sessionIdHash,
      expiresAt,
      userAgentHash: 'e2e-test-agent-hash',
      ipMetadata: '127.0.0.1',
      tokenVersion: 1,
    });

    const sessionToken = this.sessionTokenService.encryptToken(
      { sub: user.id, sid: sessionId, type: 'session', version: 1 },
      ttlSeconds
    );
    const csrfToken = this.csrfService.generateCsrfToken(sessionId);

    const memberships = await this.membershipRepo.findByUserId(user.id);
    const activeMemberships = memberships.filter((m) => m.status === 'active');
    const onboardingRequired = activeMemberships.length === 0;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      memberships: memberships.map((m) => ({
        id: m.id,
        dormitoryId: m.dormitoryId,
        dormitoryName: m.dormitoryName,
        roleCode: m.roleCode || '',
        status: m.status,
      })),
      onboardingRequired,
      sessionToken,
      csrfToken,
      sessionId,
      expiresAt,
    };
  }
  public async validateSession(
    sessionToken: string,
    requestId?: string
  ): Promise<{
    user: UserEntity;
    session: SessionEntity;
    rawSessionId: string;
    memberships: DormitoryMemberEntity[];
  } | null> {
    const payload = this.sessionTokenService.decryptToken(sessionToken);
    if (!payload) { return null; }

    const hash = SessionTokenService.hashSessionId(payload.sid);
    const session = await this.sessionRepo.findBySessionIdHash(hash);

    if (!session) { return null; }
    if (session.status !== 'active') { return null; }
    if (session.expiresAt < new Date()) { return null; }

    // Dynamic resolution for ACCESS_GRANT sessions (Task-009 Final Product Model)
    if (session.principalType === 'ACCESS_GRANT' || session.accessGrantId) {
      const prisma = getPrismaClient();
      const grant = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return await tx.dormitoryAccessGrant.findUnique({
          where: { id: session.accessGrantId! },
          include: { lineFriend: true, dormitory: true }
        });
      });

      if (!grant || grant.status !== 'ACTIVE') {
        return null; // Deny immediately if access grant is revoked or deleted
      }

      const roleObj = await this.roleRepo.findByCode(grant.roleCode);
      const permissions = roleObj?.permissions || (grant.roleCode === 'OWNER' ? ['*'] : []);

      const mockUser: UserEntity = {
        id: `ag_user_${grant.id}`,
        email: `grant.${grant.tokenPrefix || grant.id}@horplus.local`,
        emailNormalized: `grant.${grant.tokenPrefix || grant.id}@horplus.local`,
        name: grant.lineFriend.displayName,
        avatarUrl: grant.lineFriend.pictureUrl,
        status: 'active',
        googleSubject: `ag_sub_${grant.id}`,
        createdAt: grant.createdAt,
        updatedAt: grant.updatedAt
      };

      const syntheticMembership: DormitoryMemberEntity = {
        id: `mem_${grant.id}`,
        dormitoryId: grant.dormitoryId,
        dormitoryName: grant.dormitory.name,
        userId: mockUser.id,
        roleId: roleObj?.id || `role-${grant.roleCode.toLowerCase()}`,
        roleCode: grant.roleCode, // DYNAMIC current role code resolved from DB on every request!
        rolePermissions: permissions,
        status: 'active',
        createdAt: grant.createdAt,
        updatedAt: grant.updatedAt
      };

      this.sessionRepo.updateLastSeen(session.id).catch(() => {});

      return {
        user: mockUser,
        session,
        rawSessionId: payload.sid,
        memberships: [syntheticMembership]
      };
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user) { return null; }
    if (user.status !== 'active') { return null; }

    // Non-blocking lastSeenAt update
    this.sessionRepo.updateLastSeen(session.id).catch(() => {});

    const memberships = await this.membershipRepo.findByUserId(user.id);

    return {
      user,
      session,
      rawSessionId: payload.sid,
      memberships,
    };
  }

  public async logout(sessionId: string, userId: string, requestId?: string): Promise<void> {
    const hash = SessionTokenService.hashSessionId(sessionId);
    const session = await this.sessionRepo.findBySessionIdHash(hash);

    if (session) {
      await this.sessionRepo.revokeSession(session.id, 'USER_LOGOUT');
    }

    this.auditService.logSecurityEvent({
      requestId,
      userId,
      action: 'LOGOUT',
      reason: 'User explicitly logged out',
      severity: 'info',
    });
  }

  public async logoutAll(userId: string, requestId?: string): Promise<number> {
    const count = await this.sessionRepo.revokeAllUserSessions(userId, 'USER_LOGOUT_ALL');

    this.auditService.logSecurityEvent({
      requestId,
      userId,
      action: 'LOGOUT_ALL',
      reason: 'User revoked all active sessions',
      severity: 'info',
    });

    return count;
  }

  public verifyCsrf(token: string | undefined, sessionId: string): boolean {
    return this.csrfService.verifyCsrfToken(token, sessionId);
  }

  public requireAuth() {
    return createRequireSessionMiddleware(this);
  }

  public getCsrfService(): CsrfService {
    return this.csrfService;
  }
}
