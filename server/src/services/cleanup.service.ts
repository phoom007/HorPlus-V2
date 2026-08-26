import { PrismaClient } from '@prisma/client';
import { localStorageProvider, LocalStorageProvider } from './local-storage.service.js';

const prisma = new PrismaClient();

export class CleanupService {
  private isRunning = false;

  constructor(
    private client: PrismaClient = prisma,
    private storage: LocalStorageProvider = localStorageProvider
  ) {}

  /**
   * Executes multi-phase lifecycle cleanup
   */
  async runCleanup(referenceTime: Date = new Date()): Promise<{
    expiredMarked: number;
    orphansDeleted: number;
    consumedMetadataPurged: number;
  }> {
    if (this.isRunning) {
      return { expiredMarked: 0, orphansDeleted: 0, consumedMetadataPurged: 0 };
    }

    this.isRunning = true;
    let expiredMarked = 0;
    let orphansDeleted = 0;
    let consumedMetadataPurged = 0;

    try {
      const now = referenceTime;

      // Phase 1: Mark expired intents (TTL: 15 minutes reached)
      const expiredIntentsToMark = await this.client.paymentUploadIntent.findMany({
        where: {
          status: { in: ['CREATED', 'UPLOADED'] },
          expiresAt: { lt: now }
        }
      });

      if (expiredIntentsToMark.length > 0) {
        const updateRes = await this.client.paymentUploadIntent.updateMany({
          where: {
            id: { in: expiredIntentsToMark.map((i) => i.id) },
            status: { in: ['CREATED', 'UPLOADED'] }
          },
          data: { status: 'EXPIRED' }
        });
        expiredMarked = updateRes.count;
      }

      // Phase 2: Expired orphan deletion: 24 hours after expiration
      const twentyFourHoursAfterExpiration = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const orphanCandidates = await this.client.paymentUploadIntent.findMany({
        where: {
          status: 'EXPIRED',
          expiresAt: { lt: twentyFourHoursAfterExpiration }
        }
      });

      for (const intent of orphanCandidates) {
        let canDeleteRow = true;

        if (intent.objectKey) {
          // Verify no Payment references this evidence before file deletion
          const referencedPayment = await this.client.payment.findFirst({
            where: {
              OR: [
                { evidenceUrl: intent.objectKey },
                ...(intent.sha256 ? [{ fileHash: intent.sha256 }] : [])
              ]
            }
          });

          if (!referencedPayment) {
            try {
              await this.storage.deleteFile(intent.objectKey);
            } catch (err: any) {
              console.error(`[CleanupService] Failed to delete physical orphan file: ${intent.objectKey}`, err);
              // Preserve database row for future retry if physical deletion fails unexpectedly
              canDeleteRow = false;
            }
          }
        }

        if (canDeleteRow) {
          try {
            await this.client.paymentUploadIntent.delete({ where: { id: intent.id } });
            orphansDeleted++;
          } catch (err) {
            console.error(`[CleanupService] Failed to delete intent record: ${intent.id}`, err);
          }
        }
      }

      // Phase 3: Consumed-intent metadata retention: 7 days
      // Only intent metadata is removed. Payment, Receipt, and evidence history remain untouched.
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const consumedRes = await this.client.paymentUploadIntent.deleteMany({
        where: {
          status: 'CONSUMED',
          consumedAt: { lt: sevenDaysAgo }
        }
      });
      consumedMetadataPurged = consumedRes.count;

      // Phase 4: Automatic Scheduled Contract & Provisional Term Activation (Asia/Bangkok effective dates)
      try {
        const { ContractRenewalService } = await import('./contract-renewal.service.js');
        const renewalService = new ContractRenewalService();
        await renewalService.activateAllScheduledContracts();

        const { provisionalRentalTermService } = await import('./provisional-rental-term.service.js');
        await provisionalRentalTermService.activateScheduledProvisionalTerms(undefined, new Date(), 'system-scheduled-job');

        const { dailyStayService } = await import('./daily-stay.service.js');
        await dailyStayService.activateScheduledDailyStays(undefined, new Date(), 'system-scheduled-job');
        await dailyStayService.completeEndedDailyStays(undefined, new Date(), 'system-scheduled-job');
      } catch (err) {
        console.error('[CleanupService] Error during automatic scheduled contract/provisional/daily activation', err);
      }

      // Phase 5: Outbox Event Reconciliation & Dispatch
      try {
        const { outboxService } = await import('./outbox.service.js');
        await outboxService.processPendingOutboxEvents();
      } catch (err) {
        console.error('[CleanupService] Error during outbox reconciliation', err);
      }

      return { expiredMarked, orphansDeleted, consumedMetadataPurged };
    } catch (err) {
      console.error('[CleanupService] Unexpected error during cleanup execution', err);
      return { expiredMarked, orphansDeleted, consumedMetadataPurged };
    } finally {
      this.isRunning = false;
    }
  }

  private intervalId: NodeJS.Timeout | null = null;

  startHourly() {
    this.runCleanup();
    this.intervalId = setInterval(() => this.runCleanup(), 60 * 60 * 1000);
  }

  async startDailyLateFee() {
    const { lateFeeReconciliationService } = await import('./late-fee-reconciliation.service.js');
    lateFeeReconciliationService.startDailySchedule();
  }

  async runStartupCatchUp(referenceTime: Date = new Date(), dormitoryId?: string) {
    const { lateFeeReconciliationService } = await import('./late-fee-reconciliation.service.js');
    return lateFeeReconciliationService.runStartupCatchUp(referenceTime, dormitoryId);
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const { lateFeeReconciliationService } = await import('./late-fee-reconciliation.service.js');
    lateFeeReconciliationService.stop();
  }
}

export const cleanupService = new CleanupService();
