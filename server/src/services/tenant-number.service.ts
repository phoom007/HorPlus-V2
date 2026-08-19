/**
 * Shared Canonical Tenant Number Authority
 * 
 * Provides dormitory-scoped, concurrency-safe, deterministic sequential tenant numbering
 * adhering to the established legacy-compatible format: TNT-<timestamp>-<zero-padded-sequence>.
 * 
 * Requires a Prisma transaction client (`tx`) to acquire PostgreSQL transaction-scoped advisory locks.
 * 
 * @license Apache-2.0
 */

import { Prisma } from '@prisma/client';

export class TenantNumberService {
  /**
   * Allocates the next canonical tenant number for a dormitory.
   * STRICT REQUIREMENT: Must be called within an active database transaction client (`tx`).
   */
  public static async allocateNextTenantNumber(
    dormitoryId: string,
    tx: Prisma.TransactionClient | any
  ): Promise<string> {
    if (!tx || typeof tx.$executeRaw !== 'function') {
      const err = new Error(
        'TENANT_NUMBER_ALLOCATION_REQUIRES_TRANSACTION: allocateNextTenantNumber must be called within an active database transaction client (tx)'
      );
      (err as any).statusCode = 500;
      (err as any).code = 'TRANSACTION_CLIENT_REQUIRED';
      throw err;
    }

    // 1. Acquire transaction-scoped advisory lock for this dormitory.
    // In PostgreSQL, pg_advisory_xact_lock is automatically released when the transaction ends (commit or rollback).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tenant_number:' || ${dormitoryId}::text))`;

    // 2. Fetch existing tenant numbers in the dormitory to find the max sequential number
    const existingTenants = await tx.tenant.findMany({
      where: { dormitoryId },
      select: { tenantNumber: true },
    });

    let maxSeq = 0;
    const existingSet = new Set<string>();

    for (const t of existingTenants) {
      if (t.tenantNumber) {
        existingSet.add(t.tenantNumber);
        // Extract sequence number from format TNT-<timestamp>-<seq> or TNT-<seq>
        const match = t.tenantNumber.match(/^TNT(?:-\d+)?-(\d+)$/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
    }

    const timestamp = Date.now();
    let nextSeq = Math.max(maxSeq + 1, existingTenants.length + 1);
    let candidate = `TNT-${timestamp}-${nextSeq.toString().padStart(4, '0')}`;

    // Guarantee collision avoidance against any existing numbers
    while (existingSet.has(candidate)) {
      nextSeq++;
      candidate = `TNT-${timestamp}-${nextSeq.toString().padStart(4, '0')}`;
    }

    return candidate;
  }
}

export const generateNextTenantNumber = TenantNumberService.allocateNextTenantNumber;
