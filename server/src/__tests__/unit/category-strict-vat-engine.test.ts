import { describe, it, expect } from 'vitest';
import {
  calculateCategoryStrictVat,
  isCategoryTaxable,
  parseToSatangs,
  formatSatangs,
} from '../../utils/monthly-utility-calculator.util.js';

describe('Category-Strict Centralized VAT 7% Engine (Backend)', () => {
  it('correctly converts decimal strings to satangs and back without floating point drift', () => {
    expect(parseToSatangs('0.00')).toBe(0n);
    expect(parseToSatangs('100.00')).toBe(10000n);
    expect(parseToSatangs('214.50')).toBe(21450n);
    expect(parseToSatangs(350.25)).toBe(35025n);
    expect(formatSatangs(10000n)).toBe('100.00');
    expect(formatSatangs(21450n)).toBe('214.50');
    expect(formatSatangs(7n)).toBe('0.07');
  });

  it('strictly returns isTaxable = false when VAT is disabled globally', () => {
    const vatSettings = {
      enabled: false,
      rate: 7,
      appliedCategories: ['rent', 'water', 'electricity'],
    };

    expect(isCategoryTaxable('rent', vatSettings)).toBe(false);
    expect(isCategoryTaxable('water', vatSettings)).toBe(false);
    expect(isCategoryTaxable('electricity', vatSettings)).toBe(false);

    const items = [
      { type: 'rent', amount: '4000.00' },
      { type: 'water', amount: '200.00' },
      { type: 'electricity', amount: '500.00' },
    ];

    const res = calculateCategoryStrictVat(items, vatSettings);
    expect(res.isVatActive).toBe(false);
    expect(res.baseSubtotal).toBe('4700.00');
    expect(res.vatableSubtotal).toBe('0.00');
    expect(res.vatAmount).toBe('0.00');
    expect(res.netTotal).toBe('4700.00');
    expect(res.items.every((i) => !i.isTaxable && i.vatAmount === '0.00')).toBe(true);
  });

  it('strictly calculates VAT ONLY for categories in appliedCategories', () => {
    // PO Requirement: Rent & Common Fee enabled for VAT, Water & Electricity disabled
    const vatSettings = {
      enabled: true,
      rate: 7,
      appliedCategories: ['rent', 'commonFee'],
    };

    expect(isCategoryTaxable('rent', vatSettings)).toBe(true);
    expect(isCategoryTaxable('common_fee', vatSettings)).toBe(true);
    expect(isCategoryTaxable('commonFee', vatSettings)).toBe(true);
    expect(isCategoryTaxable('water', vatSettings)).toBe(false);
    expect(isCategoryTaxable('electricity', vatSettings)).toBe(false);

    const items = [
      { type: 'rent', amount: '4000.00', description: 'ค่าเช่าห้อง' },
      { type: 'water', amount: '200.00', description: 'ค่าน้ำประปา' },
      { type: 'electricity', amount: '500.00', description: 'ค่าไฟฟ้า' },
      { type: 'common_fee', amount: '200.00', description: 'ค่าส่วนกลาง' },
    ];

    const res = calculateCategoryStrictVat(items, vatSettings);
    expect(res.isVatActive).toBe(true);
    expect(res.baseSubtotal).toBe('4900.00');
    // Vatable subtotal = 4000 (rent) + 200 (common fee) = 4200.00
    expect(res.vatableSubtotal).toBe('4200.00');
    expect(res.nonVatableSubtotal).toBe('700.00');
    // 7% of 4000 = 280.00, 7% of 200 = 14.00 -> Total VAT = 294.00
    expect(res.vatAmount).toBe('294.00');
    // Net total = 4900 + 294 = 5194.00
    expect(res.netTotal).toBe('5194.00');

    // Verify per-item outputs
    const rentItem = res.items.find((i) => i.type === 'rent')!;
    expect(rentItem.isTaxable).toBe(true);
    expect(rentItem.vatAmount).toBe('280.00');
    expect(rentItem.netAmount).toBe('4280.00');

    const commonItem = res.items.find((i) => i.type === 'common_fee')!;
    expect(commonItem.isTaxable).toBe(true);
    expect(commonItem.vatAmount).toBe('14.00');
    expect(commonItem.netAmount).toBe('214.00'); // Exactly 214.- as agreed in grill-me

    const waterItem = res.items.find((i) => i.type === 'water')!;
    expect(waterItem.isTaxable).toBe(false);
    expect(waterItem.vatAmount).toBe('0.00');
    expect(waterItem.netAmount).toBe('200.00');

    const elecItem = res.items.find((i) => i.type === 'electricity')!;
    expect(elecItem.isTaxable).toBe(false);
    expect(elecItem.vatAmount).toBe('0.00');
    expect(elecItem.netAmount).toBe('500.00');
  });

  it('handles empty appliedCategories safely with 0 VAT', () => {
    const vatSettings = {
      enabled: true,
      rate: 7,
      appliedCategories: [],
    };

    const items = [{ type: 'rent', amount: '5000.00' }];
    const res = calculateCategoryStrictVat(items, vatSettings);
    expect(res.vatAmount).toBe('0.00');
    expect(res.vatableSubtotal).toBe('0.00');
    expect(res.netTotal).toBe('5000.00');
  });

  it('handles discount amount deducted after VAT', () => {
    const vatSettings = {
      enabled: true,
      rate: 7,
      appliedCategories: ['rent'],
    };

    const items = [{ type: 'rent', amount: '3000.00' }];
    const discount = '500.00';
    // 3000 + 210 (VAT) - 500 = 2710.00
    const res = calculateCategoryStrictVat(items, vatSettings, discount);
    expect(res.baseSubtotal).toBe('3000.00');
    expect(res.vatAmount).toBe('210.00');
    expect(res.netTotal).toBe('2710.00');
  });
});
