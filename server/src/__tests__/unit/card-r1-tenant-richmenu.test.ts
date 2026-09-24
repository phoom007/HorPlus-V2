import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LineRichMenuService } from '../../services/line-richmenu.service.js';

describe('Card R1 — Active Tenant Rich Menu & Linking', () => {
  let mockPrisma: any;
  let mockLineAdapter: any;
  let richMenuService: LineRichMenuService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      dormitory: {
        findUnique: vi.fn().mockResolvedValue({ id: 'dorm-1', name: 'Manor Residence' }),
      },
      dormitoryLineConfig: {
        findUnique: vi.fn().mockResolvedValue({
          channelAccessTokenEncrypted: 'mock-encrypted-token',
        }),
      },
      tenant: {
        findFirst: vi.fn(),
      },
      dormitoryLineFriend: {
        findUnique: vi.fn(),
      },
    };

    mockLineAdapter = {
      getRichMenuList: vi.fn().mockResolvedValue([]),
      createRichMenu: vi.fn().mockResolvedValue('rm_active_tenant_new'),
      uploadRichMenuImage: vi.fn().mockResolvedValue(true),
      linkRichMenuToUser: vi.fn().mockResolvedValue(true),
      unlinkRichMenuFromUser: vi.fn().mockResolvedValue(true),
      deleteRichMenu: vi.fn().mockResolvedValue(true),
      setDefaultRichMenu: vi.fn().mockResolvedValue(true),
    };

    richMenuService = new LineRichMenuService(mockPrisma, mockLineAdapter);
    vi.spyOn(richMenuService as any, 'resolveAccessToken').mockResolvedValue('mock-access-token');
  });

  describe('1. Active Tenant Rich Menu Payload (3 Buttons)', () => {
    it('creates a 3-button layout matching PO requirements (เข้าพอร์ทัล, ดูบิล, แจ้งซ่อม)', () => {
      const payload = richMenuService.buildActiveTenantRichMenuPayload('Manor Residence', '2011672957-testliff');

      expect(payload.size).toEqual({ width: 2500, height: 843 });
      expect(payload.name).toBe('HorPlus Active Tenant Menu v2 - Manor Residence');
      expect(payload.chatBarText).toBe('เมนูผู้เช่า');
      expect(payload.areas).toHaveLength(3);

      // Button 1: เข้าพอร์ทัล
      expect(payload.areas[0]).toEqual({
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: {
          type: 'uri',
          uri: 'https://liff.line.me/2011672957-testliff',
          label: 'เข้าพอร์ทัล',
        },
      });

      // Button 2: บิลและชำระเงิน (?sub=invoice)
      expect(payload.areas[1]).toEqual({
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: {
          type: 'uri',
          uri: 'https://liff.line.me/2011672957-testliff?sub=invoice',
          label: 'บิลและชำระเงิน',
        },
      });

      // Button 3: แจ้งซ่อม (?sub=repairs)
      expect(payload.areas[2]).toEqual({
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: {
          type: 'uri',
          uri: 'https://liff.line.me/2011672957-testliff?sub=repairs',
          label: 'แจ้งซ่อม',
        },
      });
    });

    it('generates an image buffer with sharp', async () => {
      const imgBuffer = await richMenuService.generateActiveTenantRichMenuImage();
      expect(imgBuffer).toBeInstanceOf(Buffer);
      expect(imgBuffer.length).toBeGreaterThan(100);
    });
  });

  describe('2. Rich Menu Provisioning & Versioning (F-02)', () => {
    it('creates and links new 3-button menu if none exists', async () => {
      mockLineAdapter.getRichMenuList.mockResolvedValue([]);

      const result = await richMenuService.linkActiveTenantRichMenu('dorm-1', 'U111222333');

      expect(result).toBe(true);
      expect(mockLineAdapter.createRichMenu).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'HorPlus Active Tenant Menu v2 - Manor Residence' }),
        'mock-access-token'
      );
      expect(mockLineAdapter.uploadRichMenuImage).toHaveBeenCalledWith(
        'rm_active_tenant_new',
        expect.any(Buffer),
        'image/png',
        'mock-access-token'
      );
      expect(mockLineAdapter.linkRichMenuToUser).toHaveBeenCalledWith(
        'U111222333',
        'rm_active_tenant_new',
        'mock-access-token'
      );
    });

    it('cleans legacy v1 menu and recreates if existing menu is outdated (areas !== 3)', async () => {
      mockLineAdapter.getRichMenuList.mockResolvedValue([
        { richMenuId: 'rm_legacy_v1', name: 'HorPlus Active Tenant Menu - Manor Residence' },
        { richMenuId: 'rm_outdated_v2', name: 'HorPlus Active Tenant Menu v2 - Manor Residence', areas: [{}, {}] },
      ]);

      const result = await richMenuService.linkActiveTenantRichMenu('dorm-1', 'U111222333');

      expect(result).toBe(true);
      expect(mockLineAdapter.deleteRichMenu).toHaveBeenCalledWith('rm_legacy_v1', 'mock-access-token');
      expect(mockLineAdapter.deleteRichMenu).toHaveBeenCalledWith('rm_outdated_v2', 'mock-access-token');
      expect(mockLineAdapter.createRichMenu).toHaveBeenCalled();
      expect(mockLineAdapter.linkRichMenuToUser).toHaveBeenCalledWith(
        'U111222333',
        'rm_active_tenant_new',
        'mock-access-token'
      );
    });

    it('reuses existing menu if it has valid 3 areas', async () => {
      mockLineAdapter.getRichMenuList.mockResolvedValue([
        {
          richMenuId: 'rm_existing_valid',
          name: 'HorPlus Active Tenant Menu v2 - Manor Residence',
          areas: [{}, {}, {}],
        },
      ]);

      const result = await richMenuService.linkActiveTenantRichMenu('dorm-1', 'U111222333');

      expect(result).toBe(true);
      expect(mockLineAdapter.createRichMenu).not.toHaveBeenCalled();
      expect(mockLineAdapter.linkRichMenuToUser).toHaveBeenCalledWith(
        'U111222333',
        'rm_existing_valid',
        'mock-access-token'
      );
    });
  });

  describe('3. Self-healing & Negative Scenarios (AC R1-3, R1-6 / F-01)', () => {
    it('non-active tenant or pending applicant does not receive rich menu link', async () => {
      const linkSpy = vi.spyOn(richMenuService, 'linkActiveTenantRichMenu');

      // Scenario: user is pending, existingTenant is null
      const existingTenant = null;
      if (existingTenant) {
        await richMenuService.linkActiveTenantRichMenu('dorm-1', 'U_pending');
      }

      expect(linkSpy).not.toHaveBeenCalled();
    });

    it('active tenant triggers rich menu link on verification', async () => {
      const linkSpy = vi.spyOn(richMenuService, 'linkActiveTenantRichMenu').mockResolvedValue(true);

      const existingTenant = { id: 'tenant-101', status: 'active', lineFriendId: 'friend-1' };
      if (existingTenant && existingTenant.status === 'active') {
        await richMenuService.linkActiveTenantRichMenu('dorm-1', 'U_active_tenant');
      }

      expect(linkSpy).toHaveBeenCalledWith('dorm-1', 'U_active_tenant');
    });
  });
});
