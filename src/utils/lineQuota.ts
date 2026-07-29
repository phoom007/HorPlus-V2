/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LineQuotaInfo {
  cycleMonth: string; // e.g. '2026-07'
  totalQuota: number; // 300
  usedCount: number; // e.g. 15
  remainingQuota: number; // 300 - usedCount
  nextResetDate: string; // e.g. '1 สิงหาคม 2569'
}

export const TOTAL_MONTHLY_LINE_QUOTA = 300;

export const getThaiMonthName = (monthNum: number): string => {
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  return months[(monthNum - 1) % 12] || '';
};

export const getNextResetDate = (cycleMonth: string): string => {
  try {
    const [yearStr, monthStr] = cycleMonth.split('-');
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10);

    // Next month on day 1
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }

    const thaiYear = year + 543;
    const thaiMonth = getThaiMonthName(month);
    return `1 ${thaiMonth} ${thaiYear}`;
  } catch (e) {
    return '1 ของเดือนถัดไป';
  }
};

export const getLineQuotaInfo = (cycleMonth: string = '2026-07'): LineQuotaInfo => {
  const storageKey = `HorPlus_line_quota_${cycleMonth}`;
  let usedCount = 15; // default sample push usage count for demonstration

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        usedCount = parsed;
      }
    } else {
      localStorage.setItem(storageKey, String(usedCount));
    }
  } catch (e) {
    console.error('Error reading LINE quota from storage', e);
  }

  const remainingQuota = Math.max(0, TOTAL_MONTHLY_LINE_QUOTA - usedCount);
  const nextResetDate = getNextResetDate(cycleMonth);

  return {
    cycleMonth,
    totalQuota: TOTAL_MONTHLY_LINE_QUOTA,
    usedCount,
    remainingQuota,
    nextResetDate
  };
};

export const consumeLineQuota = (cycleMonth: string, count: number = 1): LineQuotaInfo => {
  const info = getLineQuotaInfo(cycleMonth);
  const newUsed = Math.min(TOTAL_MONTHLY_LINE_QUOTA, info.usedCount + count);
  
  try {
    localStorage.setItem(`HorPlus_line_quota_${cycleMonth}`, String(newUsed));
    window.dispatchEvent(new Event('line_quota_updated'));
  } catch (e) {
    console.error('Error updating LINE quota', e);
  }

  return getLineQuotaInfo(cycleMonth);
};

export const resetLineQuota = (cycleMonth: string): LineQuotaInfo => {
  try {
    localStorage.setItem(`HorPlus_line_quota_${cycleMonth}`, '0');
    window.dispatchEvent(new Event('line_quota_updated'));
  } catch (e) {
    console.error('Error resetting LINE quota', e);
  }
  return getLineQuotaInfo(cycleMonth);
};
