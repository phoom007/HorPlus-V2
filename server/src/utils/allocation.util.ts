/**
 * @license Apache-2.0
 * OWNER R3.8c — Canonical Financial Allocation Engine
 *
 * Responsibilities:
 * 1. Scope isolation: Restrict allocations strictly to SAME dormitory, SAME room, SAME tenant.
 * 2. Bill ordering: Monthly/operational bills (oldest cycle first) BEFORE Deposit bills.
 * 3. Item ordering: RENT -> WATER -> ELECTRIC -> COMMON -> INTERNET -> PARKING -> OTHER -> LATE FEE.
 * 4. Overpayment check: Fail closed if submitAmount > totalEligibleOutstanding.
 * 5. Deterministic relational allocation plan computation.
 * 6. Legacy unallocated paid baseline protection (Room 104 case): if legacy unallocated paid amount > 0,
 *    allocate at bill level (billItemId = null) without guessing item distributions.
 */

import { Decimal } from 'decimal.js';
import { AppError } from '../types/index.js';

export interface EligibleBillItem {
  id: string;
  type: string;
  code?: string | null;
  description: string;
  amount: string | number | Decimal;
  displayOrder?: number;
  allocatedAmount?: string | number | Decimal;
}

export interface EligibleBill {
  id: string;
  dormitoryId: string;
  roomId: string;
  tenantId?: string | null;
  billNumber: string;
  billKind: string;
  status: string;
  billingDate: Date | string;
  dueDate?: Date | string | null;
  totalAmount: string | number | Decimal;
  paidAmount: string | number | Decimal;
  outstandingAmount: string | number | Decimal;
  legacyUnallocatedPaidAmount?: string | number | Decimal;
  billingCycleId?: string | null;
  billingCycle?: {
    id: string;
    cycleCode?: string | null;
    periodStart?: Date | string | null;
  } | null;
  items?: EligibleBillItem[];
}

export interface CalculatedAllocation {
  billId: string;
  billItemId?: string | null;
  allocatedAmount: Decimal;
  allocationOrder: number;
  description: string;
}

export interface AffectedBillSummary {
  id: string;
  billNumber: string;
  billKind: string;
  oldPaidAmount: Decimal;
  oldOutstandingAmount: Decimal;
  allocatedAmount: Decimal;
  newPaidAmount: Decimal;
  newOutstandingAmount: Decimal;
  newStatus: 'PAID' | 'PARTIALLY_PAID';
}

export interface AllocationPlan {
  totalSubmitted: Decimal;
  totalAllocated: Decimal;
  allocations: CalculatedAllocation[];
  affectedBills: AffectedBillSummary[];
  receiptItems: Array<{ description: string; amount: string }>;
}

export const ITEM_TYPE_PRIORITY: Record<string, number> = {
  rent: 1,
  RENT: 1,
  water: 2,
  WATER: 2,
  UTILITY_WATER: 2,
  electricity: 3,
  electric: 3,
  ELECTRIC: 3,
  ELECTRICITY: 3,
  UTILITY_ELECTRIC: 3,
  common_fee: 4,
  common: 4,
  COMMON: 4,
  COMMON_FEE: 4,
  internet: 5,
  INTERNET: 5,
  parking: 6,
  PARKING: 6,
  other: 7,
  OTHER: 7,
  OTHER_FEES: 7,
  deposit: 8,
  DEPOSIT: 8,
  fine: 9,
  late_fee: 9,
  LATE_FEE: 9,
  FINE: 9,
};

export function getItemPriority(type?: string | null): number {
  if (!type) return 7; // Default to OTHER
  const norm = type.trim();
  return ITEM_TYPE_PRIORITY[norm] !== undefined ? ITEM_TYPE_PRIORITY[norm] : 7;
}

/**
 * Computes canonical allocation plan across eligible bills and line items.
 */
