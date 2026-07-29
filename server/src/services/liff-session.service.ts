import crypto from 'crypto';
import { LineRepository, lineRepository } from '../db/repositories/line.repository.js';
import {
  LiffIdentityVerifier,
  MockLiffIdentityVerifier
} from './line-provider.interface.js';

export interface WorkspaceItem {
  workspaceId: string;
  type: 'staff' | 'tenant' | 'registration';
  dormitoryId: string;
  dormitoryName?: string;
  roleCode?: string | null;
  tenantId?: string | null;
  contractId?: string | null;
  roomId?: string | null;
  roomNumber?: string | null;
  label: string;
}

export interface LineSessionData {
  sessionId: string;
  lineIdentityId: string;
  lineUserId: string;
  dormitoryId: string;
  accessType: 'staff' | 'tenant' | 'registration';
  roleCode?: string | null;
  tenantId?: string | null;
  contractId?: string | null;
  roomId?: string | null;
  displayName: string;
  pictureUrl?: string | null;
  issuedAt: number;
  expiresAt: number;
  workspaces: WorkspaceItem[];
  selectedWorkspaceId: string;
}

const LINE_SESSIONS = new Map<string, LineSessionData>();

export class LiffSessionService {
  constructor(
    private repo: LineRepository = lineRepository,
    private liffVerifier: LiffIdentityVerifier = new MockLiffIdentityVerifier()
  ) {}

  async exchangeIdToken(params: {
    dormitoryId: string;
    idToken: string;
  }): Promise<{ session: LineSessionData; targetRoute: string; workspaces: WorkspaceItem[]; selectedWorkspace: WorkspaceItem }> {
    const verified = await this.liffVerifier.verifyIdentityToken({ idToken: params.idToken });

    // Upsert line identity
    const identity = await this.repo.upsertLineIdentity({
      lineUserId: verified.lineUserId,
      displayName: verified.displayName,
      pictureUrl: verified.pictureUrl
    });

    const dormitoryId = params.dormitoryId;

    // Fetch all active staff roles for this identity
    const staffRoles = await this.repo.listRoleAssignmentsForIdentity(identity.id);
    // Fetch all active tenant bindings for this identity
    const tenantBindings = await this.repo.listTenantBindingsForIdentity(identity.id);

    const workspaces: WorkspaceItem[] = [];

    for (const sr of staffRoles) {
      const roleLabel = sr.roleCode === 'MANAGER' ? 'ผู้จัดการ' : sr.roleCode === 'TECH' ? 'ช่าง / แม่บ้าน' : 'เจ้าของหอพัก';
      workspaces.push({
        workspaceId: `staff_${sr.dormitoryId}_${sr.roleCode}`,
        type: 'staff',
        dormitoryId: sr.dormitoryId,
        roleCode: sr.roleCode,
        label: `${roleLabel} (หอพัก ${sr.dormitoryId})`
      });
    }

    for (const tb of tenantBindings) {
      workspaces.push({
        workspaceId: `tenant_${tb.dormitoryId}_${tb.tenantId}`,
        type: 'tenant',
        dormitoryId: tb.dormitoryId,
        tenantId: tb.tenantId,
        contractId: tb.contractId,
        roomId: tb.roomId,
        label: `ระบบผู้เช่า (หอพัก ${tb.dormitoryId})`
      });
    }

    if (workspaces.length === 0) {
      workspaces.push({
        workspaceId: `reg_${dormitoryId}`,
        type: 'registration',
        dormitoryId,
        label: `ลงทะเบียนผู้เช่าใหม่`
      });
    }

    // Select matching workspace or default to first
    let selectedWorkspace = workspaces.find((w) => w.dormitoryId === dormitoryId) || workspaces[0];

    let targetRoute = '/tenant/register';
    if (selectedWorkspace.type === 'staff') {
      targetRoute = '/owner/dashboard';
    } else if (selectedWorkspace.type === 'tenant') {
      targetRoute = '/tenant/dashboard';
    }

    const sessionId = `linesess_${crypto.randomBytes(16).toString('hex')}`;
    const now = Date.now();
    const sessionData: LineSessionData = {
      sessionId,
      lineIdentityId: identity.id,
      lineUserId: identity.lineUserId,
      dormitoryId: selectedWorkspace.dormitoryId,
      accessType: selectedWorkspace.type,
      roleCode: selectedWorkspace.roleCode || null,
      tenantId: selectedWorkspace.tenantId || null,
      contractId: selectedWorkspace.contractId || null,
      roomId: selectedWorkspace.roomId || null,
      displayName: identity.displayName,
      pictureUrl: identity.pictureUrl,
      issuedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours
      workspaces,
      selectedWorkspaceId: selectedWorkspace.workspaceId
    };

    LINE_SESSIONS.set(sessionId, sessionData);

    return { session: sessionData, targetRoute, workspaces, selectedWorkspace };
  }

  async selectWorkspace(params: {
    currentSessionId: string;
    workspaceId: string;
  }): Promise<{ session: LineSessionData; targetRoute: string; selectedWorkspace: WorkspaceItem }> {
    const currentSession = this.getSession(params.currentSessionId);
    if (!currentSession) {
      throw new Error('LINE_SESSION_REQUIRED: Session expired or invalid');
    }

    const targetWs = currentSession.workspaces.find((w) => w.workspaceId === params.workspaceId);
    if (!targetWs) {
      throw new Error('WORKSPACE_NOT_AVAILABLE: Selected workspace is not available for this identity');
    }

    // Destroy old session and rotate to a new session ID
    this.destroySession(params.currentSessionId);

    let targetRoute = '/tenant/register';
    if (targetWs.type === 'staff') {
      targetRoute = '/owner/dashboard';
    } else if (targetWs.type === 'tenant') {
      targetRoute = '/tenant/dashboard';
    }

    const newSessionId = `linesess_${crypto.randomBytes(16).toString('hex')}`;
    const now = Date.now();
    const newSession: LineSessionData = {
      ...currentSession,
      sessionId: newSessionId,
      dormitoryId: targetWs.dormitoryId,
      accessType: targetWs.type,
      roleCode: targetWs.roleCode || null,
      tenantId: targetWs.tenantId || null,
      contractId: targetWs.contractId || null,
      roomId: targetWs.roomId || null,
      selectedWorkspaceId: targetWs.workspaceId,
      issuedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000
    };

    LINE_SESSIONS.set(newSessionId, newSession);

    return { session: newSession, targetRoute, selectedWorkspace: targetWs };
  }

  getSession(sessionId: string): LineSessionData | null {
    const session = LINE_SESSIONS.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      LINE_SESSIONS.delete(sessionId);
      return null;
    }
    return session;
  }

  destroySession(sessionId: string): void {
    LINE_SESSIONS.delete(sessionId);
  }
}

export const liffSessionService = new LiffSessionService();
