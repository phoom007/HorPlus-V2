/**
 * LINE Quota Utility for Client Tracking & Event Synchronization
 * @license Apache-2.0
 */

export interface LineQuotaDetail {
  month: string;
  amount: number;
}

/**
 * Decrement/consume local cache of LINE message quota and dispatch an event
 * so components like LineQuotaBadge can stay synchronized in real time.
 */
export function consumeLineQuota(month: string, amount: number = 1): void {
  try {
    const key = `line_quota_consumed_${month}`;
    const current = parseInt(localStorage.getItem(key) || '0', 10);
    localStorage.setItem(key, String(current + amount));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<LineQuotaDetail>('line-quota-consumed', {
          detail: { month, amount }
        })
      );
    }
  } catch (err) {
    console.error('[lineQuota] Failed to record local quota consumption:', err);
  }
}

/**
 * Get locally consumed quota for a given month
 */
export function getConsumedLineQuota(month: string): number {
  try {
    const key = `line_quota_consumed_${month}`;
    return parseInt(localStorage.getItem(key) || '0', 10);
  } catch {
    return 0;
  }
}
