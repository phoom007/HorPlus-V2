import { describe, it, expect, vi } from 'vitest';
import {
  buildTenantApprovalOutcomeFlexMessage,
  LineOaService,
} from '../../services/line-oa.service.js';
import { TenantClaimService } from '../../services/tenant-claim.service.js';

describe('Phase 2: Tenant Multi-Room Claim & LINE OA Notification Suite', () => {
  describe('LINE OA Outcome Flex Message Builder', () => {
    it('builds approved Flex Message with green theme, dorm name, room number, and app button', () => {
      const flex = buildTenantApprovalOutcomeFlexMessage(
        'หอพักสุขสบาย (สุขุมวิท 71)',
        '303',
        true,
        undefined,
        'https://app.horplus.com'
      );

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('ผลการพิจารณาคำขอเช่าห้องพัก 303');
      expect(flex.contents.header.backgroundColor).toBe('#06C755'); // LINE Green
      
      const headerTexts = JSON.stringify(flex.contents.header);
      expect(headerTexts).toContain('หอพักสุขสบาย (สุขุมวิท 71)');
      expect(headerTexts).toContain('อนุมัติคำขอเช่าห้องพักเรียบร้อยแล้ว');

      const bodyTexts = JSON.stringify(flex.contents.body);
      expect(bodyTexts).toContain('ห้อง 303');
      expect(bodyTexts).toContain('อนุมัติแล้ว');

      const footer = flex.contents.footer;
      expect(footer.contents[0].action.uri).toBe('https://app.horplus.com/tenant');
      expect(footer.contents[0].action.label).toBe('เข้าสู่ระบบผู้เช่า');
    });

    it('builds rejected Flex Message with red theme, reason, and support contact info', () => {
      const flex = buildTenantApprovalOutcomeFlexMessage(
        'หอพักสุขสบาย (สุขุมวิท 71)',
        '303',
        false,
        'ห้องพักถูกจองโดยผู้เช่ารายอื่นแล้ว',
        'https://app.horplus.com'
      );

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('ผลการพิจารณาคำขอเช่าห้องพัก 303');
      expect(flex.contents.header.backgroundColor).toBe('#EF4444'); // Red

      const headerTexts = JSON.stringify(flex.contents.header);
      expect(headerTexts).toContain('หอพักสุขสบาย (สุขุมวิท 71)');
      expect(headerTexts).toContain('แจ้งผลการพิจารณาคำขอเช่าห้องพัก');

      const bodyTexts = JSON.stringify(flex.contents.body);
      expect(bodyTexts).toContain('ห้อง 303');
      expect(bodyTexts).toContain('ไม่อนุมัติ');
      expect(bodyTexts).toContain('ห้องพักถูกจองโดยผู้เช่ารายอื่นแล้ว');
    });
  });

  describe('LineOaService.pushOutcomeNotification', () => {
    it('resolves token and pushes message via adapter', async () => {
      const mockAdapter = {
        pushMessage: vi.fn(async () => ({ outcome: 'ACCEPTED' })),
      } as any;

      const mockPrisma = {} as any;
      const service = new LineOaService(mockPrisma, mockAdapter);
      vi.spyOn(service, 'resolveAccessToken').mockResolvedValue('mock-access-token');

      const flexMessage = buildTenantApprovalOutcomeFlexMessage('หอพัก A', '101', true);
      const success = await service.pushOutcomeNotification('dorm-1', 'U1234567890', flexMessage);

      expect(success).toBe(true);
      expect(mockAdapter.pushMessage).toHaveBeenCalledWith(
        'U1234567890',
        flexMessage,
        'mock-access-token',
        expect.any(String)
      );
    });

    it('returns false gracefully if access token cannot be resolved', async () => {
      const mockAdapter = {
        pushMessage: vi.fn(),
      } as any;

      const service = new LineOaService({} as any, mockAdapter);
      vi.spyOn(service, 'resolveAccessToken').mockResolvedValue(null);

      const flexMessage = buildTenantApprovalOutcomeFlexMessage('หอพัก A', '101', true);
      const success = await service.pushOutcomeNotification('dorm-1', 'U1234567890', flexMessage);

      expect(success).toBe(false);
      expect(mockAdapter.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('TenantClaimService with allowAdditionalRoom', () => {
    const validRoomId = '11111111-1111-1111-1111-111111111111';

    it('blocks claim if user already has a linked tenant in dorm and allowAdditionalRoom is false', async () => {
      const mockTx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        room: {
          findFirst: vi.fn().mockResolvedValue({ id: validRoomId, roomNumber: '303', dormitoryId: 'dorm-1' }),
        },
        tenant: {
          findFirst: vi.fn().mockResolvedValue({ id: 'tenant-1', dormitoryId: 'dorm-1', linkedUserId: 'user-1' }),
        },
      };

      const mockPrisma = {
        $transaction: vi.fn(async (callback: any) => callback(mockTx)),
      } as any;

      const service = new TenantClaimService(mockPrisma);

      await expect(
        service.claimTenant(
          {
            dormitoryId: 'dorm-1',
            roomId: validRoomId,
            roomNumber: '303',
            claimInput: '0812345678',
            allowAdditionalRoom: false,
          },
          'user-1'
        )
      ).rejects.toThrow('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
    });

    it('permits multi-room claim if allowAdditionalRoom is true', async () => {
      const candidateTenant = {
        id: 'tenant-2',
        name: 'สมบูรณ์ สุขใจ',
        phone: '0812345678',
        dormitoryId: 'dorm-1',
        roomId: validRoomId,
        linkedUserId: null,
      };

      const mockTx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        room: {
          findFirst: vi.fn().mockResolvedValue({ id: validRoomId, roomNumber: '303', dormitoryId: 'dorm-1' }),
        },
        tenant: {
          findFirst: vi.fn().mockResolvedValue({ id: 'tenant-1', dormitoryId: 'dorm-1', linkedUserId: 'user-1' }),
          findUnique: vi.fn().mockResolvedValue(candidateTenant),
          update: vi.fn().mockResolvedValue({ ...candidateTenant, linkedUserId: 'user-1' }),
        },
        role: {
          findFirst: vi.fn().mockResolvedValue({ id: 'role-tenant', code: 'TENANT', dormitoryId: null }),
        },
        dormitoryMember: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'mem-1',
            status: 'active',
            role: { code: 'TENANT', dormitoryId: 'dorm-1' },
          }),
          update: vi.fn().mockResolvedValue({ id: 'mem-1', status: 'active' }),
          upsert: vi.fn().mockResolvedValue({ id: 'mem-1', role: 'TENANT' }),
        },
      };

      const mockPrisma = {
        $transaction: vi.fn(async (callback: any) => callback(mockTx)),
      } as any;

      const service = new TenantClaimService(mockPrisma);
      // Spy selectAuthoritativeCandidate to return candidateTenant
      vi.spyOn(service, 'selectAuthoritativeCandidate').mockResolvedValue(candidateTenant);

      const result = await service.claimTenant(
        {
          dormitoryId: 'dorm-1',
          roomId: validRoomId,
          roomNumber: '303',
          claimInput: '0812345678',
          allowAdditionalRoom: true,
        },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.tenantId).toBe('tenant-2');
      expect(mockTx.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-2' },
        data: { linkedUserId: 'user-1' },
      });
    });
  });
});
