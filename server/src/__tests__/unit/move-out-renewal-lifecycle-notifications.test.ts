import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildOwnerMoveOutRequestFlexMessage,
  buildOwnerRenewalRequestFlexMessage,
  buildTenantRenewalOutcomeFlexMessage,
} from '../../services/line-oa.service.js';

describe('Move-Out & Contract Renewal Lifecycle Notifications Test Suite', () => {
  describe('Flex Message Builders for Move-Out and Renewal', () => {
    it('builds owner move-out request flex message without emojis and with proper values', () => {
      const msg = buildOwnerMoveOutRequestFlexMessage(
        'หอพักแสนสุข',
        'นาย สมชาย ใจดี',
        '101',
        '2026-10-31',
        'https://app.horplus.com'
      );

      expect(msg.type).toBe('flex');
      expect(msg.altText).toContain('101');
      expect(msg.altText).toContain('หอพักแสนสุข');
      expect(msg.contents.header.contents[1].text).toBe('คำขอแจ้งย้ายออกใหม่');
      // Verify zero unicode emojis in json
      const json = JSON.stringify(msg);
      expect(/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(json)).toBe(false);
    });

    it('builds owner renewal request flex message with lease duration and start date', () => {
      const msg = buildOwnerRenewalRequestFlexMessage(
        'หอพักแสนสุข',
        'นาย สมชาย ใจดี',
        '102',
        6,
        '2026-11-01',
        'https://app.horplus.com'
      );

      expect(msg.type).toBe('flex');
      expect(msg.altText).toContain('102');
      expect(msg.contents.header.contents[1].text).toBe('คำขอต่อสัญญาเช่าใหม่');
      const json = JSON.stringify(msg);
      expect(/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(json)).toBe(false);
    });

    it('builds tenant renewal approved outcome flex message', () => {
      const msg = buildTenantRenewalOutcomeFlexMessage(
        'หอพักแสนสุข',
        '103',
        true,
        undefined,
        'https://app.horplus.com'
      );

      expect(msg.type).toBe('flex');
      expect(msg.altText).toContain('103');
      expect(msg.contents.header.contents[1].text).toBe('อนุมัติการต่อสัญญาเช่าเรียบร้อยแล้ว');
      const json = JSON.stringify(msg);
      expect(/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(json)).toBe(false);
    });

    it('builds tenant renewal rejected outcome flex message with reason', () => {
      const msg = buildTenantRenewalOutcomeFlexMessage(
        'หอพักแสนสุข',
        '104',
        false,
        'ห้องพักมีกำหนดปรับปรุงระบบไฟฟ้า',
        'https://app.horplus.com'
      );

      expect(msg.type).toBe('flex');
      expect(msg.altText).toContain('104');
      expect(msg.contents.header.contents[1].text).toBe('แจ้งผลการพิจารณาคำขอต่อสัญญาเช่า');
      const json = JSON.stringify(msg);
      expect(json).toContain('ห้องพักมีกำหนดปรับปรุงระบบไฟฟ้า');
      expect(/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(json)).toBe(false);
    });
  });
});
