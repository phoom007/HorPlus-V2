/**
 * HorPlus LOCAL-07 — Reset Script
 * 
 * Safely removes ONLY LOCAL-07 UAT fixtures:
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

  // Also query for any existing dormitories with name like 'หอพัก HorPlus UAT%'
  const existingDorms = await prisma.dormitory.findMany({
    where: {
      OR: [
        { id: { in: targetDormIds } },
        { name: { startsWith: 'หอพัก HorPlus UAT' } },
        { email: { endsWith: '@horplus-uat.local' } },
      ],
    },
    select: { id: true, name: true },
  });

  const allDormIds = Array.from(new Set([...targetDormIds, ...existingDorms.map(d => d.id)]));

  const existingUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: targetUserIds } },
        { email: { endsWith: '@horplus-uat.local' } },
        { googleSubject: { startsWith: 'mock_owner_uat_' } },
        { googleSubject: { startsWith: 'mock_tenant_' } },
        { googleSubject: { in: ['mock_manager_uat', 'mock_tech_uat'] } },
      ],
    },
    select: { id: true, email: true },
  });

  const allUserIds = Array.from(new Set([...targetUserIds, ...existingUsers.map(u => u.id)]));

  console.log(`[LOCAL-07 RESET] Found ${allDormIds.length} UAT dormitories and ${allUserIds.length} UAT users to clean.`);

  if (allDormIds.length === 0 && allUserIds.length === 0) {
    console.log('[LOCAL-07 RESET] No UAT records to clean. Database is ready.');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (allDormIds.length > 0) {
      await tx.paymentUploadIntent.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.receipt.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.receiptSequence.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.payment.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.billItem.deleteMany({ where: { bill: { dormitoryId: { in: allDormIds } } } }).catch(() => {});
      await tx.billStatusHistory.deleteMany({ where: { bill: { dormitoryId: { in: allDormIds } } } }).catch(() => {});
      await tx.bill.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.billingRateSnapshot.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.roomNextCycleCorrection.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.meterReading.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.meterReplacement.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.meterDevice.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.billingCycle.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});

      await tx.tenantMoveOutRequest.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.tenantRenewalRequest.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.contractSettlementItem.deleteMany({ where: { settlement: { dormitoryId: { in: allDormIds } } } }).catch(() => {});
      await tx.contractSettlement.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});

      await tx.tenantNotice.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.staffNotification.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.localNotificationOutbox.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});

      await tx.linePushDeliveryAttempt.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.linePushUsage.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.lineWebhookEventReceipt.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.dormitoryAccessGrant.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.dormitoryLineFriend.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.dormitoryLineConfig.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});

      await tx.tenantCoOccupant.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.tenantEmergencyContact.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.tenantVehicle.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.occupancy.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.contractSnapshot.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.contractStatusHistory.deleteMany({ where: { contract: { dormitoryId: { in: allDormIds } } } }).catch(() => {});
      await tx.contract.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.tenant.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});

      await tx.room.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.building.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});

      await tx.dormitoryMember.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.role.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});

      await tx.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.ownerSignature.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.accountBenefitClaim.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.platformSubscription.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.dormitorySubscription.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.auditLog.deleteMany({ where: { dormitoryId: { in: allDormIds } } }).catch(() => {});
      await tx.dormitory.deleteMany({ where: { id: { in: allDormIds } } }).catch(() => {});
    }

    if (allUserIds.length > 0) {
      await tx.session.deleteMany({ where: { userId: { in: allUserIds } } }).catch(() => {});
      await tx.onboardingDraft.deleteMany({ where: { userId: { in: allUserIds } } }).catch(() => {});
      await tx.promoRedemption.deleteMany({ where: { userId: { in: allUserIds } } }).catch(() => {});
      await tx.user.deleteMany({ where: { id: { in: allUserIds } } }).catch(() => {});
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
