/**
 * HorPlus LOCAL-07 — Reset Script
 * 
 * Safely and reliably removes ONLY LOCAL-07 UAT fixtures:
 * 1. Dormitories tagged as LOCAL-07 (by IDs 10000001-*, 20000001-* or name "หอพัก HorPlus UAT%")
 * 2. Associated users (@horplus-uat.local or IDs 10000002-*, 20000002-*, etc.)
 * 
 * Never touches non-UAT dormitories or users.
 * 
 * @license Apache-2.0
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { FRESH_DORM, COMP_DORM } from './constants.mjs';

const targetInfo = assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

export async function resetLocal07Data() {
  console.log(`[LOCAL-07 RESET] Target: ${targetInfo.host}:${targetInfo.port}/${targetInfo.database}`);

  const targetDormIds = [FRESH_DORM.id, COMP_DORM.id];
  const targetUserIds = [
    FRESH_DORM.owner.id,
    COMP_DORM.owner.id,
    COMP_DORM.manager.id,
    COMP_DORM.tech.id,
    COMP_DORM.tenantSomchai.id,
  ];

  // 1. Discover all UAT dormitories
  const existingDorms = await prisma.dormitory.findMany({
    where: {
      OR: [
        { id: { in: targetDormIds } },
        { name: { startsWith: 'หอพัก HorPlus UAT' } },
        { email: { endsWith: '@horplus-uat.local' } },
        { createdByUserId: { in: targetUserIds } },
      ],
    },
    select: { id: true, name: true },
  });

  const allDormIds = Array.from(new Set([...targetDormIds, ...existingDorms.map((d) => d.id)]));

  // 2. Discover all UAT users
  const existingUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: targetUserIds } },
        { email: { endsWith: '@horplus-uat.local' } },
        { emailNormalized: { endsWith: '@horplus-uat.local' } },
        { googleSubject: { startsWith: 'mock_owner_uat_' } },
        { googleSubject: { startsWith: 'mock_tenant_' } },
        { googleSubject: { in: ['mock_manager_uat', 'mock_tech_uat', 'mock_owner_uat_fresh', 'mock_owner_uat_comp'] } },
      ],
    },
    select: { id: true, email: true },
  });

  const allUserIds = Array.from(new Set([...targetUserIds, ...existingUsers.map((u) => u.id)]));

  console.log(`[LOCAL-07 RESET] Found ${allDormIds.length} UAT dormitories and ${allUserIds.length} UAT users to clean.`);

  if (allDormIds.length === 0 && allUserIds.length === 0) {
    console.log('[LOCAL-07 RESET] No UAT records to clean. Database is ready.');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    // A. Clean Dormitory-scoped tables
    if (allDormIds.length > 0) {
      await tx.paymentUploadIntent.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.receipt.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.receiptSequence.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.payment.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.billItem.deleteMany({ where: { bill: { dormitoryId: { in: allDormIds } } } });
      await tx.billStatusHistory.deleteMany({ where: { bill: { dormitoryId: { in: allDormIds } } } });
      await tx.bill.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.billingRateSnapshot.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.roomNextCycleCorrection.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.meterReading.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.meterReplacement.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.meterDevice.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.billingCycle.deleteMany({ where: { dormitoryId: { in: allDormIds } } });

      await tx.tenantMoveOutRequest.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.tenantRenewalRequest.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.contractSettlementItem.deleteMany({ where: { settlement: { dormitoryId: { in: allDormIds } } } });
      await tx.contractSettlement.deleteMany({ where: { dormitoryId: { in: allDormIds } } });

      await tx.tenantNotice.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.staffNotification.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.localNotificationOutbox.deleteMany({ where: { dormitoryId: { in: allDormIds } } });

      await tx.linePushDeliveryAttempt.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.linePushUsage.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.lineWebhookEventReceipt.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.dormitoryAccessGrant.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.dormitoryLineFriend.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.dormitoryLineConfig.deleteMany({ where: { dormitoryId: { in: allDormIds } } });

      await tx.tenantCoOccupant.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.tenantEmergencyContact.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.tenantVehicle.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.occupancy.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.contractSnapshot.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.contractStatusHistory.deleteMany({ where: { contract: { dormitoryId: { in: allDormIds } } } });
      await tx.contract.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.tenant.deleteMany({ where: { dormitoryId: { in: allDormIds } } });

      await tx.room.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.building.deleteMany({ where: { dormitoryId: { in: allDormIds } } });

      await tx.dormitoryMember.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.role.deleteMany({ where: { dormitoryId: { in: allDormIds } } });

      await tx.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.ownerSignature.deleteMany({ where: { dormitoryId: { in: allDormIds } } });

      await tx.promoRedemption.deleteMany({ where: { OR: [{ dormitoryId: { in: allDormIds } }, { redeemedBy: { in: allUserIds } }] } });
      await tx.accountBenefitClaim.deleteMany({ where: { OR: [{ dormitoryId: { in: allDormIds } }, { userId: { in: allUserIds } }] } });
      await tx.subscriptionPackageIntent.deleteMany({ where: { OR: [{ dormitoryId: { in: allDormIds } }, { userId: { in: allUserIds } }] } });
      await tx.platformSubscription.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.subscriptionStatusHistory.deleteMany({ where: { OR: [{ dormitoryId: { in: allDormIds } }, { actorId: { in: allUserIds } }] } });
      await tx.dormitorySubscription.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.auditLog.deleteMany({ where: { dormitoryId: { in: allDormIds } } });
      await tx.onboardingDraft.deleteMany({ where: { OR: [{ provisionalDormitoryId: { in: allDormIds } }, { userId: { in: allUserIds } }] } });

      await tx.dormitory.deleteMany({ where: { id: { in: allDormIds } } });
    }

    // B. Clean User-scoped tables
    if (allUserIds.length > 0) {
      await tx.session.deleteMany({ where: { userId: { in: allUserIds } } });
      await tx.ownerSignature.deleteMany({ where: { signedByUserId: { in: allUserIds } } });
      await tx.paymentUploadIntent.deleteMany({ where: { authenticatedUserId: { in: allUserIds } } });
      await tx.dormitoryMember.deleteMany({ where: { userId: { in: allUserIds } } });
      await tx.dormitory.deleteMany({ where: { createdByUserId: { in: allUserIds } } });
      await tx.user.deleteMany({ where: { id: { in: allUserIds } } });
    }
  });

  console.log('✅ [LOCAL-07 RESET] Reset completed cleanly.');
  await prisma.$disconnect();
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('reset.mjs')) {
  resetLocal07Data().catch((err) => {
    console.error(`❌ [LOCAL-07 RESET FAILED] ${err.message}`);
    process.exit(1);
  });
}
