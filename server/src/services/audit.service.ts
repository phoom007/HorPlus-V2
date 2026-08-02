import { logger } from '../config/logger.js';

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

    const safeDetails = details ? this.sanitize(details) : undefined;

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

  private sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    const sensitiveKeys = ['token', 'idtoken', 'cookie', 'secret', 'password', 'csrftoken', 'key', 'authorization'];

    for (const [key, val] of Object.entries(obj)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        safe[key] = '[REDACTED]';
      } else {
        safe[key] = val;
      }
    }
    return safe;
  }
}

export const auditService = new AuditService();
