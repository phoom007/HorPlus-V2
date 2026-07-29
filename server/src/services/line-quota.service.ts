import { LineRepository, lineRepository } from '../db/repositories/line.repository.js';

export class LineQuotaService {
  constructor(private repo: LineRepository = lineRepository) {}

  getCurrentBangkokMonthYear(): { year: number; month: number } {
    // Bangkok Timezone UTC+7
    const now = new Date();
    const bangkokTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return {
      year: bangkokTime.getUTCFullYear(),
      month: bangkokTime.getUTCMonth() + 1
    };
  }

  async getQuotaStatus(dormitoryId: string) {
    const { year, month } = this.getCurrentBangkokMonthYear();
    const cycle = await this.repo.getOrCreateCurrentQuotaCycle(dormitoryId, year, month, 300);

    const limit = cycle.quotaLimit;
    const used = cycle.successfulSendCount;
    const remaining = Math.max(0, limit - used);

    return {
      limit,
      used,
      remaining,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      year: cycle.year,
      month: cycle.month
    };
  }

  async reserveQuota(dormitoryId: string): Promise<boolean> {
    const status = await this.getQuotaStatus(dormitoryId);
    return status.remaining > 0;
  }

  async consumeQuota(dormitoryId: string, ...args: any[]) {
    return this.consumeQuotaOnSuccess(dormitoryId);
  }

  async consumeQuotaOnSuccess(dormitoryId: string) {
    const { year, month } = this.getCurrentBangkokMonthYear();
    const cycle = await this.repo.getOrCreateCurrentQuotaCycle(dormitoryId, year, month, 300);
    await this.repo.incrementQuotaUsage(cycle.id);
  }
}

export const lineQuotaService = new LineQuotaService();