export function computeCanonicalAllocationPlan(params: {
  submitAmount: string | number | Decimal;
  targetRoomId: string;
  targetTenantId?: string | null;
  eligibleBills: EligibleBill[];
}): AllocationPlan {
  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
  const submitAmount = new Decimal(params.submitAmount.toString());

  if (submitAmount.lessThanOrEqualTo(0)) {
    throw new AppError('จำนวนเงินที่ชำระต้องมากกว่า 0', 400, 'INVALID_AMOUNT');
  }

  // 1. Strict Scope Validation: Filter and verify all candidate bills belong to target room and tenant
  const scopeBills = params.eligibleBills.filter((bill) => {
    const isSameRoom = bill.roomId === params.targetRoomId;
    const isSameTenant = !params.targetTenantId || !bill.tenantId || bill.tenantId === params.targetTenantId;
    const isNotPaid = bill.status !== 'PAID' && bill.status !== 'paid' && bill.status !== 'cancelled' && bill.status !== 'void';
    const hasOutstanding = new Decimal(bill.outstandingAmount?.toString() || '0').greaterThan(0);
    return isSameRoom && isSameTenant && isNotPaid && hasOutstanding;
  });

  if (scopeBills.length === 0) {
    throw new AppError('ไม่พบบิลที่มียอดค้างชำระสำหรับห้องและผู้เช่าที่ระบุ', 400, 'NO_ELIGIBLE_BILLS');
  }

  // 2. Calculate total eligible outstanding
  let totalEligibleOutstanding = new Decimal(0);
  for (const bill of scopeBills) {
    totalEligibleOutstanding = totalEligibleOutstanding.plus(new Decimal(bill.outstandingAmount.toString()));
  }

  // 3. Overpayment Guard: reject if submitAmount > totalEligibleOutstanding
  if (submitAmount.greaterThan(totalEligibleOutstanding)) {
    throw new AppError(
      'ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก',
      400,
      'PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING'
    );
  }

  // 4. Sort Bills:
  // Operational/Monthly Bills BEFORE Deposit Bills.
  // Within monthly bills, OLDEST billing cycle first.
  const sortedBills = [...scopeBills].sort((a, b) => {
    const aIsDeposit = a.billKind === 'DEPOSIT' || a.billKind === 'deposit';
    const bIsDeposit = b.billKind === 'DEPOSIT' || b.billKind === 'deposit';

    if (aIsDeposit && !bIsDeposit) return 1;
    if (!aIsDeposit && bIsDeposit) return -1;

    // Both monthly or both deposit: sort by periodStart / cycleCode / billingDate
    const aCycleTime = a.billingCycle?.periodStart
      ? new Date(a.billingCycle.periodStart).getTime()
      : (a.billingCycle?.cycleCode ? a.billingCycle.cycleCode : new Date(a.billingDate).getTime());
    const bCycleTime = b.billingCycle?.periodStart
      ? new Date(b.billingCycle.periodStart).getTime()
      : (b.billingCycle?.cycleCode ? b.billingCycle.cycleCode : new Date(b.billingDate).getTime());

    if (aCycleTime < bCycleTime) return -1;
    if (aCycleTime > bCycleTime) return 1;

    // Tiebreaker: billingDate then id
    const aBillingTime = new Date(a.billingDate).getTime();
    const bBillingTime = new Date(b.billingDate).getTime();
    if (aBillingTime !== bBillingTime) return aBillingTime - bBillingTime;

    return a.id.localeCompare(b.id);
  });

  // 5. Greedily allocate funds
  let remainingToAllocate = submitAmount;
  let currentOrder = 1;
  const allocations: CalculatedAllocation[] = [];
  const affectedBills: AffectedBillSummary[] = [];
  const receiptItems: Array<{ description: string; amount: string }> = [];

  for (const bill of sortedBills) {
    if (remainingToAllocate.lessThanOrEqualTo(0)) break;

    const billOutstanding = new Decimal(bill.outstandingAmount.toString());
    const billTotal = new Decimal(bill.totalAmount.toString());
    const oldPaid = new Decimal(bill.paidAmount.toString());

    const allocateToThisBill = Decimal.min(remainingToAllocate, billOutstanding);
    if (allocateToThisBill.lessThanOrEqualTo(0)) continue;

    let remainingForThisBill = allocateToThisBill;

    // Check legacy unallocated paid amount (Room 104 case):
    // If there is an existing paidAmount with no historical allocation rows, item allocation is ambiguous.
    // Allocate at bill level (billItemId = null) with truthful description.
    const legacyUnallocated = new Decimal(bill.legacyUnallocatedPaidAmount?.toString() || '0');
    const hasLegacyUnallocated = legacyUnallocated.greaterThan(0);

    if (!hasLegacyUnallocated && bill.items && bill.items.length > 0) {
      const sortedItems = [...bill.items].sort((x, y) => {
        const pX = getItemPriority(x.type);
        const pY = getItemPriority(y.type);
        if (pX !== pY) return pX - pY;
        const dX = x.displayOrder || 0;
        const dY = y.displayOrder || 0;
        if (dX !== dY) return dX - dY;
        return x.id.localeCompare(y.id);
      });

      for (const item of sortedItems) {
        if (remainingForThisBill.lessThanOrEqualTo(0)) break;

        const itemTotal = new Decimal(item.amount.toString());
        const itemAlreadyAllocated = new Decimal(item.allocatedAmount?.toString() || '0');
        const itemOutstanding = Decimal.max(itemTotal.minus(itemAlreadyAllocated), new Decimal(0));

        if (itemOutstanding.lessThanOrEqualTo(0)) continue;

        const allocateToItem = Decimal.min(remainingForThisBill, itemOutstanding);
        if (allocateToItem.greaterThan(0)) {
          allocations.push({
            billId: bill.id,
            billItemId: item.id,
            allocatedAmount: allocateToItem,
            allocationOrder: currentOrder++,
            description: item.description || 'ค่าใช้จ่าย',
          });
          remainingForThisBill = remainingForThisBill.minus(allocateToItem);
        }
      }

      if (remainingForThisBill.greaterThan(0)) {
        allocations.push({
          billId: bill.id,
          billItemId: null,
          allocatedAmount: remainingForThisBill,
          allocationOrder: currentOrder++,
          description: `ชำระยอดบิล ${bill.billNumber}`,
        });
      }
    } else {
      // Bill-level allocation without item guessing
      const desc = hasLegacyUnallocated
        ? `ชำระยอดคงเหลือบิล ${bill.billNumber}`
        : `ชำระยอดบิล ${bill.billNumber}`;

      allocations.push({
        billId: bill.id,
        billItemId: null,
        allocatedAmount: allocateToThisBill,
        allocationOrder: currentOrder++,
        description: desc,
      });
    }

    const newPaid = oldPaid.plus(allocateToThisBill);
    const newOutstanding = Decimal.max(billTotal.minus(newPaid), new Decimal(0));
    const newStatus = newOutstanding.equals(0) ? 'PAID' : 'PARTIALLY_PAID';

    affectedBills.push({
      id: bill.id,
      billNumber: bill.billNumber,
      billKind: bill.billKind,
      oldPaidAmount: oldPaid,
      oldOutstandingAmount: billOutstanding,
      allocatedAmount: allocateToThisBill,
      newPaidAmount: newPaid,
      newOutstandingAmount: newOutstanding,
      newStatus,
    });

    const isDeposit = bill.billKind === 'DEPOSIT' || bill.billKind === 'deposit';
    const billKindLabel = isDeposit ? 'เงินประกัน' : 'บิล';
    const cycleLabel = bill.billingCycle?.cycleCode ? ` ${bill.billingCycle.cycleCode}` : '';
    receiptItems.push({
      description: `${billKindLabel}${cycleLabel} ${bill.billNumber}`,
      amount: allocateToThisBill.toFixed(2),
    });

    remainingToAllocate = remainingToAllocate.minus(allocateToThisBill);
  }

  const totalAllocated = submitAmount.minus(remainingToAllocate);

  return {
    totalSubmitted: submitAmount,
    totalAllocated,
    allocations,
    affectedBills,
    receiptItems,
  };
}
