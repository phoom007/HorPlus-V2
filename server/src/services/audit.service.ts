import { logger } from '../config/logger.js';
import { getPrismaClient } from '../db/prisma.js';

export interface AuditLogParams {
  requestId?: string;
  userId?: string;
  actorUserId?: string;
  action: string;
  source?: string;
  ipMetadata?: any;
  userAgent?: string;
  reason?: string;
  severity?: 'info' | 'warn' | 'error';
  details?: Record<string, unknown>;
  dormitoryId?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: any;
}

export interface MutationAuditParams {
  dormitoryId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeValues?: any;
  afterValues?: any;
  changedFields?: any;
  reason?: string | null;
  requestId?: string | null;
  versionBefore?: number | null;
  versionAfter?: number | null;
  idempotencyKey?: string | null;
  tx?: any;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function cleanAuditActorId(actorId?: string | null): string | null {
  if (!actorId) return null;
  const cleaned = actorId.startsWith('usr_') ? actorId.replace('usr_', '') : actorId;
  return UUID_REGEX.test(cleaned) ? cleaned : null;
}

const SENSITIVE_KEY_SUBSTRINGS = [
  'token',
  'idtoken',
  'cookie',
  'secret',
  'password',
  'csrftoken',
  'key',
  'authorization',
  'authheader',
  'auth_header',
  'signature',
  'credential',
];

export function deepSanitize(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;
  if (val instanceof Date) return val.toISOString();
  if (Array.isArray(val)) {
    return val.map((item) => deepSanitize(item));
  }
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    const isSensitive = SENSITIVE_KEY_SUBSTRINGS.some((s) => k.toLowerCase().includes(s));
    if (isSensitive) {
      result[k] = '[REDACTED]';
    } else if (v !== null && typeof v === 'object') {
      result[k] = deepSanitize(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export class AuditService {
  public log(params: AuditLogParams): void {
    this.logSecurityEvent(params);
  }

  public record(params: any): void {
    this.log({
      action: params.action || 'AUDIT_RECORD',
      userId: params.actorUserId || params.userId,
      details: params,
    });
  }

  public logSecurityEvent(params: AuditLogParams): void {
    const {
      requestId,
      userId,
      action,
      source = 'auth',
      ipMetadata,
      userAgent,
      reason,
      severity = 'info',
      details,
    } = params;

    const safeDetails = details ? deepSanitize(details) : undefined;

    const logPayload = {
      event: 'SECURITY_AUDIT',
      requestId,
      userId,
      action,
      source,
      ipMetadata,
      userAgent,
      reason,
      timestamp: new Date().toISOString(),
      details: safeDetails,
    };

    if (severity === 'error') {
      logger.error(logPayload, `Audit: ${action}`);
    } else if (severity === 'warn') {
      logger.warn(logPayload, `Audit: ${action}`);
    } else {
      logger.info(logPayload, `Audit: ${action}`);
    }
  }

  public async recordMutation(params: MutationAuditParams): Promise<any> {
    const prismaClient = params.tx || getPrismaClient();
    const safeBefore = params.beforeValues !== undefined && params.beforeValues !== null
      ? deepSanitize(params.beforeValues)
      : undefined;
    const safeAfter = params.afterValues !== undefined && params.afterValues !== null
      ? deepSanitize(params.afterValues)
      : undefined;
    const safeChanged = params.changedFields !== undefined && params.changedFields !== null
      ? deepSanitize(params.changedFields)
      : undefined;

    const actorUserId = cleanAuditActorId(params.actorUserId);

    // Emit structured log
    this.log({
      action: params.action,
      userId: params.actorUserId || undefined,
      dormitoryId: params.dormitoryId,
      resourceType: params.entityType,
      resourceId: params.entityId,
      reason: params.reason || undefined,
      details: {
        entityType: params.entityType,
        entityId: params.entityId,
        beforeValues: safeBefore,
        afterValues: safeAfter,
        changedFields: safeChanged,
        rawActor: params.actorUserId,
      },
    });

    // Write persistent row to PostgreSQL audit_logs table
    return await prismaClient.auditLog.create({
      data: {
        dormitoryId: params.dormitoryId,
        actorUserId,
        entityType: params.entityType,
        entityId: String(params.entityId),
        action: params.action,
        beforeValues: safeBefore ?? undefined,
        afterValues: safeAfter ?? undefined,
        changedFields: safeChanged ?? undefined,
        reason: params.reason ?? null,
        requestId: params.requestId ?? null,
        versionBefore: params.versionBefore ?? null,
        versionAfter: params.versionAfter ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
      },
    });
  }

  public sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    return deepSanitize(obj);
  }
}

export const auditService = new AuditService();
