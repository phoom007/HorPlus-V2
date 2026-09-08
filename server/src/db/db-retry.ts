import { logger } from '../config/logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  delaysMs?: number[];
  operationName?: string;
}

const DEFAULT_DELAYS_MS = [500, 1000, 2000, 3000, 5000];
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Identify if an error is a transient database connection error that is safe to retry.
 * Rejects:
 * - Authentication errors (e.g. P1000)
 * - Schema, validation, syntax, and query errors (e.g. P2xxx, constraint violations)
 * - Invariant or business logic errors
 */
export function isRetryableDatabaseError(err: any): boolean {
  if (!err) return false;

  const code = err.code || err.cause?.code;
  const message = (err.message || '').toLowerCase();

  // Non-retryable: Authentication failure
  if (code === 'P1000') {
    return false;
  }

  // Non-retryable: Prisma query / constraint / validation errors (P2xxx)
  if (typeof code === 'string' && /^P2\d{3}$/.test(code)) {
    return false;
  }

  // Explicit retryable Prisma codes
  // P1001: Can't reach database server
  // P1002: Database server was reached but timed out
  // P1008: Operations timed out
  // P1017: Server has closed the connection
  if (code === 'P1001' || code === 'P1002' || code === 'P1008' || code === 'P1017') {
    return true;
  }

  // System network errors
  const networkCodes = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ];
  if (networkCodes.includes(code)) {
    return true;
  }

  // Known transient message signatures
  if (
    message.includes('server has closed the connection') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('socket hang up') ||
    message.includes("can't reach database server") ||
    message.includes('database server was reached but timed out') ||
    message.includes('connection reset by peer')
  ) {
    return true;
  }

  return false;
}

/**
 * Execute an asynchronous database operation with bounded retry for transient errors.
 * Note: Retries on the existing client without resetting the shared Prisma singleton.
 */
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const opName = options.operationName ?? 'Database operation';

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;

      if (!isRetryableDatabaseError(err)) {
        logger.debug(
          { operation: opName, code: err?.code, message: err?.message },
          `[${opName}] Non-retryable database error encountered. Failing immediately.`
        );
        throw err;
      }

      if (attempt === maxAttempts) {
        logger.error(
          { operation: opName, attempt, maxAttempts, code: err?.code, message: err?.message },
          `[${opName}] Exhausted all ${maxAttempts} retry attempts for transient database error.`
        );
        break;
      }

      const delayMs = delays[attempt - 1] ?? delays[delays.length - 1] ?? 1000;
      logger.warn(
        { operation: opName, attempt, maxAttempts, delayMs, code: err?.code, message: err?.message },
        `[${opName}] Transient database error (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
