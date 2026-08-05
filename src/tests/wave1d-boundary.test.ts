import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Wave 1D Boundary Regression Tests (Frontend)', () => {
  it('should not contain prohibited Receipt references in FeaturesPage.tsx', () => {
    const featuresPage = fs.readFileSync(path.join(__dirname, '../pages/public/FeaturesPage.tsx'), 'utf8');
    expect(featuresPage).not.toContain('icon: Receipt');
    expect(featuresPage).not.toContain('ออกใบเสร็จรับเงิน');
    expect(featuresPage).not.toContain('ตรวจสอบการชำระเงินและสลิป');
  });

  it('should not contain advancePaymentAmount or Receipt type in types.ts', () => {
    const typesTs = fs.readFileSync(path.join(__dirname, '../types.ts'), 'utf8');
    expect(typesTs).not.toContain('advancePaymentAmount');
    expect(typesTs).not.toContain('export interface Receipt');
  });

  it.skip('should not contain Payment/Slip Upload UI in tenant.tsx (superseded by Wave 1E)', () => {
    const tenantTsx = fs.readFileSync(path.join(__dirname, '../pages/tenant.tsx'), 'utf8');
    expect(tenantTsx).not.toContain('subView === \'pay\'');
    expect(tenantTsx).not.toContain('subView === \'history\'');
    expect(tenantTsx).not.toContain('ชำระเงินตอนนี้');
    expect(tenantTsx).not.toContain('แนบสลิป');
    // activeTab could still be named payments_tab internally, but label should be changed
    expect(tenantTsx).toContain('label: \'บิล\'');
  });
});
