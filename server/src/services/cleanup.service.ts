import { PrismaClient } from '@prisma/client';
import { localStorageProvider } from './local-storage.service.js';

const prisma = new PrismaClient();

export class CleanupService {
  private isRunning = false;

  constructor(
    private client: PrismaClient = prisma,
    private storage = localStorageProvider
  ) {}

  async runCleanup() {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let cleanedCount = 0;
    try {
      const now = new Date();
      
      // 1. Expired unconsumed intent/file deletion: expired intents
      const orphanedIntents = await this.client.paymentUploadIntent.findMany({
        where: {
          status: { in: ['CREATED', 'UPLOADED'] },
          expiresAt: { lt: now }
        }
      });

      for (const intent of orphanedIntents) {
        if (intent.objectKey) {
          // Verify it's not referenced by PaymentEvidence (Payment.fileHash)
          const referenced = intent.sha256 ? await this.client.payment.findFirst({ where: { fileHash: intent.sha256 } }) : null;
          if (!referenced) {
            try {
              await this.storage.deleteFile(intent.objectKey);
            } catch (e) {}
          }
        }
        await this.client.paymentUploadIntent.delete({ where: { id: intent.id } });
        cleanedCount++;
      }

      // 2. Consumed intent metadata retention: 7 days
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const consumedRes = await this.client.paymentUploadIntent.deleteMany({
        where: {
          status: 'CONSUMED',
          consumedAt: { lt: sevenDaysAgo }
        }
      });
      cleanedCount += consumedRes.count;
      
      return cleanedCount;
    } catch (err) {
      console.error('Cleanup Service Error', err);
      return cleanedCount;
    } finally {
      this.isRunning = false;
    }
  }

  startHourly() {
    // Run once on startup, then every hour
    this.runCleanup();
    setInterval(() => this.runCleanup(), 60 * 60 * 1000);
  }
}

export const cleanupService = new CleanupService();
