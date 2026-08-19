/**
 * Shared Canonical Tenant Number Authority
 * 
 * Provides dormitory-scoped, concurrency-safe, deterministic sequential tenant numbering.
 * Uses PostgreSQL transaction-scoped advisory locks to serialize concurrent tenant allocations
 * within the same dormitory without blocking unrelated dormitories.
 * 
 * @license Apache-2.0
 */

import { getPrismaClient } from '../db/prisma.js';

export class TenantNumberService {
  /**
   * Allocates the next canonical tenant number for a dormitory.
   * Must be called within a database transaction client (`tx`).
   */
  public static async allocateNextTenantNumber(
    dormitoryId: string,
    client?: any
  ): Promise<string> {
    const prisma = client || getPrismaClient();

    // 1. Acquire transaction-scoped advisory lock for this dormitory
    // This serializes all concurrent tenant creations within the same dormitory.
    if (prisma.$executeRaw) {
      await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tenant_number:' || ${dormitoryId}::text))`;
    }

    // 2. Fetch existing tenant numbers in the dormitory to find the max sequential number
    const existingTenants = await prisma.tenant.findMany({
      where: { dormitoryId },
      select: { tenantNumber: true },
    });

    let maxSeq = 0;
    const existingSet = new Set<string>();

    for (const t of existingTenants) {
      if (t.tenantNumber) {
        existingSet.add(t.tenantNumber);
        // Match standard format TNT-XXXX (e.g. TNT-0001)
        const match = t.tenantNumber.match(/^TNT-(\d+)$/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
    }

    // Next sequence is at least maxSeq + 1 and at least count + 1
    let nextSeq = Math.max(maxSeq + 1, existingTenants.length + 1);
    let candidate = `TNT-${nextSeq.toString().padStart(4, '0')}`;

    // Guarantee collision avoidance against any out-of-band numbers
    while (existingSet.has(candidate)) {
      nextSeq++;
      candidate = `TNT-${nextSeq.toString().padStart(4, '0')}`;
    }

    return candidate;
  }
}

export const generateNextTenantNumber = TenantNumberService.allocateNextTenantNumber;
