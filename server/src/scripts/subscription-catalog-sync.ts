/**
 * Subscription Catalog Sync & Drift Check CLI (Task-009 — Option A Sync CLI)
 * Usage:
 *   npx ts-node src/scripts/subscription-catalog-sync.ts
 *   npx ts-node src/scripts/subscription-catalog-sync.ts --dry-run
 *   npx ts-node src/scripts/subscription-catalog-sync.ts --check
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { CANONICAL_SUBSCRIPTION_CATALOG } from '../config/subscription-catalog.js';

export async function syncSubscriptionCatalog(prisma: PrismaClient, options: { dryRun?: boolean; checkOnly?: boolean } = {}) {
  const { dryRun = false, checkOnly = false } = options;
  console.log(`[CatalogSync] Running catalog sync (version ${CANONICAL_SUBSCRIPTION_CATALOG.version})... mode: ${checkOnly ? 'CHECK' : dryRun ? 'DRY_RUN' : 'EXECUTE'}`);

  let changesDetected = false;

  // 1. Sync Plans
  for (const planDef of CANONICAL_SUBSCRIPTION_CATALOG.plans) {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { code: planDef.code },
    });

    if (!existing) {
      changesDetected = true;
      console.log(`[CatalogSync] Plan missing: ${planDef.code}`);
      if (!dryRun && !checkOnly) {
        await prisma.subscriptionPlan.create({
          data: {
            code: planDef.code,
            name: planDef.name,
            type: planDef.type,
            roomLimit: planDef.roomLimit,
            messageQuotaMonthly: planDef.messageQuotaMonthly,
            enabled: planDef.enabled,
          },
        });
      }
    } else if (
      existing.name !== planDef.name ||
      existing.roomLimit !== planDef.roomLimit ||
      existing.messageQuotaMonthly !== planDef.messageQuotaMonthly ||
      existing.enabled !== planDef.enabled
    ) {
      changesDetected = true;
      console.log(`[CatalogSync] Plan drift detected for: ${planDef.code}`);
      if (!dryRun && !checkOnly) {
        await prisma.subscriptionPlan.update({
          where: { code: planDef.code },
          data: {
            name: planDef.name,
            roomLimit: planDef.roomLimit,
            messageQuotaMonthly: planDef.messageQuotaMonthly,
            enabled: planDef.enabled,
          },
        });
      }
    }
  }

  // 2. Sync Packages
  for (const pkgDef of CANONICAL_SUBSCRIPTION_CATALOG.packages) {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { code: pkgDef.planCode },
    });

    if (!plan) {
      throw new Error(`Catalog plan not found in database: ${pkgDef.planCode}`);
    }

    const existingPkg = await prisma.subscriptionPackage.findUnique({
      where: { plan_duration_unique: { planId: plan.id, durationMonths: pkgDef.durationMonths } },
    });

    if (!existingPkg) {
      changesDetected = true;
      console.log(`[CatalogSync] Package missing: ${pkgDef.planCode} ${pkgDef.durationMonths}m @ ${pkgDef.price}`);
      if (!dryRun && !checkOnly) {
        await prisma.subscriptionPackage.create({
          data: {
            planId: plan.id,
            durationMonths: pkgDef.durationMonths,
            price: pkgDef.price,
            currency: pkgDef.currency,
            enabled: pkgDef.enabled,
            catalogVersion: CANONICAL_SUBSCRIPTION_CATALOG.version,
          },
        });
      }
    } else {
      const existingPrice = existingPkg.price !== null ? Number(existingPkg.price) : null;
      if (
        existingPrice !== pkgDef.price ||
        existingPkg.enabled !== pkgDef.enabled ||
        existingPkg.catalogVersion !== CANONICAL_SUBSCRIPTION_CATALOG.version
      ) {
        changesDetected = true;
        console.log(`[CatalogSync] Package drift detected: ${pkgDef.planCode} ${pkgDef.durationMonths}m`);
        if (!dryRun && !checkOnly) {
          await prisma.subscriptionPackage.update({
            where: { id: existingPkg.id },
            data: {
              price: pkgDef.price,
              currency: pkgDef.currency,
              enabled: pkgDef.enabled,
              catalogVersion: CANONICAL_SUBSCRIPTION_CATALOG.version,
            },
          });
        }
      }
    }
  }

  if (checkOnly) {
    if (changesDetected) {
      console.error('[CatalogSync] DRIFT DETECTED: Database catalog does not match developer catalog file!');
      process.exitCode = 1;
      return false;
    }
    console.log('[CatalogSync] OK: Database catalog matches developer catalog file.');
    return true;
  }

  console.log(`[CatalogSync] Catalog sync completed successfully. Changes detected: ${changesDetected}`);
  return true;
}

// CLI execution entrypoint
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.includes('subscription-catalog-sync')) {
  const isDryRun = process.argv.includes('--dry-run');
  const isCheck = process.argv.includes('--check');
  const prisma = new PrismaClient();

  syncSubscriptionCatalog(prisma, { dryRun: isDryRun, checkOnly: isCheck })
    .catch((err) => {
      console.error('[CatalogSync] FATAL ERROR:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
