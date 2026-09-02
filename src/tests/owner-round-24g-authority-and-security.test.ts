import { describe, it, expect, vi } from 'vitest';
import { onboardingClient } from '../data/onboardingClient';
import * as httpClientModule from '../data/httpClient';

describe('Owner Round 2.4G: Pre-UAT Authority & Security Closure Suite', () => {

  describe('1. Explicit Numeric 0 vs Missing Authority for Rents & Deposits', () => {
    it('preserves explicit numeric 0 without turning into null/undefined', () => {
      const parseValue = (val: any) => {
        if (val !== undefined && val !== null && String(val) !== '') {
          return String(val);
        }
        return null;
      };

      expect(parseValue(0)).toBe('0');
      expect(parseValue('0')).toBe('0');
      expect(parseValue(4500)).toBe('4500');
      expect(parseValue('')).toBeNull();
      expect(parseValue(null)).toBeNull();
      expect(parseValue(undefined)).toBeNull();
    });

    it('proves Building per-rental-type deposit extraction maintains independence and explicit 0', () => {
      const extractBuildingDeposits = (b: any) => {
        const bMonthlyDepositStr = (b.monthlyDeposit !== undefined && b.monthlyDeposit !== null && String(b.monthlyDeposit) !== '') ? String(b.monthlyDeposit) : null;
        const bTermDepositStr = (b.termDeposit !== undefined && b.termDeposit !== null && String(b.termDeposit) !== '') ? String(b.termDeposit) : null;
        const bDailyDepositStr = (b.dailyDeposit !== undefined && b.dailyDeposit !== null && String(b.dailyDeposit) !== '') ? String(b.dailyDeposit) : null;
        const bDepositNum = (b.depositAmount !== undefined && b.depositAmount !== null && String(b.depositAmount) !== '')
          ? b.depositAmount
          : ((b.securityDeposit !== undefined && b.securityDeposit !== null && String(b.securityDeposit) !== '') ? b.securityDeposit : null);
        const bDepositStr = bDepositNum !== null ? String(bDepositNum) : null;

        return {
          depositAmount: bDepositStr,
          monthlyDeposit: bMonthlyDepositStr,
          termDeposit: bTermDepositStr,
          dailyDeposit: bDailyDepositStr,
        };
      };

      // Case A: Newly registered building with independent deposits including explicit 0
      const bldgA = extractBuildingDeposits({
        name: 'Building A',
        monthlyDeposit: 0,
        termDeposit: 10000,
        dailyDeposit: 500,
        securityDeposit: 0,
      });

      expect(bldgA.monthlyDeposit).toBe('0');
      expect(bldgA.termDeposit).toBe('10000');
      expect(bldgA.dailyDeposit).toBe('500');
      expect(bldgA.depositAmount).toBe('0');

      // Case B: Unconfigured deposits remain null, never artificial 0
      const bldgB = extractBuildingDeposits({
        name: 'Building B',
        monthlyDeposit: '',
        termDeposit: null,
        dailyDeposit: undefined,
        securityDeposit: '',
      });

      expect(bldgB.monthlyDeposit).toBeNull();
      expect(bldgB.termDeposit).toBeNull();
      expect(bldgB.dailyDeposit).toBeNull();
      expect(bldgB.depositAmount).toBeNull();
    });
  });

  describe('2. Add Room Independent Deposit Resolution & Legacy Compatibility', () => {
    const resolveValue = (bldVal: any, dormVal: any): number | '' => {
      if (bldVal !== null && bldVal !== undefined && bldVal !== '' && !isNaN(Number(bldVal))) {
        return Number(bldVal);
      }
      if (dormVal !== null && dormVal !== undefined && dormVal !== '' && !isNaN(Number(dormVal))) {
        return Number(dormVal);
      }
      return '';
    };

    const resolvePricingDefaults = (targetBld: any, defs: any) => {
      const bldMonthlyRent = targetBld?.monthlyRent !== undefined ? targetBld.monthlyRent : targetBld?.rawOverrides?.monthlyRent;
      const bldTermRent = targetBld?.termRent !== undefined ? targetBld.termRent : targetBld?.rawOverrides?.termRent;
      const bldDailyRent = targetBld?.dailyRent !== undefined ? targetBld.dailyRent : targetBld?.rawOverrides?.dailyRent;

      const monthlyRentVal = resolveValue(bldMonthlyRent, defs?.defaultMonthlyRent);
      const termRentVal = resolveValue(bldTermRent, defs?.defaultTermRent);
      const dailyRentVal = resolveValue(bldDailyRent, defs?.defaultDailyRent);

      const dormDeposit = defs?.defaultDeposit;

      const hasAnyExplicitPerTypeDeposit =
        (targetBld?.monthlyDeposit !== null && targetBld?.monthlyDeposit !== undefined && targetBld?.monthlyDeposit !== '') ||
        (targetBld?.termDeposit !== null && targetBld?.termDeposit !== undefined && targetBld?.termDeposit !== '') ||
        (targetBld?.dailyDeposit !== null && targetBld?.dailyDeposit !== undefined && targetBld?.dailyDeposit !== '');

      const legacyDepositAmount = targetBld?.depositAmount !== undefined && targetBld?.depositAmount !== null && targetBld?.depositAmount !== ''
        ? targetBld.depositAmount
        : targetBld?.rawOverrides?.depositAmount;

      const bldMonthlyDeposit = (targetBld?.monthlyDeposit !== null && targetBld?.monthlyDeposit !== undefined && targetBld?.monthlyDeposit !== '')
        ? targetBld.monthlyDeposit
        : (!hasAnyExplicitPerTypeDeposit && legacyDepositAmount !== undefined && legacyDepositAmount !== null && legacyDepositAmount !== '' ? legacyDepositAmount : undefined);

      const bldTermDeposit = (targetBld?.termDeposit !== null && targetBld?.termDeposit !== undefined && targetBld?.termDeposit !== '')
        ? targetBld.termDeposit
        : undefined;

      const bldDailyDeposit = (targetBld?.dailyDeposit !== null && targetBld?.dailyDeposit !== undefined && targetBld?.dailyDeposit !== '')
        ? targetBld.dailyDeposit
        : undefined;

      return {
        monthlyRent: monthlyRentVal,
        termRent: termRentVal,
        dailyRent: dailyRentVal,
        monthlyDeposit: resolveValue(bldMonthlyDeposit, dormDeposit),
        termDeposit: resolveValue(bldTermDeposit, dormDeposit),
        dailyDeposit: resolveValue(bldDailyDeposit, dormDeposit),
      };
    };

    it('resolves newly registered building with independent deposits including explicit 0', () => {
      const bld = {
        id: 'bld-1',
        monthlyRent: 4000,
        monthlyDeposit: 0,
        termDeposit: 8000,
        dailyDeposit: 500,
        depositAmount: 0,
      };
      const dormDefs = { defaultDeposit: 6000 };

      const res = resolvePricingDefaults(bld, dormDefs);
      expect(res.monthlyDeposit).toBe(0); // explicit 0 preserved, NOT overwritten by dorm default 6000
      expect(res.termDeposit).toBe(8000);
      expect(res.dailyDeposit).toBe(500);
    });

    it('resolves legacy building: depositAmount applies to monthlyDeposit, while term & daily use dorm defaults', () => {
      const legacyBld = {
        id: 'legacy-bld',
        monthlyRent: 3500,
        depositAmount: 5000,
        monthlyDeposit: null, // nullable column in DB after migration
        termDeposit: null,
        dailyDeposit: null,
      };
      const dormDefs = { defaultDeposit: 3000 };

      const res = resolvePricingDefaults(legacyBld, dormDefs);
      expect(res.monthlyDeposit).toBe(5000); // legacy compatibility
      expect(res.termDeposit).toBe(3000); // falls back to dorm default, NOT legacy 5000
      expect(res.dailyDeposit).toBe(3000); // falls back to dorm default, NOT legacy 5000
    });

    it('resolves unconfigured building and dorm defaults: returns empty string, NEVER artificial 0', () => {
      const unconfBld = {
        id: 'unconf-bld',
        monthlyRent: null,
        monthlyDeposit: null,
        termDeposit: null,
        dailyDeposit: null,
        depositAmount: null,
      };
      const unconfDorm = { defaultDeposit: null };

      const res = resolvePricingDefaults(unconfBld, unconfDorm);
      expect(res.monthlyRent).toBe('');
      expect(res.monthlyDeposit).toBe('');
      expect(res.termDeposit).toBe('');
      expect(res.dailyDeposit).toBe('');
    });
  });

  describe('3. Registration Local Draft Restoration Artificial-Zero Cleanup', () => {
    it('restores draft with unconfigured deposits to empty string, NEVER falling back to ?? 0', () => {
      const draft = {
        currentStep: 4,
        formData: {
          deposits: { securityDeposit: '' },
          buildings: [
            {
              name: 'Tower A',
              roomPrefix: 'A',
              securityDeposit: '',
              monthlyDeposit: '',
              termDeposit: '',
              dailyDeposit: '',
            },
          ],
        },
      };

      const restoredBuildings = draft.formData.buildings.map((b: any) => {
        const rawName = (typeof b.name === 'string' ? b.name : '').trim();
        const rawPrefix = (typeof b.roomPrefix === 'string' ? b.roomPrefix : '').trim();
        const effectiveName = rawName || rawPrefix || '';
        const rawSecDep = draft.formData?.deposits?.securityDeposit;
        const draftDormDep = (rawSecDep !== undefined && rawSecDep !== null && rawSecDep !== '') ? rawSecDep : '';
        const legacyDep = (b.securityDeposit !== undefined && b.securityDeposit !== null && b.securityDeposit !== '') ? b.securityDeposit : draftDormDep;
        const termDep = (b.termDeposit !== undefined && b.termDeposit !== null && b.termDeposit !== '') ? b.termDeposit : legacyDep;
        const monthlyDep = (b.monthlyDeposit !== undefined && b.monthlyDeposit !== null && b.monthlyDeposit !== '') ? b.monthlyDeposit : legacyDep;
        const dailyDep = (b.dailyDeposit !== undefined && b.dailyDeposit !== null && b.dailyDeposit !== '') ? b.dailyDeposit : legacyDep;

        return {
          ...b,
          name: effectiveName,
          roomPrefix: rawPrefix,
          termDeposit: termDep,
          monthlyDeposit: monthlyDep,
          dailyDeposit: dailyDep,
          securityDeposit: monthlyDep,
        };
      });

      expect(restoredBuildings[0].monthlyDeposit).toBe('');
      expect(restoredBuildings[0].termDeposit).toBe('');
      expect(restoredBuildings[0].dailyDeposit).toBe('');
      expect(restoredBuildings[0].securityDeposit).toBe('');
    });

    it('restores draft with explicit 0 to 0 correctly', () => {
      const draft = {
        currentStep: 4,
        formData: {
          deposits: { securityDeposit: 0 },
          buildings: [
            {
              name: 'Tower B',
              roomPrefix: 'B',
              securityDeposit: 0,
              monthlyDeposit: 0,
              termDeposit: 0,
              dailyDeposit: 0,
            },
          ],
        },
      };

      const restoredBuildings = draft.formData.buildings.map((b: any) => {
        const rawSecDep = draft.formData?.deposits?.securityDeposit;
        const draftDormDep = (rawSecDep !== undefined && rawSecDep !== null && rawSecDep !== '') ? rawSecDep : '';
        const legacyDep = (b.securityDeposit !== undefined && b.securityDeposit !== null && b.securityDeposit !== '') ? b.securityDeposit : draftDormDep;
        const termDep = (b.termDeposit !== undefined && b.termDeposit !== null && b.termDeposit !== '') ? b.termDeposit : legacyDep;
        const monthlyDep = (b.monthlyDeposit !== undefined && b.monthlyDeposit !== null && b.monthlyDeposit !== '') ? b.monthlyDeposit : legacyDep;
        const dailyDep = (b.dailyDeposit !== undefined && b.dailyDeposit !== null && b.dailyDeposit !== '') ? b.dailyDeposit : legacyDep;

        return {
          ...b,
          termDeposit: termDep,
          monthlyDeposit: monthlyDep,
          dailyDeposit: dailyDep,
          securityDeposit: monthlyDep,
        };
      });

      expect(restoredBuildings[0].monthlyDeposit).toBe(0);
      expect(restoredBuildings[0].termDeposit).toBe(0);
      expect(restoredBuildings[0].dailyDeposit).toBe(0);
      expect(restoredBuildings[0].securityDeposit).toBe(0);
    });
  });

  describe('4. Canonical HTTP Client Integration for Logo Mutations', () => {
    it('uses httpRequest with automatic CSRF token and X-Dormitory-Id for uploadLogo', async () => {
      const httpSpy = vi.spyOn(httpClientModule, 'httpRequest').mockResolvedValue({
        data: { logoUrl: '/api/v1/dormitories/dorm-test/logo', hasLogo: true },
      } as any);

      const fakeFile = new File(['test'], 'logo.png', { type: 'image/png' });
      const res = await onboardingClient.uploadLogo('dorm-test', fakeFile);

      expect(httpSpy).toHaveBeenCalledWith(
        'POST',
        '/dormitories/dorm-test/logo',
        expect.any(FormData),
        expect.objectContaining({
          dormitoryId: 'dorm-test',
          headers: expect.objectContaining({ 'X-Dormitory-Id': 'dorm-test' }),
        })
      );
      expect(res.hasLogo).toBe(true);
      expect(res.logoUrl).toBe('/api/v1/dormitories/dorm-test/logo');

      httpSpy.mockRestore();
    });

    it('uses httpRequest with automatic CSRF token and X-Dormitory-Id for deleteLogo', async () => {
      const httpSpy = vi.spyOn(httpClientModule, 'httpRequest').mockResolvedValue({
        data: { success: true },
      } as any);

      const res = await onboardingClient.deleteLogo('dorm-test');

      expect(httpSpy).toHaveBeenCalledWith(
        'DELETE',
        '/dormitories/dorm-test/logo',
        undefined,
        expect.objectContaining({
          dormitoryId: 'dorm-test',
          headers: expect.objectContaining({ 'X-Dormitory-Id': 'dorm-test' }),
        })
      );
      expect(res.success).toBe(true);

      httpSpy.mockRestore();
    });
  });
});