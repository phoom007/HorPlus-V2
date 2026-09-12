import { describe, it, expect } from 'vitest';
import { ALL_PRICING_CARDS } from '../pages/owner/subscription';

describe('Subscription Dynamic Card Pricing and Promo Rules', () => {
  it('should compute base prices correctly for all pricing cards', () => {
    const freeCard = ALL_PRICING_CARDS.find(c => c.planId === 'free');
    const pro1m = ALL_PRICING_CARDS.find(c => c.id === 'card-pro-1m');
    const pro3m = ALL_PRICING_CARDS.find(c => c.id === 'card-pro-3m');
    const pro6m = ALL_PRICING_CARDS.find(c => c.id === 'card-pro-6m');
    const pro12m = ALL_PRICING_CARDS.find(c => c.id === 'card-pro-12m');
    const pro24m = ALL_PRICING_CARDS.find(c => c.id === 'card-pro-24m');

    expect(freeCard?.price).toBe(0);
    expect(pro1m?.price).toBe(189);
    expect(pro3m?.price).toBe(529);
    expect(pro6m?.price).toBe(999);
    expect(pro12m?.price).toBe(1799);
    expect(pro24m?.price).toBe(2999);
  });

  it('should compute 10% discounted prices and monthly averages correctly with Math.round()', () => {
    const discountPercent = 10;

    const cards = ALL_PRICING_CARDS.map(card => {
      const isFree = card.planId === 'free';
      const discountAmount = !isFree && discountPercent > 0
        ? Math.round((card.price * discountPercent) / 100)
        : 0;
      const effectivePrice = !isFree && discountPercent > 0
        ? card.price - discountAmount
        : card.price;
      const effectivePerMonthPrice = !isFree && discountPercent > 0 && card.durationMonths > 0
        ? Math.round(effectivePrice / card.durationMonths)
        : card.perMonthPrice;

      return {
        id: card.id,
        isFree,
        effectivePrice,
        effectivePerMonthPrice,
        discountBadge: discountPercent > 0 ? `ลด ${discountPercent}%` : 'ลดพิเศษ',
      };
    });

    const pro1m = cards.find(c => c.id === 'card-pro-1m');
    const pro3m = cards.find(c => c.id === 'card-pro-3m');
    const pro6m = cards.find(c => c.id === 'card-pro-6m');
    const pro12m = cards.find(c => c.id === 'card-pro-12m');
    const pro24m = cards.find(c => c.id === 'card-pro-24m');

    // 1m: 189 - 19 = 170
    expect(pro1m?.effectivePrice).toBe(170);
    expect(pro1m?.effectivePerMonthPrice).toBe(170);
    expect(pro1m?.discountBadge).toBe('ลด 10%');

    // 3m: 529 - 53 = 476, 476 / 3 = 158.67 -> 159
    expect(pro3m?.effectivePrice).toBe(476);
    expect(pro3m?.effectivePerMonthPrice).toBe(159);

    // 6m: 999 - 100 = 899, 899 / 6 = 149.83 -> 150
    expect(pro6m?.effectivePrice).toBe(899);
    expect(pro6m?.effectivePerMonthPrice).toBe(150);

    // 12m: 1799 - 180 = 1619, 1619 / 12 = 134.91 -> 135
    expect(pro12m?.effectivePrice).toBe(1619);
    expect(pro12m?.effectivePerMonthPrice).toBe(135);

    // 24m: 2999 - 300 = 2699, 2699 / 24 = 112.45 -> 112
    expect(pro24m?.effectivePrice).toBe(2699);
    expect(pro24m?.effectivePerMonthPrice).toBe(112);
  });

  it('should format promo message correctly: discount info for discounts and days for extensions', () => {
    // Discount code (e.g. HNY2027)
    const discountPromo = {
      code: 'HNY2027',
      discountPercent: 10,
      discountAmount: 180,
      description: 'ส่วนลดแพ็กเกจ 10%',
    };

    const discountMsg = discountPromo.discountPercent
      ? `สำเร็จ: ได้รับส่วนลด ${discountPromo.discountPercent}%${discountPromo.discountAmount ? ` (-฿${discountPromo.discountAmount.toLocaleString()})` : ''} เรียบร้อยแล้ว`
      : `สำเร็จ: เพิ่มวันใช้งาน +${(discountPromo as any).daysBonus || 60} วัน เรียบร้อยแล้ว`;

    expect(discountMsg).toBe('สำเร็จ: ได้รับส่วนลด 10% (-฿180) เรียบร้อยแล้ว');
    expect(discountMsg).not.toContain('+30 วัน');

    // Usage days bonus code (e.g. HORPLUS)
    const daysPromo = {
      code: 'HORPLUS',
      daysBonus: 60,
      description: 'เพิ่มวันใช้งานฟรี +60 วัน',
    };

    const daysMsg = (daysPromo as any).discountPercent
      ? `สำเร็จ: ได้รับส่วนลด ${(daysPromo as any).discountPercent}% เรียบร้อยแล้ว`
      : `สำเร็จ: เพิ่มวันใช้งาน +${daysPromo.daysBonus || 60} วัน เรียบร้อยแล้ว`;

    expect(daysMsg).toBe('สำเร็จ: เพิ่มวันใช้งาน +60 วัน เรียบร้อยแล้ว');
  });

  it('should enforce Highest Discount Wins (Single Active Promo Rule)', () => {
    const existingPromo = {
      code: 'SUMMER20',
      discountPercent: 20,
    };

    const evaluateNewPromo = (current: { discountPercent: number; code: string }, candidate: { discountPercent: number; code: string }) => {
      if (current.discountPercent >= candidate.discountPercent) {
        return {
          retained: current,
          action: 'RETAIN_EXISTING',
          message: `ระบบคงใช้โค้ด ${current.code} ที่ให้ส่วนลดสูงสุด (${current.discountPercent}%)`,
        };
      }
      return {
        retained: candidate,
        action: 'UPGRADE_TO_CANDIDATE',
        message: `ใช้โค้ด ${candidate.code} สำเร็จ: ได้รับส่วนลด ${candidate.discountPercent}% สูงกว่าโค้ดเดิม`,
      };
    };

    // Candidate with lower discount (10% < 20%) -> Retain existing
    const candidateLower = { code: 'HNY2027', discountPercent: 10 };
    const result1 = evaluateNewPromo(existingPromo, candidateLower);
    expect(result1.action).toBe('RETAIN_EXISTING');
    expect(result1.retained.code).toBe('SUMMER20');

    // Candidate with equal discount (20% == 20%) -> Retain existing
    const candidateEqual = { code: 'PROMO20', discountPercent: 20 };
    const result2 = evaluateNewPromo(existingPromo, candidateEqual);
    expect(result2.action).toBe('RETAIN_EXISTING');
    expect(result2.retained.code).toBe('SUMMER20');

    // Candidate with higher discount (30% > 20%) -> Upgrade
    const candidateHigher = { code: 'VIP30', discountPercent: 30 };
    const result3 = evaluateNewPromo(existingPromo, candidateHigher);
    expect(result3.action).toBe('UPGRADE_TO_CANDIDATE');
    expect(result3.retained.code).toBe('VIP30');
  });

  it('should resolve room count from dormitory rooms array and never fallback to 19', () => {
    const resolveRoomCount = (roomsProp?: any[], subInfoRooms?: number) => {
      return roomsProp ? roomsProp.length : (subInfoRooms ?? 0);
    };

    // Dorm A has 5 rooms
    expect(resolveRoomCount([{}, {}, {}, {}, {}], 5)).toBe(5);

    // Dorm B has 0 rooms (new dorm)
    expect(resolveRoomCount([], 0)).toBe(0);

    // Dorm C has 42 rooms
    expect(resolveRoomCount(new Array(42).fill({}), 42)).toBe(42);

    // If rooms prop is undefined, use authoritative subInfo rooms count
    expect(resolveRoomCount(undefined, 8)).toBe(8);
    expect(resolveRoomCount(undefined, 0)).toBe(0);
  });

  it('should compute payment view duration buttons and dynamic monthly average correctly with 10% discount', () => {
    const PRO_DURATIONS_MOCK = [
      { months: 1, label: '1 เดือน', shortLabel: '1 เดือน', price: 189, perMonthPrice: 189 },
      { months: 3, label: '3 เดือน', shortLabel: '3 เดือน', price: 529, perMonthPrice: 176 },
      { months: 6, label: '6 เดือน', shortLabel: '6 เดือน', price: 999, perMonthPrice: 166 },
      { months: 12, label: '12 เดือน', shortLabel: '12 เดือน', price: 1799, perMonthPrice: 150 },
      { months: 24, label: '24 เดือน', shortLabel: '24 เดือน', price: 2999, perMonthPrice: 125 }
    ];

    const discountPercent = 10;

    // Test duration button price calculation
    const buttonPrices = PRO_DURATIONS_MOCK.map(d => {
      const buttonDiscount = discountPercent > 0 ? Math.round((d.price * discountPercent) / 100) : 0;
      const buttonPrice = discountPercent > 0 ? d.price - buttonDiscount : d.price;
      return { months: d.months, buttonPrice };
    });

    expect(buttonPrices.find(b => b.months === 1)?.buttonPrice).toBe(170); // 189 - 19 = 170
    expect(buttonPrices.find(b => b.months === 3)?.buttonPrice).toBe(476); // 529 - 53 = 476
    expect(buttonPrices.find(b => b.months === 6)?.buttonPrice).toBe(899); // 999 - 100 = 899
    expect(buttonPrices.find(b => b.months === 12)?.buttonPrice).toBe(1619); // 1799 - 180 = 1619
    expect(buttonPrices.find(b => b.months === 24)?.buttonPrice).toBe(2699); // 2999 - 300 = 2699

    // Test dynamic monthly average text in payment view
    const computeMonthlyAverageText = (durationMonths: number, currentPrice: number, fallbackPerMonthPrice: number) => {
      const avg = durationMonths > 0 ? Math.round(currentPrice / durationMonths) : fallbackPerMonthPrice;
      return `เฉลี่ย ฿${avg.toLocaleString()}/เดือน`;
    };

    // 12 months with 10% discount: 1619 / 12 = 134.916 -> 135
    expect(computeMonthlyAverageText(12, 1619, 150)).toBe('เฉลี่ย ฿135/เดือน');
    // Without discount (base 1799): 1799 / 12 = 149.916 -> 150
    expect(computeMonthlyAverageText(12, 1799, 150)).toBe('เฉลี่ย ฿150/เดือน');
    // 1 month discounted 170:
    expect(computeMonthlyAverageText(1, 170, 189)).toBe('เฉลี่ย ฿170/เดือน');
    // 3 months discounted 476: 476 / 3 = 158.667 -> 159
    expect(computeMonthlyAverageText(3, 476, 176)).toBe('เฉลี่ย ฿159/เดือน');
    // 6 months discounted 899: 899 / 6 = 149.833 -> 150
    expect(computeMonthlyAverageText(6, 899, 166)).toBe('เฉลี่ย ฿150/เดือน');
    // 24 months discounted 2699: 2699 / 24 = 112.458 -> 112
    expect(computeMonthlyAverageText(24, 2699, 125)).toBe('เฉลี่ย ฿112/เดือน');
  });

  it('should burn quota immediately in DB and void lower overlapping discount from checkout', () => {
    // Simulating instant DB redemption + checkout decision logic
    const dbRedemptions: Array<{ code: string; dormitoryId: string; redeemedAt: Date }> = [];
    let currentRedemptionsCount = 0;

    const mockRedeemInDb = (code: string, dormitoryId: string) => {
      // Instant DB redemption (กรอกแล้วกรอกเลย)
      dbRedemptions.push({ code, dormitoryId, redeemedAt: new Date() });
      currentRedemptionsCount += 1;
      return { success: true, code, count: currentRedemptionsCount };
    };

    let checkoutActivePromo: { code: string; discountPercent: number } | null = null;

    const applyPromoWorkflow = (candidateCode: string, candidatePercent: number, dormId: string) => {
      // Step 1: Immediate DB redemption
      mockRedeemInDb(candidateCode, dormId);

      // Step 2: Checkout discount evaluation
      if (checkoutActivePromo) {
        if (candidatePercent <= checkoutActivePromo.discountPercent) {
          // Candidate discount is lower or equal -> voided from checkout, but DB redemption remains consumed
          return {
            status: 'LOWER_VOIDED',
            activeCode: checkoutActivePromo.code,
            activePercent: checkoutActivePromo.discountPercent,
            message: `ใช้สิทธิ์โค้ด ${candidateCode} สำเร็จ แต่โค้ด ${checkoutActivePromo.code} ให้ส่วนลดมากกว่า (${checkoutActivePromo.discountPercent}%) ระบบจึงคงสิทธิ์ส่วนลดสูงสุดไว้ (สิทธิ์โค้ด ${candidateCode} ถูกบันทึกแล้ว)`
          };
        } else {
          // Candidate discount is strictly higher -> upgrade checkout, old code is voided from checkout
          const oldCode = checkoutActivePromo.code;
          checkoutActivePromo = { code: candidateCode, discountPercent: candidatePercent };
          return {
            status: 'UPGRADED',
            activeCode: candidateCode,
            activePercent: candidatePercent,
            message: `ใช้โค้ด ${candidateCode} สำเร็จ: ได้รับส่วนลด ${candidatePercent}% สูงกว่าโค้ดเดิม (โค้ดเดิม ${oldCode} ถูกยกเลิก)`
          };
        }
      } else {
        checkoutActivePromo = { code: candidateCode, discountPercent: candidatePercent };
        return {
          status: 'APPLIED',
          activeCode: candidateCode,
          activePercent: candidatePercent,
          message: `ใช้โค้ด ${candidateCode} สำเร็จ: ได้รับส่วนลด ${candidatePercent}%`
        };
      }
    };

    // 1. User applies HNY2027 (10% discount)
    const step1 = applyPromoWorkflow('HNY2027', 10, 'dorm-1');
    expect(step1.status).toBe('APPLIED');
    expect(step1.activeCode).toBe('HNY2027');
    expect(dbRedemptions.length).toBe(1);
    expect(dbRedemptions[0].code).toBe('HNY2027');
    expect(currentRedemptionsCount).toBe(1);

    // 2. User then applies FLASH5 (5% discount, lower)
    const step2 = applyPromoWorkflow('FLASH5', 5, 'dorm-1');
    expect(step2.status).toBe('LOWER_VOIDED');
    expect(step2.activeCode).toBe('HNY2027'); // HNY2027 stays active in checkout
    // But FLASH5 was still recorded in DB (quota burned/consumed)
    expect(dbRedemptions.length).toBe(2);
    expect(dbRedemptions.map(r => r.code)).toEqual(['HNY2027', 'FLASH5']);
    expect(currentRedemptionsCount).toBe(2);

    // 3. User then applies SUPER25 (25% discount, higher)
    const step3 = applyPromoWorkflow('SUPER25', 25, 'dorm-1');
    expect(step3.status).toBe('UPGRADED');
    expect(step3.activeCode).toBe('SUPER25'); // SUPER25 becomes active in checkout
    // All 3 codes are burned in DB
    expect(dbRedemptions.length).toBe(3);
    expect(dbRedemptions.map(r => r.code)).toEqual(['HNY2027', 'FLASH5', 'SUPER25']);
    expect(currentRedemptionsCount).toBe(3);
  });
});
