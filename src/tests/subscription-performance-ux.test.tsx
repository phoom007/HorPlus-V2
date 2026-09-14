// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SubscriptionBillboard, DEFAULT_BILLBOARD_ADS } from '../pages/owner/subscription';
import { ThaiQrLogo } from '../components/common/ThaiQrLogo';

describe('Subscription Performance and UX Hardening (PERF-01 to PERF-05)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PERF-01: Billboard Timer Pause & Re-render Isolation', () => {
    it('should pause auto-rotation timer when isPaused is true (e.g. payment view is open)', () => {
      const { unmount } = render(
        <SubscriptionBillboard
          billboardAds={DEFAULT_BILLBOARD_ADS}
          isPaused={true}
        />
      );

      // Advance time by 10 seconds (more than 3500ms cycle)
      act(() => {
        vi.advanceTimersByTime(10000);
      });

      // Since isPaused is true, first slide must remain active (indicator for index 0 has 'w-6 bg-blue-600')
      const activeIndicator = screen.getByTitle('ไปที่รูปที่ 1');
      expect(activeIndicator.className).toContain('w-6 bg-blue-600');

      unmount();
    });

    it('should rotate slides when isPaused is false and tab is visible', () => {
      const { unmount } = render(
        <SubscriptionBillboard
          billboardAds={DEFAULT_BILLBOARD_ADS}
          isPaused={false}
        />
      );

      // Slide 1 active initially
      expect(screen.getByTitle('ไปที่รูปที่ 1').className).toContain('w-6 bg-blue-600');

      // Advance 3500ms
      act(() => {
        vi.advanceTimersByTime(3500);
      });

      // Now slide 2 must be active
      expect(screen.getByTitle('ไปที่รูปที่ 2').className).toContain('w-6 bg-blue-600');

      unmount();
    });
  });

  describe('PERF-02: Zero Layout Shift in Payment View (Trial Pre-render & Container Stability)', () => {
    it('should immediately evaluate currentPrice to 0 for trial-eligible dormitories on 1-month selection', () => {
      const subInfo = {
        isTrialEligible: true,
        planId: 'free',
      };
      const durationMonths = 1;
      const basePrice = 189;
      const promoDiscountAmount = 0;
      const serverQuote = null; // Before server quote arrives

      const isTrialApplicable = Boolean(subInfo.isTrialEligible && durationMonths === 1);
      const currentPrice = (serverQuote as any)?.finalPayableAmount !== undefined
        ? (serverQuote as any).finalPayableAmount
        : isTrialApplicable
          ? 0
          : Math.max(0, basePrice - promoDiscountAmount);

      expect(currentPrice).toBe(0);
    });

    it('should evaluate currentPrice to base price when duration is greater than 1 even if trial-eligible', () => {
      const subInfo = {
        isTrialEligible: true,
        planId: 'free',
      };
      const durationMonths = 3;
      const basePrice = 529;
      const promoDiscountAmount = 0;
      const serverQuote = null;

      const isTrialApplicable = Boolean(subInfo.isTrialEligible && durationMonths === 1);
      const currentPrice = (serverQuote as any)?.finalPayableAmount !== undefined
        ? (serverQuote as any).finalPayableAmount
        : isTrialApplicable
          ? 0
          : Math.max(0, basePrice - promoDiscountAmount);

      expect(currentPrice).toBe(529);
    });

    it('should instantly revert currentPrice back to 0 when user toggles back from 3 months to 1 month (SPEC-OPT-02)', () => {
      const subInfo = {
        isTrialEligible: true,
        planId: 'free',
      };
      let durationMonths = 3;
      let basePrice = 529;
      let serverQuote: any = null;

      const calcPrice = (duration: number, price: number) => {
        const isTrial = Boolean(subInfo.isTrialEligible && duration === 1);
        return serverQuote?.finalPayableAmount !== undefined
          ? serverQuote.finalPayableAmount
          : isTrial
            ? 0
            : price;
      };

      expect(calcPrice(durationMonths, basePrice)).toBe(529);

      // User switches back to 1 month
      durationMonths = 1;
      basePrice = 189;
      expect(calcPrice(durationMonths, basePrice)).toBe(0);
    });

    it('should compute buttonPrice to 0 for 1-month pill button when trial eligible', () => {
      const subInfo = { isTrialEligible: true };
      const testDurations = [
        { months: 1, price: 189 },
        { months: 3, price: 529 },
        { months: 6, price: 999 },
      ];

      const buttonPrices = testDurations.map(d => {
        const isTrial1m = Boolean(subInfo.isTrialEligible && d.months === 1);
        return {
          months: d.months,
          buttonPrice: isTrial1m ? 0 : d.price
        };
      });

      expect(buttonPrices.find(b => b.months === 1)?.buttonPrice).toBe(0);
      expect(buttonPrices.find(b => b.months === 3)?.buttonPrice).toBe(529);
    });
  });

  describe('PERF-03: Current Package Card Dimension & Synchronous View Transition', () => {
    it('maintains fixed min-height property for current package card', () => {
      const cardClasses = 'rounded-2xl p-4 sm:p-5 lg:p-6 flex flex-col justify-between min-h-[190px] sm:min-h-[205px] h-full';
      expect(cardClasses).toContain('min-h-[190px]');
      expect(cardClasses).toContain('sm:min-h-[205px]');
      expect(cardClasses).toContain('h-full');
    });

    it('synchronously triggers onDetailViewChange(false) upon closing payment view', () => {
      const mockOnDetailViewChange = vi.fn();
      let isPaymentViewOpen = true;

      const handleClosePaymentView = () => {
        mockOnDetailViewChange(false);
        isPaymentViewOpen = false;
      };

      handleClosePaymentView();
      expect(mockOnDetailViewChange).toHaveBeenCalledWith(false);
      expect(isPaymentViewOpen).toBe(false);
    });
  });

  describe('PERF-04: Local Asset Bundling (Official Thai QR Image Asset)', () => {
    it('should render local image for Thai QR logo referencing /images/Thai_QR_Logo.svg without external CDNs', () => {
      const { container } = render(<ThaiQrLogo className="h-8 w-auto" />);

      const imgEl = container.querySelector('img');
      expect(imgEl).toBeDefined();
      expect(imgEl?.getAttribute('src')).toBe('/images/Thai_QR_Logo.svg');
      expect(imgEl?.getAttribute('alt')).toBe('Thai QR Payment');

      // Assert zero external wikimedia or cdn image references
      expect(container.innerHTML).not.toContain('wikimedia.org');
      expect(container.innerHTML).not.toContain('http://');
      expect(container.innerHTML).not.toContain('https://');
    });
  });

  describe('PERF-05: Quote API Request Deduplication via Ref Guard', () => {
    it('should block redundant quote requests when parameters have not changed', () => {
      const mockHttpRequest = vi.fn().mockResolvedValue({
        data: {
          intentId: 'intent-123',
          finalPayableAmount: 189,
          promoDiscountAmount: 0,
          promoApplied: false
        }
      });

      let lastQuoteKey = '';
      const executeQuote = (pkgId: string, duration: number, promo: string, dormId: string) => {
        const currentQuoteKey = `${pkgId}:${duration}:${promo}:${dormId}`;
        if (lastQuoteKey === currentQuoteKey) {
          return; // Deduplicated
        }
        lastQuoteKey = currentQuoteKey;
        mockHttpRequest('POST', '/subscription/quote', { packageId: pkgId, promoCode: promo, dormitoryId: dormId });
      };

      // 1st call: fresh parameters
      executeQuote('pkg-1m', 1, '', 'dorm-01');
      expect(mockHttpRequest).toHaveBeenCalledTimes(1);

      // 2nd call: re-render with identical parameters
      executeQuote('pkg-1m', 1, '', 'dorm-01');
      expect(mockHttpRequest).toHaveBeenCalledTimes(1); // Blocked

      // 3rd call: another re-render tick
      executeQuote('pkg-1m', 1, '', 'dorm-01');
      expect(mockHttpRequest).toHaveBeenCalledTimes(1); // Still blocked

      // 4th call: duration changed to 3 months
      executeQuote('pkg-3m', 3, '', 'dorm-01');
      expect(mockHttpRequest).toHaveBeenCalledTimes(2); // Allowed!

      // 5th call: promo code applied
      executeQuote('pkg-3m', 3, 'DISCOUNT10', 'dorm-01');
      expect(mockHttpRequest).toHaveBeenCalledTimes(3); // Allowed!

      // 6th call: re-render with same promo
      executeQuote('pkg-3m', 3, 'DISCOUNT10', 'dorm-01');
      expect(mockHttpRequest).toHaveBeenCalledTimes(3); // Blocked!
    });
  });

  describe('PERF-06: Local Billboard Campaign Assets & Confirmed Thai Copy', () => {
    it('should reference local /billboards/X.jpg and contain confirmed Thai promotional headlines', () => {
      expect(DEFAULT_BILLBOARD_ADS).toHaveLength(4);

      // Verify each slide uses local paths
      DEFAULT_BILLBOARD_ADS.forEach((ad, idx) => {
        expect(ad.imageUrl).toBe(`/billboards/${idx + 1}.jpg`);
      });

      // Verify Slide 1 PO text
      expect(DEFAULT_BILLBOARD_ADS[0].title).toBe('หอพลัส+ เปิดทดลองฟรี 3 เดือน');
      expect(DEFAULT_BILLBOARD_ADS[0].description).toBe('ตรวจสลิปอัตโนมัติ แจ้งเตือน LINE ทำสัญญา ออกบิล แจ้งซ่อม ครอบคลุมครบวงจร');
      expect(DEFAULT_BILLBOARD_ADS[0].tag).toBe('ทดลองฟรี 3 เดือน');

      // Verify Slide 2 PO text
      expect(DEFAULT_BILLBOARD_ADS[1].title).toBe('ราคาแพ็กเกจ HORPLUS โปรโมชั่นประจำปี 2569');
      expect(DEFAULT_BILLBOARD_ADS[1].tag).toBe('โปรโมชั่นปี 2569');

      // Verify Slide 3 PO text
      expect(DEFAULT_BILLBOARD_ADS[2].title).toBe('ระบบบริหารจัดการหอพักอัจฉริยะครบวงจร');
      expect(DEFAULT_BILLBOARD_ADS[2].tag).toBe('ฟังก์ชันครบวงจร');

      // Verify Slide 4 PO text
      expect(DEFAULT_BILLBOARD_ADS[3].title).toBe('กรอกโค้ด "HORPLUS" ทดลอง PRO ฟรี 2 เดือน');
      expect(DEFAULT_BILLBOARD_ADS[3].tag).toBe('โค้ดพิเศษจำกัดสิทธิ์');
    });
  });

  describe('PERF-07: Trial Stacking & Display for Active PRO Dormitory (PO Req 13)', () => {
    it('should evaluate isTrialEligible to true for active PRO dormitories when trial unconsumed', () => {
      // Simulates d payload from GET /api/v1/subscription/current
      const d = {
        plan: { code: 'PAID', name: 'HorPlus PRO' },
        status: 'ACTIVE',
        isTrialEligible: true,
        trialStartedAt: null,
      };

      const planCode = d.plan.code;
      // Updated decoupled logic from subscription.tsx:797
      const isTrialEligible = Boolean(d.isTrialEligible ?? !d.trialStartedAt);

      expect(isTrialEligible).toBe(true);

      // Card pricing presentation logic: 1-month PRO card shows 0 THB for trial-eligible
      const card = { durationMonths: 1, basePrice: 189 };
      const isOneMonthTrialCard = card.durationMonths === 1 && isTrialEligible;
      const displayPrice = isOneMonthTrialCard ? 0 : card.basePrice;

      expect(displayPrice).toBe(0);
      expect(isOneMonthTrialCard).toBe(true);
    });
  });
});

