/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2: Tier Breakdown Presentation Component
 */

import React from 'react';
import { formatBillingUnit } from '../../types';
import {
  isValidTieredBillItemMetadata,
  formatTierRange,
} from '../../utils/billPresentation';

interface TierBreakdownViewProps {
  metadata?: unknown;
  unit?: string | null;
  className?: string;
  isPrint?: boolean;
}

/**
 * Reusable component for rendering the authoritative nested tier breakdown for a BillItem.
 * Consumes persisted metadata directly without financial recalculation.
 * Fails closed if metadata is invalid or missing.
 */
export const TierBreakdownView: React.FC<TierBreakdownViewProps> = ({
  metadata,
  unit,
  className = '',
  isPrint = false,
}) => {
  if (!isValidTieredBillItemMetadata(metadata)) {
    return null;
  }

  const unitLabel = formatBillingUnit(unit) || 'หน่วย';
  const breakdown = metadata.tierBreakdown || [];

  return (
    <div
      className={`mt-1.5 pt-1.5 border-t border-slate-100 text-[11px] text-slate-500 font-normal space-y-1 ${className}`}
      data-testid="tier-breakdown-view"
    >
      <div className="text-[10px] font-semibold text-slate-400 mb-0.5">
        รายละเอียดการคิดแบบขั้นบันได:
      </div>
      {breakdown.map((tier, idx) => {
        const rangeText = formatTierRange(tier.lowerExclusive, tier.upperInclusive, unitLabel);
        const billedUnitsNum = Math.round(Number(tier.billedUnits));
        const rateStr = Number(tier.rate).toFixed(2);
        const amountStr = Number(tier.amount).toFixed(2);

        return (
          <div
            key={idx}
            className="flex items-center justify-between text-slate-600 pl-2 border-l-2 border-indigo-200"
            data-testid={`tier-row-${idx}`}
          >
            <span>• {rangeText}</span>
            <span className="font-mono text-slate-700">
              {billedUnitsNum} × {rateStr} = {amountStr} บาท
            </span>
          </div>
        );
      })}
    </div>
  );
};
