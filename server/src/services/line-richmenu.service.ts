/**
 * LINE Rich Menu & Auto-Authentication Direct Access Service
 * Supports 2-button Tenant Menu (Default) & 3-button Owner Menu (Personalized)
 * High-performance SVG to PNG generation via sharp
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import crypto from 'crypto';
import { LinePlatformAdapter, HttpLinePlatformAdapter } from './line-platform-adapter.js';
import { ILineChannelTokenProvider, LineChannelTokenProvider, FakeLineTokenProvider } from './line-channel-token-provider.js';
import { decryptText } from '../utils/crypto-encryption.js';

export interface DirectEntryTicket {
  ticket: string;
  dormitoryId: string;
  lineUserId: string;
  roleCode: string;
  grantId?: string;
  userId?: string;
  expiresAt: number;
}

const DIRECT_ENTRY_TICKETS = new Map<string, DirectEntryTicket>();
const DORM_RICH_MENUS_CACHE = new Map<string, { ownerMenuId: string; tenantMenuId: string }>();

export class LineRichMenuService {
  constructor(
    private prisma: PrismaClient,
    private lineAdapter: LinePlatformAdapter = new HttpLinePlatformAdapter(),
    private tokenProvider: ILineChannelTokenProvider = (process.env.NODE_ENV === 'test' && process.env.HORPLUS_E2E !== 'true')
      ? new FakeLineTokenProvider()
      : new LineChannelTokenProvider()
  ) {}

  /**
   * Resolve Channel Access Token for a dormitory
   */
  private async resolveAccessToken(dormitoryId: string): Promise<string | null> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      const config = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId },
        select: {
          channelId: true,
          channelSecretEncrypted: true,
          channelAccessTokenEncrypted: true,
        },
      });
      if (!config) return null;

      if (config.channelAccessTokenEncrypted) {
        try {
          return decryptText(config.channelAccessTokenEncrypted);
        } catch {}
      }

      if (config.channelId && config.channelSecretEncrypted && this.tokenProvider) {
        try {
          const secret = decryptText(config.channelSecretEncrypted);
          return await this.tokenProvider.getChannelAccessToken(config.channelId, secret);
        } catch {
          return null;
        }
      }

      return null;
    });
  }

  /**
   * Generate 2500x843 PNG image for Owner Rich Menu (3 buttons)
   * 1. จัดการหอพัก (0 - 833)
   * 2. ลงทะเบียนผู้เช่า (833 - 1667)
   * 3. วิธีการใช้งาน (1667 - 2500)
   */
  async generateOwnerRichMenuImage(): Promise<Buffer> {
    const svg = `
      <svg width="2500" height="843" viewBox="0 0 2500 843" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#4F46E5"/>
            <stop offset="100%" stop-color="#3730A3"/>
          </linearGradient>
          <linearGradient id="bg2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#059669"/>
            <stop offset="100%" stop-color="#047857"/>
          </linearGradient>
          <linearGradient id="bg3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0284C7"/>
            <stop offset="100%" stop-color="#0369A1"/>
          </linearGradient>
        </defs>

        <!-- Button 1: จัดการหอพัก -->
        <rect x="0" y="0" width="833" height="843" fill="url(#bg1)"/>
        <circle cx="416" cy="300" r="110" fill="#FFFFFF" opacity="0.15"/>
        <text x="416" y="340" font-family="sans-serif" font-size="110" font-weight="900" fill="#FFFFFF" text-anchor="middle">🏢</text>
        <text x="416" y="550" font-family="sans-serif" font-size="82" font-weight="bold" fill="#FFFFFF" text-anchor="middle">จัดการหอพัก</text>
        <text x="416" y="640" font-family="sans-serif" font-size="44" fill="#C7D2FE" text-anchor="middle">เข้าสู่ระบบ Dashboard</text>

        <!-- Divider 1 -->
        <line x1="833" y1="60" x2="833" y2="783" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="4"/>

        <!-- Button 2: ลงทะเบียนผู้เช่า -->
        <rect x="833" y="0" width="834" height="843" fill="url(#bg2)"/>
        <circle cx="1250" cy="300" r="110" fill="#FFFFFF" opacity="0.15"/>
        <text x="1250" y="340" font-family="sans-serif" font-size="110" font-weight="900" fill="#FFFFFF" text-anchor="middle">📝</text>
        <text x="1250" y="550" font-family="sans-serif" font-size="82" font-weight="bold" fill="#FFFFFF" text-anchor="middle">ลงทะเบียนผู้เช่า</text>
        <text x="1250" y="640" font-family="sans-serif" font-size="44" fill="#A7F3D0" text-anchor="middle">ลงทะเบียน / จองห้องพัก</text>

        <!-- Divider 2 -->
        <line x1="1667" y1="60" x2="1667" y2="783" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="4"/>

        <!-- Button 3: วิธีการใช้งาน -->
        <rect x="1667" y="0" width="833" height="843" fill="url(#bg3)"/>
        <circle cx="2083" cy="300" r="110" fill="#FFFFFF" opacity="0.15"/>
        <text x="2083" y="340" font-family="sans-serif" font-size="110" font-weight="900" fill="#FFFFFF" text-anchor="middle">📖</text>
        <text x="2083" y="550" font-family="sans-serif" font-size="82" font-weight="bold" fill="#FFFFFF" text-anchor="middle">วิธีการใช้งาน</text>
        <text x="2083" y="640" font-family="sans-serif" font-size="44" fill="#BAE6FD" text-anchor="middle">คู่มือแนะนำฟีเจอร์</text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Generate 2500x843 PNG image for Tenant Rich Menu (2 buttons)
   * 1. ลงทะเบียนผู้เช่า (0 - 1250)
   * 2. วิธีการใช้งาน (1250 - 2500)
   */
  async generateTenantRichMenuImage(): Promise<Buffer> {
    const svg = `
      <svg width="2500" height="843" viewBox="0 0 2500 843" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="tbg1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#059669"/>
            <stop offset="100%" stop-color="#047857"/>
          </linearGradient>
          <linearGradient id="tbg2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0284C7"/>
            <stop offset="100%" stop-color="#0369A1"/>
          </linearGradient>
        </defs>

        <!-- Button 1: ลงทะเบียนผู้เช่า -->
        <rect x="0" y="0" width="1250" height="843" fill="url(#tbg1)"/>
        <circle cx="625" cy="300" r="120" fill="#FFFFFF" opacity="0.15"/>
        <text x="625" y="345" font-family="sans-serif" font-size="120" font-weight="900" fill="#FFFFFF" text-anchor="middle">📝</text>
        <text x="625" y="550" font-family="sans-serif" font-size="92" font-weight="bold" fill="#FFFFFF" text-anchor="middle">ลงทะเบียนผู้เช่า</text>
        <text x="625" y="645" font-family="sans-serif" font-size="48" fill="#A7F3D0" text-anchor="middle">เลือกห้องและส่งคำขอเช่าพัก</text>

        <!-- Divider -->
        <line x1="1250" y1="60" x2="1250" y2="783" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="5"/>

        <!-- Button 2: วิธีการใช้งาน -->
        <rect x="1250" y="0" width="1250" height="843" fill="url(#tbg2)"/>
        <circle cx="1875" cy="300" r="120" fill="#FFFFFF" opacity="0.15"/>
        <text x="1875" y="345" font-family="sans-serif" font-size="120" font-weight="900" fill="#FFFFFF" text-anchor="middle">📖</text>
        <text x="1875" y="550" font-family="sans-serif" font-size="92" font-weight="bold" fill="#FFFFFF" text-anchor="middle">วิธีการใช้งาน</text>
        <text x="1875" y="645" font-family="sans-serif" font-size="48" fill="#BAE6FD" text-anchor="middle">คู่มือแนะนำสำหรับผู้เช่า</text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Build Owner Rich Menu Payload (3 Buttons)
   */
  buildOwnerRichMenuPayload(dormitoryName: string) {
    return {
      size: { width: 2500, height: 843 },
      selected: true,
      name: `HorPlus Owner Menu - ${dormitoryName}`,
      chatBarText: 'เมนูจัดการหอพัก',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 833, height: 843 },
          action: {
            type: 'postback',
            data: 'action=manage_dormitory',
            displayText: 'จัดการหอพัก',
          },
        },
        {
          bounds: { x: 833, y: 0, width: 834, height: 843 },
          action: {
            type: 'postback',
            data: 'action=tenant_register',
            displayText: 'ลงทะเบียนผู้เช่า',
          },
        },
        {
          bounds: { x: 1667, y: 0, width: 833, height: 843 },
          action: {
            type: 'postback',
            data: 'action=owner_user_guide',
            displayText: 'วิธีการใช้งาน',
          },
        },
      ],
    };
  }

  /**
   * Generate 2500x843 PNG image for Active Tenant Rich Menu (2 buttons)
   * 1. เข้าสู่ระบบผู้เช่า (0 - 1250)
   * 2. วิธีการใช้งาน (1250 - 2500)
   */
  async generateActiveTenantRichMenuImage(): Promise<Buffer> {
    const svg = `
      <svg width="2500" height="843" viewBox="0 0 2500 843" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="atbg1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#4F46E5"/>
            <stop offset="100%" stop-color="#3730A3"/>
          </linearGradient>
          <linearGradient id="atbg2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0284C7"/>
            <stop offset="100%" stop-color="#0369A1"/>
          </linearGradient>
        </defs>

        <!-- Button 1: เข้าสู่ระบบผู้เช่า -->
        <rect x="0" y="0" width="1250" height="843" fill="url(#atbg1)"/>
        <circle cx="625" cy="300" r="120" fill="#FFFFFF" opacity="0.15"/>
        <text x="625" y="345" font-family="sans-serif" font-size="120" font-weight="900" fill="#FFFFFF" text-anchor="middle">🔑</text>
        <text x="625" y="550" font-family="sans-serif" font-size="92" font-weight="bold" fill="#FFFFFF" text-anchor="middle">เข้าสู่ระบบผู้เช่า</text>
        <text x="625" y="645" font-family="sans-serif" font-size="48" fill="#C7D2FE" text-anchor="middle">ตรวจสอบห้องพัก สัญญา และบิล</text>

        <!-- Divider -->
        <line x1="1250" y1="60" x2="1250" y2="783" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="5"/>

        <!-- Button 2: วิธีการใช้งาน -->
        <rect x="1250" y="0" width="1250" height="843" fill="url(#atbg2)"/>
        <circle cx="1875" cy="300" r="120" fill="#FFFFFF" opacity="0.15"/>
        <text x="1875" y="345" font-family="sans-serif" font-size="120" font-weight="900" fill="#FFFFFF" text-anchor="middle">📖</text>
        <text x="1875" y="550" font-family="sans-serif" font-size="92" font-weight="bold" fill="#FFFFFF" text-anchor="middle">วิธีการใช้งาน</text>
        <text x="1875" y="645" font-family="sans-serif" font-size="48" fill="#BAE6FD" text-anchor="middle">คู่มือแนะนำสำหรับผู้เช่า</text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Build Active Tenant Rich Menu Payload (2 Buttons)
   */
  buildActiveTenantRichMenuPayload(dormitoryName: string, liffId?: string) {
    const tenantLiffId = liffId || process.env.LINE_TENANT_LIFF_ID || process.env.VITE_LINE_TENANT_LIFF_ID || process.env.VITE_LINE_LIFF_ID || process.env.LINE_LIFF_ID || '2011672957-pIlWUt9e';
    return {
      size: { width: 2500, height: 843 },
      selected: true,
      name: `HorPlus Active Tenant Menu - ${dormitoryName}`,
      chatBarText: 'เมนูผู้เช่าห้องพัก',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: {
            type: 'uri',
            uri: `https://liff.line.me/${tenantLiffId.trim()}`,
            label: 'เข้าสู่ระบบผู้เช่า',
          },
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: {
            type: 'postback',
            data: 'action=tenant_user_guide',
            displayText: 'วิธีการใช้งาน',
          },
        },
      ],
    };
  }

  /**
   * Build Tenant Rich Menu Payload (2 Buttons)
   */
  buildTenantRichMenuPayload(dormitoryName: string) {
    return {
      size: { width: 2500, height: 843 },
      selected: true,
      name: `HorPlus Tenant Menu - ${dormitoryName}`,
      chatBarText: 'เมนูผู้เช่า',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: {
            type: 'postback',
            data: 'action=tenant_register',
            displayText: 'ลงทะเบียนผู้เช่า',
          },
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: {
            type: 'postback',
            data: 'action=tenant_user_guide',
            displayText: 'วิธีการใช้งาน',
          },
        },
      ],
    };
  }

  /**
   * Provision or sync Rich Menus on LINE Official Account for a dormitory
   */
  async syncDormitoryRichMenus(dormitoryId: string, forceRefresh: boolean = false): Promise<{
    ownerMenuId: string | null;
    tenantMenuId: string | null;
  }> {
    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) {
      return { ownerMenuId: null, tenantMenuId: null };
    }

    const dorm = await this.prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { name: true },
    });
    const dormName = dorm?.name || 'HorPlus';

    const ownerMenuName = `HorPlus Owner Menu - ${dormName}`;
    const tenantMenuName = `HorPlus Tenant Menu - ${dormName}`;

    let ownerMenuId: string | null = null;
    let tenantMenuId: string | null = null;

    if (forceRefresh) {
      try {
        const existingMenus = await this.lineAdapter.getRichMenuList(accessToken);
        if (Array.isArray(existingMenus)) {
          for (const m of existingMenus) {
            if (m.richMenuId) {
              await this.lineAdapter.deleteRichMenu(m.richMenuId, accessToken).catch(() => {});
            }
          }
        }
      } catch (delErr: any) {
        console.warn('Failed to clean existing rich menus during forceRefresh:', delErr.message);
      }
      DORM_RICH_MENUS_CACHE.delete(dormitoryId);
    } else {
      // Check if rich menus already exist on LINE Platform
      try {
        const existingMenus = await this.lineAdapter.getRichMenuList(accessToken);
        if (Array.isArray(existingMenus)) {
          const foundOwner = existingMenus.find((m: any) => m.name === ownerMenuName);
          if (foundOwner?.richMenuId) {
            ownerMenuId = foundOwner.richMenuId;
          }
          const foundTenant = existingMenus.find((m: any) => m.name === tenantMenuName);
          if (foundTenant?.richMenuId) {
            tenantMenuId = foundTenant.richMenuId;
          }
        }
      } catch (listErr: any) {
        console.warn('Failed to query existing rich menus from LINE:', listErr.message);
      }
    }

    // 1. Create and upload Tenant Rich Menu (Default) if not found
    if (!tenantMenuId) {
      const tenantPayload = this.buildTenantRichMenuPayload(dormName);
      tenantMenuId = await this.lineAdapter.createRichMenu(tenantPayload, accessToken);
      if (tenantMenuId) {
        const tenantImage = await this.generateTenantRichMenuImage();
        await this.lineAdapter.uploadRichMenuImage(tenantMenuId, tenantImage, 'image/png', accessToken);
      }
    }

    if (tenantMenuId) {
      await this.lineAdapter.setDefaultRichMenu(tenantMenuId, accessToken);
    }

    // 2. Create and upload Owner Rich Menu if not found
    if (!ownerMenuId) {
      const ownerPayload = this.buildOwnerRichMenuPayload(dormName);
      ownerMenuId = await this.lineAdapter.createRichMenu(ownerPayload, accessToken);
      if (ownerMenuId) {
        const ownerImage = await this.generateOwnerRichMenuImage();
        await this.lineAdapter.uploadRichMenuImage(ownerMenuId, ownerImage, 'image/png', accessToken);
      }
    }

    if (ownerMenuId && tenantMenuId) {
      DORM_RICH_MENUS_CACHE.set(dormitoryId, { ownerMenuId, tenantMenuId });
    }

    return { ownerMenuId, tenantMenuId };
  }

  /**
   * Link the Owner Rich Menu to a specific LINE user
   */
  async linkOwnerRichMenu(dormitoryId: string, lineUserId: string): Promise<boolean> {
    const cached = DORM_RICH_MENUS_CACHE.get(dormitoryId);
    let ownerMenuId = cached?.ownerMenuId;

    if (!ownerMenuId) {
      const synced = await this.syncDormitoryRichMenus(dormitoryId);
      ownerMenuId = synced.ownerMenuId || undefined;
    }

    if (!ownerMenuId) return false;

    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) return false;

    return await this.lineAdapter.linkRichMenuToUser(lineUserId, ownerMenuId, accessToken);
  }

  /**
   * Unlink the individual Owner Rich Menu from a user so they revert to the default Tenant Rich Menu
   */
  async unlinkOwnerRichMenu(dormitoryId: string, lineUserId: string): Promise<boolean> {
    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) return false;

    return await this.lineAdapter.unlinkRichMenuFromUser(lineUserId, accessToken);
  }

  /**
   * Link the Active Tenant Rich Menu to an approved/active tenant
   */
  async linkActiveTenantRichMenu(dormitoryId: string, lineUserId: string): Promise<boolean> {
    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) return false;

    const dorm = await this.prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { name: true },
    });
    const dormName = dorm?.name || 'HorPlus';
    const activeTenantMenuName = `HorPlus Active Tenant Menu - ${dormName}`;

    let activeTenantMenuId: string | null = null;
    try {
      const existingMenus = await this.lineAdapter.getRichMenuList(accessToken);
      if (Array.isArray(existingMenus)) {
        const found = existingMenus.find((m: any) => m.name === activeTenantMenuName);
        if (found?.richMenuId) {
          activeTenantMenuId = found.richMenuId;
        }
      }
    } catch {}

    if (!activeTenantMenuId) {
      const payload = this.buildActiveTenantRichMenuPayload(dormName);
      activeTenantMenuId = await this.lineAdapter.createRichMenu(payload, accessToken);
      if (activeTenantMenuId) {
        const image = await this.generateActiveTenantRichMenuImage();
        await this.lineAdapter.uploadRichMenuImage(activeTenantMenuId, image, 'image/png', accessToken);
      }
    }

    if (!activeTenantMenuId) return false;
    return await this.lineAdapter.linkRichMenuToUser(lineUserId, activeTenantMenuId, accessToken);
  }

  /**
   * Create a single-use, short-lived (60s) Direct Entry Ticket for seamless owner dashboard access
   */
  createDirectEntryTicket(params: {
    dormitoryId: string;
    lineUserId: string;
    roleCode: string;
    grantId?: string;
    userId?: string;
  }): string {
    return createDirectEntryTicket(params);
  }

  /**
   * Consume a Direct Entry Ticket atomically (single-use)
   */
  consumeDirectEntryTicket(ticket: string): DirectEntryTicket | null {
    return consumeDirectEntryTicket(ticket);
  }
}

export function createDirectEntryTicket(params: {
  dormitoryId: string;
  lineUserId: string;
  roleCode: string;
  grantId?: string;
  userId?: string;
}): string {
  const ticket = `ticket_${crypto.randomUUID().replace(/-/g, '')}`;
  const expiresAt = Date.now() + 60 * 1000; // 60 seconds lifetime

  DIRECT_ENTRY_TICKETS.set(ticket, {
    ticket,
    dormitoryId: params.dormitoryId,
    lineUserId: params.lineUserId,
    roleCode: params.roleCode,
    grantId: params.grantId,
    userId: params.userId,
    expiresAt,
  });

  return ticket;
}

export function consumeDirectEntryTicket(ticket: string): DirectEntryTicket | null {
  const found = DIRECT_ENTRY_TICKETS.get(ticket);
  if (!found) return null;

  DIRECT_ENTRY_TICKETS.delete(ticket); // Atomic single-use

  if (Date.now() > found.expiresAt) {
    return null; // Expired
  }

  return found;
}
