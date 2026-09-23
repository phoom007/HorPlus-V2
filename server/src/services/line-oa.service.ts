/**
 * Per-Dormitory LINE OA Configuration & Webhook Service
 * SECURITY DEFINER resolver returns minimal routing identity.
 * Full config read under RLS after context is set.
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import {
  encryptText,
  decryptText,
  generateOpaqueWebhookKey,
  generateGrantToken,
  hashToken,
  verifyLineSignature
} from '../utils/crypto-encryption.js';
import { AppError } from '../types/index.js';
import { LineFriendService } from './line-friend.service.js';
import { LinePlatformAdapter, MockLinePlatformAdapter } from './line-platform-adapter.js';
import { createLinePlatformAdapter } from './line-adapter-factory.js';
import { LineChannelTokenProvider, ILineChannelTokenProvider, FakeLineTokenProvider } from './line-channel-token-provider.js';
import { TenantRegistrationInviteService, tenantRegistrationInviteService } from './tenant-registration-invite.service.js';
import { LinePushUsageService } from './line-push-usage.service.js';
import { LineRichMenuService } from './line-richmenu.service.js';
import QRCode from 'qrcode';

export interface PublicWebhookOriginStatus {
  origin: string | null;
  isConfigured: boolean;
  errorReason?: string;
}

export function validatePublicWebhookOrigin(rawOrigin?: string): PublicWebhookOriginStatus {
  const isE2E = process.env.NODE_ENV === 'test' || process.env.HORPLUS_E2E === 'true';
  const origin = (rawOrigin || process.env.PUBLIC_WEBHOOK_ORIGIN || process.env.PUBLIC_APP_ORIGIN || (isE2E ? 'https://webhook.horplus.com' : '')).trim().replace(/\/+$/, '');

  if (!origin) {
    return {
      origin: null,
      isConfigured: false,
      errorReason: 'WEBHOOK_PUBLIC_ORIGIN_NOT_CONFIGURED',
    };
  }

  if (!isE2E && (origin.startsWith('http://127.0.0.1') || origin.startsWith('http://localhost') || origin.startsWith('https://127.0.0.1') || origin.startsWith('https://localhost'))) {
    return {
      origin: null,
      isConfigured: false,
      errorReason: 'PUBLIC_WEBHOOK_ORIGIN_LOCALHOST_REJECTED',
    };
  }

  if (!isE2E && !origin.startsWith('https://')) {
    return {
      origin: null,
      isConfigured: false,
      errorReason: 'PUBLIC_WEBHOOK_ORIGIN_HTTPS_REQUIRED',
    };
  }

  return { origin, isConfigured: true };
}

export function getPublicWebhookOrigin(): string {
  const status = validatePublicWebhookOrigin();
  return status.origin || '';
}

let dynamicPublicAppOrigin: string | null = null;

export function setActiveAppOrigin(origin: string | null | undefined): void {
  if (!origin || typeof origin !== 'string') return;
  // If in production and PUBLIC_APP_ORIGIN is explicitly configured, do not override with dynamic request header (SEC-04)
  if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_APP_ORIGIN) {
    return;
  }
  const trimmed = origin.trim().replace(/\/+$/, '');
  if (trimmed && (trimmed.startsWith('https://') || trimmed.startsWith('http://'))) {
    dynamicPublicAppOrigin = trimmed;
  }
}

export function getActiveAppOrigin(): string | null {
  return dynamicPublicAppOrigin;
}

export function resetActiveAppOriginForTest(): void {
  dynamicPublicAppOrigin = null;
}

export function getPublicAppOrigin(): string {
  const isE2E = process.env.NODE_ENV === 'test' || process.env.HORPLUS_E2E === 'true';
  const isProd = process.env.NODE_ENV === 'production';

  // In production, configured PUBLIC_APP_ORIGIN has absolute priority over dynamic headers (SEC-04)
  const configuredProdOrigin = isProd ? (process.env.PUBLIC_APP_ORIGIN || '').trim().replace(/\/+$/, '') : '';
  const rawOrigin = configuredProdOrigin || dynamicPublicAppOrigin || (process.env.PUBLIC_APP_ORIGIN || (isE2E ? 'https://app.horplus.com' : 'http://localhost:5173'));

  const origin = rawOrigin.trim().replace(/\/+$/, '');

  if (isProd) {
    if (!origin) {
      throw new AppError('PUBLIC_APP_ORIGIN is not configured in production', 500, 'PUBLIC_APP_ORIGIN_NOT_CONFIGURED');
    }
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.startsWith('https://localhost') || origin.startsWith('https://127.0.0.1')) {
      throw new AppError('PUBLIC_APP_ORIGIN cannot be localhost in production', 500, 'PUBLIC_APP_ORIGIN_LOCALHOST_REJECTED');
    }
    if (!origin.startsWith('https://')) {
      throw new AppError('PUBLIC_APP_ORIGIN must use HTTPS in production', 500, 'PUBLIC_APP_ORIGIN_HTTPS_REQUIRED');
    }
  }

  return origin || 'http://localhost:5173';
}

export const CANONICAL_OWNER_LIFF_ID = '2011672957-NOfBsIcJ';
export const CANONICAL_TENANT_LIFF_ID = '2011672957-pIlWUt9e';

export function getOwnerLiffId(): string {
  const envVal = process.env.LINE_OWNER_LIFF_ID || process.env.VITE_LINE_OWNER_LIFF_ID;
  return (envVal && envVal.trim()) ? envVal.trim() : CANONICAL_OWNER_LIFF_ID;
}

export function getTenantLiffId(): string {
  const envVal = process.env.LINE_TENANT_LIFF_ID || process.env.VITE_LINE_TENANT_LIFF_ID || process.env.VITE_LINE_LIFF_ID || process.env.LINE_LIFF_ID;
  return (envVal && envVal.trim()) ? envVal.trim() : CANONICAL_TENANT_LIFF_ID;
}

export function getTenantRegistrationUrl(rawToken: string, appOrigin?: string): string {
  const origin = (appOrigin || getPublicAppOrigin()).trim().replace(/\/+$/, '');
  const tenantLiffId = getTenantLiffId();
  const preferDirect = process.env.PREFER_DIRECT_LINE_ENTRY === 'true';
  if (!preferDirect && tenantLiffId) {
    return `https://liff.line.me/${tenantLiffId}?t=${encodeURIComponent(rawToken)}`;
  }
  return `${origin}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(rawToken)}`;
}

export function buildTenantRegistrationFlexMessage(dormitoryName: string, registrationUrl: string) {
  return {
    type: 'flex',
    altText: `ยินดีต้อนรับสู่ ${dormitoryName} - ลงทะเบียนผู้เช่า`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06C755',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'ยินดีต้อนรับสู่',
            color: '#FFFFFF',
            size: 'xs',
            weight: 'regular',
          },
          {
            type: 'text',
            text: dormitoryName,
            color: '#FFFFFF',
            size: 'lg',
            weight: 'bold',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: 'ลงทะเบียนข้อมูลผู้เช่าเพื่อส่งคำขอให้เจ้าของหอพักตรวจสอบ',
            size: 'sm',
            color: '#475569',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            action: {
              type: 'uri',
              label: 'ลงทะเบียนผู้เช่า',
              uri: registrationUrl,
            },
          },
        ],
      },
    },
  };
}

export function buildTenantApprovalOutcomeFlexMessage(
  dormitoryName: string,
  roomNumber: string,
  isApproved: boolean,
  reason?: string,
  appUrl?: string
) {
  const isOk = Boolean(isApproved);
  const headerBgColor = isOk ? '#06C755' : '#EF4444';
  const headerTitle = isOk ? 'อนุมัติคำขอเช่าห้องพักเรียบร้อยแล้ว' : 'แจ้งผลการพิจารณาคำขอเช่าห้องพัก';
  const statusBadgeColor = isOk ? '#166534' : '#991B1B';
  const statusText = isOk ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ';

  const bodyContents: any[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: 'สถานะ',
          size: 'sm',
          color: '#64748B',
          flex: 2,
        },
        {
          type: 'text',
          text: statusText,
          size: 'sm',
          color: statusBadgeColor,
          weight: 'bold',
          flex: 4,
          align: 'end',
        },
      ],
    },
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: 'ห้องพัก',
          size: 'sm',
          color: '#64748B',
          flex: 2,
        },
        {
          type: 'text',
          text: `ห้อง ${roomNumber}`,
          size: 'sm',
          color: '#0F172A',
          weight: 'bold',
          flex: 4,
          align: 'end',
        },
      ],
    },
  ];

  if (!isOk && reason) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: 'เหตุผล:',
          size: 'xs',
          color: '#64748B',
        },
        {
          type: 'text',
          text: reason,
          size: 'sm',
          color: '#EF4444',
          wrap: true,
        },
      ],
    });
  } else if (isOk) {
    bodyContents.push({
      type: 'text',
      text: 'ท่านสามารถเข้าสู่ระบบผู้เช่าเพื่อตรวจสอบข้อมูลห้องพัก สัญญา และใบแจ้งหนี้ได้ทันที',
      size: 'xs',
      color: '#475569',
      margin: 'md',
      wrap: true,
    });
  }

  const origin = (appUrl || getPublicAppOrigin()).trim().replace(/\/+$/, '');
  const tenantLiffId = process.env.LINE_TENANT_LIFF_ID || process.env.VITE_LINE_TENANT_LIFF_ID || process.env.VITE_LINE_LIFF_ID || process.env.LINE_LIFF_ID;
  const targetUrl = tenantLiffId && tenantLiffId.trim()
    ? `https://liff.line.me/${tenantLiffId.trim()}`
    : `${origin}/tenant`;

  return {
    type: 'flex',
    altText: `ผลการพิจารณาคำขอเช่าห้องพัก ${roomNumber} - ${dormitoryName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBgColor,
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: dormitoryName,
            color: '#FFFFFF',
            size: 'xs',
            weight: 'regular',
          },
          {
            type: 'text',
            text: headerTitle,
            color: '#FFFFFF',
            size: 'md',
            weight: 'bold',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '20px',
        contents: bodyContents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: isOk ? '#06C755' : '#4F46E5',
            action: {
              type: 'uri',
              label: 'เข้าสู่ระบบผู้เช่า',
              uri: targetUrl,
            },
          },
        ],
      },
    },
  };
}

export function buildOwnerDirectEntryFlexMessage(dormitoryName: string, directEntryUrl: string) {
  let targetUrl = directEntryUrl;
  if (!targetUrl.includes('openExternalBrowser=1')) {
    targetUrl += targetUrl.includes('?') ? '&openExternalBrowser=1' : '?openExternalBrowser=1';
  }

  return {
    type: 'flex',
    altText: `เข้าสู่ระบบจัดการหอพัก - ${dormitoryName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#4F46E5',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: dormitoryName,
            color: '#C7D2FE',
            size: 'xs',
            weight: 'regular',
          },
          {
            type: 'text',
            text: '🏢 จัดการหอพัก',
            color: '#FFFFFF',
            size: 'lg',
            weight: 'bold',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'เข้าสู่ระบบจัดการหอพักได้ทันทีโดยไม่ต้องกรอกรหัสผ่าน (ลิงก์มีอายุ 60 วินาทีเพื่อความปลอดภัย)',
            size: 'sm',
            color: '#475569',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#4F46E5',
            action: {
              type: 'uri',
              label: 'เปิด Dashboard จัดการหอพัก',
              uri: targetUrl,
            },
          },
        ],
      },
    },
  };
}

export function buildOwnerNewTenantRegistrationFlexMessage(
  dormitoryName: string,
  applicantName: string,
  roomNumber: string,
  phone: string,
  appOrigin?: string
) {
  const origin = (appOrigin || getPublicAppOrigin()).trim().replace(/\/+$/, '');
  const ownerLiffId = getOwnerLiffId();
  const preferDirect = process.env.PREFER_DIRECT_LINE_ENTRY === 'true';
  const ownerHomeUrl = (!preferDirect && ownerLiffId)
    ? `https://liff.line.me/${ownerLiffId}`
    : `${origin}/owner/home`;

  return {
    type: 'flex',
    altText: `มีคำขอลงทะเบียนผู้เช่าใหม่ ห้อง ${roomNumber} - ${dormitoryName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#4F46E5',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: dormitoryName,
            color: '#C7D2FE',
            size: 'xs',
            weight: 'regular',
          },
          {
            type: 'text',
            text: '📝 คำขอลงทะเบียนผู้เช่าใหม่',
            color: '#FFFFFF',
            size: 'md',
            weight: 'bold',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้องพัก', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: `ห้อง ${roomNumber}`, size: 'sm', color: '#0F172A', weight: 'bold', flex: 4, align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ชื่อผู้สมัคร', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: applicantName, size: 'sm', color: '#0F172A', weight: 'bold', flex: 4, align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'เบอร์ติดต่อ', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: phone, size: 'sm', color: '#0F172A', weight: 'bold', flex: 4, align: 'end' },
            ],
          },
          {
            type: 'text',
            text: 'มีผู้เช่าส่งคำขอลงทะเบียนเข้ามาในระบบ กรุณาตรวจสอบข้อมูลและอนุมัติสัญญาเช่า',
            size: 'xs',
            color: '#475569',
            margin: 'md',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#4F46E5',
            action: {
              type: 'uri',
              label: 'ตรวจสอบคำขอลงทะเบียน',
              uri: ownerHomeUrl,
            },
          },
        ],
      },
    },
  };
}

export function buildOwnerMoveOutRequestFlexMessage(
  dormitoryName: string,
  applicantName: string,
  roomNumber: string,
  intendedMoveOutDate: string,
  appOrigin?: string
) {
  const origin = (appOrigin || getPublicAppOrigin()).trim().replace(/\/+$/, '');
  const ownerLiffId = getOwnerLiffId();
  const preferDirect = process.env.PREFER_DIRECT_LINE_ENTRY === 'true';
  const ownerHomeUrl = (!preferDirect && ownerLiffId)
    ? `https://liff.line.me/${ownerLiffId}`
    : `${origin}/owner/home`;

  return {
    type: 'flex',
    altText: `มีคำขอแจ้งย้ายออก ห้อง ${roomNumber} - ${dormitoryName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#DC2626',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: dormitoryName,
            color: '#FECACA',
            size: 'xs',
            weight: 'regular',
          },
          {
            type: 'text',
            text: 'คำขอแจ้งย้ายออกใหม่',
            color: '#FFFFFF',
            size: 'md',
            weight: 'bold',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้องพัก', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: `ห้อง ${roomNumber}`, size: 'sm', color: '#0F172A', weight: 'bold', flex: 4, align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ชื่อผู้เช่า', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: applicantName, size: 'sm', color: '#0F172A', weight: 'bold', flex: 4, align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'วันที่ประสงค์ย้ายออก', size: 'sm', color: '#64748B', flex: 3 },
              { type: 'text', text: intendedMoveOutDate, size: 'sm', color: '#DC2626', weight: 'bold', flex: 3, align: 'end' },
            ],
          },
          {
            type: 'text',
            text: 'ผู้เช่าได้ส่งคำขอแจ้งย้ายออกล่วงหน้า กรุณาตรวจสอบรายละเอียดและดำเนินการเมื่อถึงกำหนด',
            size: 'xs',
            color: '#475569',
            margin: 'md',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#DC2626',
            action: {
              type: 'uri',
              label: 'ตรวจสอบคำขอย้ายออก',
              uri: ownerHomeUrl,
            },
          },
        ],
      },
    },
  };
}

export function buildOwnerRenewalRequestFlexMessage(
  dormitoryName: string,
  applicantName: string,
  roomNumber: string,
  durationMonths: number,
  startDate: string,
  appOrigin?: string
) {
  const origin = (appOrigin || getPublicAppOrigin()).trim().replace(/\/+$/, '');
  const ownerLiffId = getOwnerLiffId();
  const preferDirect = process.env.PREFER_DIRECT_LINE_ENTRY === 'true';
  const ownerHomeUrl = (!preferDirect && ownerLiffId)
    ? `https://liff.line.me/${ownerLiffId}`
    : `${origin}/owner/home`;

  return {
    type: 'flex',
    altText: `มีคำขอต่อสัญญาเช่า ห้อง ${roomNumber} - ${dormitoryName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2563EB',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: dormitoryName,
            color: '#BFDBFE',
            size: 'xs',
            weight: 'regular',
          },
          {
            type: 'text',
            text: 'คำขอต่อสัญญาเช่าใหม่',
            color: '#FFFFFF',
            size: 'md',
            weight: 'bold',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้องพัก', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: `ห้อง ${roomNumber}`, size: 'sm', color: '#0F172A', weight: 'bold', flex: 4, align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ชื่อผู้เช่า', size: 'sm', color: '#64748B', flex: 2 },
              { type: 'text', text: applicantName, size: 'sm', color: '#0F172A', weight: 'bold', flex: 4, align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ระยะเวลาต่อสัญญา', size: 'sm', color: '#64748B', flex: 3 },
              { type: 'text', text: `${durationMonths} เดือน`, size: 'sm', color: '#2563EB', weight: 'bold', flex: 3, align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'วันเริ่มสัญญาใหม่', size: 'sm', color: '#64748B', flex: 3 },
              { type: 'text', text: startDate, size: 'sm', color: '#0F172A', weight: 'bold', flex: 3, align: 'end' },
            ],
          },
          {
            type: 'text',
            text: 'ผู้เช่าได้ส่งคำขอต่อสัญญาเข้ามาในระบบ กรุณาตรวจสอบเงื่อนไขและอนุมัติสัญญาเช่า',
            size: 'xs',
            color: '#475569',
            margin: 'md',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#2563EB',
            action: {
              type: 'uri',
              label: 'ตรวจสอบคำขอต่อสัญญา',
              uri: ownerHomeUrl,
            },
          },
        ],
      },
    },
  };
}

export function buildTenantRenewalOutcomeFlexMessage(
  dormitoryName: string,
  roomNumber: string,
  isApproved: boolean,
  reason?: string,
  appUrl?: string
) {
  const isOk = Boolean(isApproved);
  const headerBgColor = isOk ? '#059669' : '#DC2626';
  const headerTitle = isOk ? 'อนุมัติการต่อสัญญาเช่าเรียบร้อยแล้ว' : 'แจ้งผลการพิจารณาคำขอต่อสัญญาเช่า';
  const statusBadgeColor = isOk ? '#166534' : '#991B1B';
  const statusText = isOk ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ';

  const bodyContents: any[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: 'สถานะ',
          size: 'sm',
          color: '#64748B',
          flex: 2,
        },
        {
          type: 'text',
          text: statusText,
          size: 'sm',
          color: statusBadgeColor,
          weight: 'bold',
          flex: 4,
          align: 'end',
        },
      ],
    },
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: 'ห้องพัก',
          size: 'sm',
          color: '#64748B',
          flex: 2,
        },
        {
          type: 'text',
          text: `ห้อง ${roomNumber}`,
          size: 'sm',
          color: '#0F172A',
          weight: 'bold',
          flex: 4,
          align: 'end',
        },
      ],
    },
  ];

  if (!isOk && reason) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: 'เหตุผล:',
          size: 'xs',
          color: '#64748B',
        },
        {
          type: 'text',
          text: reason,
          size: 'sm',
          color: '#DC2626',
          wrap: true,
        },
      ],
    });
  } else if (isOk) {
    bodyContents.push({
      type: 'text',
      text: 'สัญญาเช่าฉบับใหม่ได้รับการอนุมัติเรียบร้อยแล้ว ท่านสามารถเข้าสู่ระบบเพื่อตรวจสอบสัญญาและกำหนดเวลาการเช่าได้',
      size: 'xs',
      color: '#475569',
      margin: 'md',
      wrap: true,
    });
  }

  const origin = (appUrl || getPublicAppOrigin()).trim().replace(/\/+$/, '');
  const tenantLiffId = process.env.LINE_TENANT_LIFF_ID || process.env.VITE_LINE_TENANT_LIFF_ID || process.env.VITE_LINE_LIFF_ID || process.env.LINE_LIFF_ID;
  const targetUrl = tenantLiffId && tenantLiffId.trim()
    ? `https://liff.line.me/${tenantLiffId.trim()}`
    : `${origin}/tenant`;

  return {
    type: 'flex',
    altText: `ผลการพิจารณาคำขอต่อสัญญาเช่าห้องพัก ${roomNumber} - ${dormitoryName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBgColor,
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: dormitoryName,
            color: '#FFFFFF',
            size: 'xs',
            weight: 'regular',
          },
          {
            type: 'text',
            text: headerTitle,
            color: '#FFFFFF',
            size: 'md',
            weight: 'bold',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '20px',
        contents: bodyContents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: isOk ? '#059669' : '#4F46E5',
            action: {
              type: 'uri',
              label: 'เข้าสู่ระบบผู้เช่า',
              uri: targetUrl,
            },
          },
        ],
      },
    },
  };
}

export function buildOwnerGuideCarouselFlexMessage(dormitoryName: string, appOrigin?: string) {
  const origin = (appOrigin || getPublicAppOrigin()).trim().replace(/\/+$/, '');
  const ownerLiffId = getOwnerLiffId();
  const preferDirect = process.env.PREFER_DIRECT_LINE_ENTRY === 'true';
  const ownerRoomsUrl = (!preferDirect && ownerLiffId)
    ? `https://liff.line.me/${ownerLiffId}?target=/owner/rooms`
    : `${origin}/owner/rooms`;

  return {
    type: 'flex',
    altText: `คู่มือการใช้งานสำหรับเจ้าของหอพัก - ${dormitoryName}`,
    contents: {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#4F46E5',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 1', color: '#C7D2FE', size: 'xs', weight: 'bold' },
              { type: 'text', text: '🏢 ตั้งค่าหอพัก & ห้องพัก', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'กำหนดรายละเอียดหอพัก เพิ่มอาคาร ชั้น และราคาห้องพัก พร้อมตั้งค่าค่าน้ำ ค่าไฟ และเงินประกันให้พร้อมใช้งาน',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#4F46E5',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'ดูห้องพักทั้งหมด',
                  uri: ownerRoomsUrl,
                },
              },
            ],
          },
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#059669',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 2', color: '#A7F3D0', size: 'xs', weight: 'bold' },
              { type: 'text', text: '📱 เชื่อมต่อ LINE OA', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'เชื่อมต่อบัญชี LINE Official Account ในเมนูตั้งค่า เพื่อเปิดระบบรับการแจ้งเตือนคำขอเช่า และส่งบิลหาผู้เช่าอัตโนมัติ',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#059669',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'ตั้งค่า LINE OA',
                  uri: `${origin}/owner/line-oa`,
                },
              },
            ],
          },
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#0284C7',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 3', color: '#BAE6FD', size: 'xs', weight: 'bold' },
              { type: 'text', text: '📝 ตรวจสอบ & อนุมัติผู้เช่า', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'ดูคำขอลงทะเบียนจากผู้เช่า ตรวจรูปบัตรประชาชน สัญญา และอนุมัติรับเข้าพักได้ในคลิกเดียวผ่านระบบ Bottom Sheet',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#0284C7',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'ตรวจสอบคำขอเช่า',
                  uri: `${origin}/owner/home`,
                },
              },
            ],
          },
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#D97706',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 4', color: '#FDE68A', size: 'xs', weight: 'bold' },
              { type: 'text', text: '💵 มิเตอร์ & การเงิน', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'จดมิเตอร์น้ำไฟ ออกใบแจ้งหนี้อัตโนมัติ สแกนตรวจสลิปโอนเงิน และบันทึกประวัติการชำระเงินได้อย่างแม่นยำ',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#D97706',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'จัดการบิล & การเงิน',
                  uri: `${origin}/owner/payments`,
                },
              },
            ],
          },
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#7C3AED',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 5', color: '#DDD6FE', size: 'xs', weight: 'bold' },
              { type: 'text', text: '📊 รายงาน & ภาพรวมรายได้', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'ติดตามสถิติอัตราการเช่า รายรับ-รายจ่าย ยอดค้างชำระ และส่งออกรายงานสรุปสำหรับบัญชีได้ทุกเดือน',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#7C3AED',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'ดูรายงานสรุป',
                  uri: `${origin}/owner/reports`,
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export function buildTenantGuideCarouselFlexMessage(dormitoryName: string, appOrigin?: string) {
  const origin = (appOrigin || getPublicAppOrigin()).trim().replace(/\/+$/, '');
  const tenantLiffId = process.env.LINE_TENANT_LIFF_ID || process.env.VITE_LINE_TENANT_LIFF_ID || process.env.VITE_LINE_LIFF_ID || process.env.LINE_LIFF_ID;
  const tenantPortalUrl = tenantLiffId && tenantLiffId.trim()
    ? `https://liff.line.me/${tenantLiffId.trim()}/tenant`
    : `${origin}/tenant`;

  return {
    type: 'flex',
    altText: `คู่มือการใช้งานสำหรับผู้เช่า - ${dormitoryName}`,
    contents: {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#059669',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 1', color: '#A7F3D0', size: 'xs', weight: 'bold' },
              { type: 'text', text: '📝 ลงทะเบียนเข้าพัก', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'กดปุ่ม "ลงทะเบียนผู้เช่า" ใน Rich Menu เพื่อเลือกห้องพัก กรอกข้อมูลส่วนตัว สัตว์เลี้ยง ยานพาหนะ และแนบรูปบัตรประชาชนอย่างปลอดภัย',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#059669',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'ลงทะเบียนผู้เช่า',
                  uri: tenantPortalUrl,
                },
              },
            ],
          },
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#0284C7',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 2', color: '#BAE6FD', size: 'xs', weight: 'bold' },
              { type: 'text', text: '🔔 รับผลการอนุมัติทาง LINE', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'เมื่อเจ้าของหอพักตรวจสอบและอนุมัติคำขอ ระบบจะส่งข้อความแจ้งเตือนผลผ่าน LINE OA ทันที พร้อมเปิดสัญญาห้องพัก',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#0284C7',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'เข้าสู่ระบบผู้เช่า',
                  uri: tenantPortalUrl,
                },
              },
            ],
          },
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#4F46E5',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 3', color: '#C7D2FE', size: 'xs', weight: 'bold' },
              { type: 'text', text: '💳 บิลค่าเช่า & ชำระเงิน', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'เปิดดูใบแจ้งหนี้ ค่าน้ำ ค่าไฟ สแกนจ่ายผ่าน QR Code พร้อมแนบสลิปโอนเงินผ่านระบบได้อย่างสะดวกและปลอดภัย',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#4F46E5',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'ดูบิล & ชำระเงิน',
                  uri: tenantPortalUrl,
                },
              },
            ],
          },
        },
        {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#E11D48',
            paddingAll: '16px',
            contents: [
              { type: 'text', text: 'ขั้นตอนที่ 4', color: '#FECDD3', size: 'xs', weight: 'bold' },
              { type: 'text', text: '🔧 แจ้งซ่อม & ติดต่อหอพัก', color: '#FFFFFF', size: 'md', weight: 'bold' },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: 'แจ้งปัญหาห้องพักหรืออุปกรณ์ชำรุด แนบรูปภาพ และติดตามสถานะการเข้าซ่อมของช่างได้ตลอด 24 ชั่วโมง',
                size: 'xs',
                color: '#475569',
                wrap: true,
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#E11D48',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: 'แจ้งซ่อมออนไลน์',
                  uri: tenantPortalUrl,
                },
              },
            ],
          },
        },
      ],
    },
  };
}

interface CachedPlatformQuota {
  remaining: number;
  type: 'limited' | 'none';
  value?: number;
  totalUsage?: number;
  cachedAt: number;
}

const LINE_QUOTA_CACHE = new Map<string, CachedPlatformQuota>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function clearLineQuotaCache(dormitoryId?: string) {
  if (dormitoryId) {
    LINE_QUOTA_CACHE.delete(dormitoryId);
  } else {
    LINE_QUOTA_CACHE.clear();
  }
}

export class LineOaService {
  private friendService: LineFriendService;
  private inviteService: TenantRegistrationInviteService;
  private lineAdapter: LinePlatformAdapter;
  private tokenProvider: ILineChannelTokenProvider;
  private richMenuService: LineRichMenuService;

  constructor(private prisma: PrismaClient, adapter?: LinePlatformAdapter, tokenProvider?: ILineChannelTokenProvider, inviteService?: TenantRegistrationInviteService) {
    this.friendService = new LineFriendService(prisma);
    this.inviteService = inviteService || new TenantRegistrationInviteService(prisma);
    if (adapter && tokenProvider) {
      this.lineAdapter = adapter;
      this.tokenProvider = tokenProvider;
    } else if (adapter && !tokenProvider) {
      this.lineAdapter = adapter;
      if (adapter instanceof MockLinePlatformAdapter) {
        this.tokenProvider = new FakeLineTokenProvider();
      } else {
        this.tokenProvider = new LineChannelTokenProvider();
      }
    } else if (process.env.NODE_ENV === 'test' && process.env.HORPLUS_E2E !== 'true') {
      this.lineAdapter = new MockLinePlatformAdapter();
      this.tokenProvider = tokenProvider || new FakeLineTokenProvider();
    } else {
      this.lineAdapter = createLinePlatformAdapter();
      this.tokenProvider = tokenProvider || new LineChannelTokenProvider();
    }
    this.richMenuService = new LineRichMenuService(this.prisma, this.lineAdapter, this.tokenProvider);
  }

  getRichMenuService(): LineRichMenuService {
    return this.richMenuService;
  }

  async syncRichMenus(dormitoryId: string, baseUrl?: string, forceRefresh: boolean = false) {
    if (baseUrl) {
      setActiveAppOrigin(baseUrl);
    }
    return await this.richMenuService.syncDormitoryRichMenus(dormitoryId, forceRefresh);
  }

  /**
   * Get LINE OA connection status (Secrets REDACTED)
   */
  async getDormitoryLineConfig(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    const originStatus = validatePublicWebhookOrigin(baseUrl);

    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      // Calculate current month LINE quota
      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      
      const sub = await tx.dormitorySubscription.findUnique({
        where: { dormitoryId },
        include: { plan: true },
      });
      const isPaid = sub?.plan?.code === 'PAID' || sub?.plan?.type === 'PAID';
      const monthlyQuota = sub?.plan?.messageQuotaMonthly || (isPaid ? 300 : 30);

      const usage = await tx.linePushUsage.findUnique({
        where: {
          dormitory_push_period_unique: {
            dormitoryId,
            periodKey: currentYearMonth,
          },
        },
      });
      const usedQuota = usage?.successCount || 0;
      const remainingQuota = Math.max(0, monthlyQuota - usedQuota);

      const config = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId }
      });

      if (!config) {
        return {
          connected: false,
          isReady: false,
          credentialsVerified: false,
          webhookEndpointSet: false,
          webhookTestSucceeded: false,
          webhookActive: false,
          hasChannelSecret: false,
          isPublicWebhookConfigured: originStatus.isConfigured,
          webhookOriginError: originStatus.errorReason || null,
          lineOaId: null,
          channelId: null,
          botUserId: null,
          botDisplayName: null,
          botPictureUrl: null,
          botPremiumId: null,
          botChatMode: null,
          effectiveLineId: null,
          friendAddUrl: null,
          qrSvg: null,
          accessTokenVerifiedAt: null,
          webhookEndpointSetAt: null,
          webhookTestSucceededAt: null,
          webhookVerifiedAt: null,
          webhookUrl: null,
          notifyRepairRequest: true,
          notifyRepairCompleted: true,
          notifyPaymentReceived: true,
          notifyTenantRegister: true,
          notifyTenantApproved: true,
          monthlyQuota,
          usedQuota,
          remainingQuota,
        };
      }

      let webhookUrl: string | null = null;
      if (config.webhookKeyEncrypted && originStatus.isConfigured && originStatus.origin) {
        try {
          const rawKey = decryptText(config.webhookKeyEncrypted);
          webhookUrl = `${originStatus.origin}/api/v1/line/webhook/${rawKey}`;
        } catch {
          webhookUrl = null;
        }
      }

      const isConnected = Boolean(
        config.accessTokenVerifiedAt &&
        config.webhookEndpointSetAt &&
        config.webhookTestSucceededAt &&
        config.webhookActive
      );

      const isReady = Boolean(
        config.accessTokenVerifiedAt &&
        config.webhookEndpointSetAt &&
        config.webhookActive
      );

      const formattedLineOaId = config.lineOaId
        ? (config.lineOaId.startsWith('@') ? '@' + config.lineOaId.replace(/^@+/, '') : `@${config.lineOaId}`)
        : null;

      // Generate QR Code SVG if friendAddUrl is available
      let qrSvg: string | null = null;
      const friendAddUrl = formattedLineOaId ? `https://line.me/R/ti/p/${formattedLineOaId}` : null;
      if (friendAddUrl) {
        try {
          qrSvg = await QRCode.toString(friendAddUrl, {
            type: 'svg',
            margin: 2,
            width: 200,
            errorCorrectionLevel: 'M',
          });
        } catch (qrErr: any) {
          console.warn('[LineOaService] Failed to generate QR code SVG:', qrErr.message);
          qrSvg = null;
        }
      }

      return {
        connected: isConnected,
        isReady,
        credentialsVerified: Boolean(config.accessTokenVerifiedAt),
        webhookEndpointSet: Boolean(config.webhookEndpointSetAt),
        webhookTestSucceeded: Boolean(config.webhookTestSucceededAt),
        webhookActive: Boolean(config.webhookActive),
        hasChannelSecret: Boolean(config.channelSecretEncrypted),
        isPublicWebhookConfigured: originStatus.isConfigured,
        webhookOriginError: originStatus.errorReason || null,
        lineOaId: formattedLineOaId,
        channelId: config.channelId,
        botUserId: config.botUserId,
        botDisplayName: config.botDisplayName,
        botPictureUrl: config.botPictureUrl,
        botPremiumId: config.botPremiumId,
        botChatMode: config.botChatMode,
        effectiveLineId: config.botPremiumId || formattedLineOaId || null,
        friendAddUrl,
        qrSvg,
        accessTokenVerifiedAt: config.accessTokenVerifiedAt,
        webhookEndpointSetAt: config.webhookEndpointSetAt,
        webhookTestSucceededAt: config.webhookTestSucceededAt,
        webhookVerifiedAt: config.webhookVerifiedAt,
        webhookUrl,
        notifyRepairRequest: config.notifyRepairRequest,
        notifyRepairCompleted: config.notifyRepairCompleted,
        notifyPaymentReceived: config.notifyPaymentReceived,
        notifyTenantRegister: config.notifyTenantRegister,
        notifyTenantApproved: config.notifyTenantApproved,
        monthlyQuota,
        usedQuota,
        remainingQuota,
      };
    });
  }

  /**
   * Save or Update LINE OA Channel credentials
   */
  async updateDormitoryLineConfig(
    dormitoryId: string,
    data: { channelId?: string; channelSecret?: string },
    baseUrl = getPublicWebhookOrigin()
  ) {
    if (!data.channelId && !data.channelSecret) {
      throw new AppError('Either channelId or channelSecret is required', 400, 'MISSING_CREDENTIALS');
    }

    let accessTokenVerifiedAt: Date | null = null;
    let botUserId: string | null = null;
    let botDisplayName: string | null = null;
    let botPictureUrl: string | null = null;
    let botPremiumId: string | null = null;
    let botChatMode: string | null = null;
    let lineOaId: string | null = null;

    if (data.channelId && data.channelSecret) {
      let token: string | null = null;
      try {
        token = await this.tokenProvider.getChannelAccessToken(data.channelId, data.channelSecret);
      } catch (err: any) {
        throw new AppError(err.message || 'Invalid LINE Channel credentials', 400, 'LINE_CREDENTIALS_INVALID');
      }

      if (!token) {
        throw new AppError('Failed to acquire stateless token from LINE platform', 400, 'LINE_TOKEN_ISSUANCE_FAILED');
      }

      const verification = await this.lineAdapter.verifyAccessToken(token);
      if (!verification.verified || !verification.botInfo) {
        throw new AppError('Failed to retrieve bot info with provided credentials', 400, 'LINE_BOT_INFO_FAILED');
      }

      const botInfo = verification.botInfo;
      botUserId = botInfo.userId || null;
      botDisplayName = botInfo.displayName || null;
      botPictureUrl = botInfo.pictureUrl || null;
      botPremiumId = botInfo.premiumId || null;
      botChatMode = botInfo.chatMode || null;
      lineOaId = botInfo.basicId ? (botInfo.basicId.startsWith('@') ? botInfo.basicId : `@${botInfo.basicId}`) : null;
      accessTokenVerifiedAt = new Date();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const existing = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId }
      });

      let channelSecretEncrypted = existing?.channelSecretEncrypted;
      if (data.channelSecret) {
        channelSecretEncrypted = encryptText(data.channelSecret);
      }

      let encryptedWebhookKey = existing?.webhookKeyEncrypted;
      let webhookKeyHash = existing?.webhookKeyHash;
      if (!encryptedWebhookKey) {
        const opaque = generateOpaqueWebhookKey();
        encryptedWebhookKey = opaque.keyEncrypted;
        webhookKeyHash = opaque.keyHash;
      }

      await tx.dormitoryLineConfig.upsert({
        where: { dormitoryId },
        create: {
          dormitoryId,
          channelId: data.channelId || null,
          channelSecretEncrypted: channelSecretEncrypted || null,
          lineOaId: lineOaId || null,
          botUserId: botUserId || null,
          botDisplayName: botDisplayName || null,
          botPictureUrl: botPictureUrl || null,
          botPremiumId: botPremiumId || null,
          botChatMode: botChatMode || null,
          webhookKeyHash: webhookKeyHash!,
          webhookKeyEncrypted: encryptedWebhookKey!,
          accessTokenVerifiedAt,
          webhookActive: false,
          isConnected: false,
        },
        update: {
          channelId: data.channelId !== undefined ? data.channelId : existing?.channelId,
          channelSecretEncrypted,
          lineOaId,
          botUserId,
          botDisplayName,
          botPictureUrl,
          botPremiumId,
          botChatMode,
          webhookKeyHash: webhookKeyHash!,
          webhookKeyEncrypted: encryptedWebhookKey!,
          accessTokenVerifiedAt,
        }
      });
    });

    if (accessTokenVerifiedAt) {
      this.richMenuService.syncDormitoryRichMenus(dormitoryId).catch((err) => {
        console.warn('LINE OA Rich Menu auto-sync warning:', err.message);
      });
    }

    return await this.getDormitoryLineConfig(dormitoryId, baseUrl);
  }

  /**
   * Set Webhook Endpoint on LINE Platform
   */
  async setWebhookEndpoint(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    let config = await this.getDormitoryLineConfig(dormitoryId, baseUrl);
    if (!config.credentialsVerified) {
      throw new AppError('Credentials must be verified before setting webhook endpoint', 400, 'LINE_CREDENTIALS_REQUIRED');
    }

    if (!config.webhookUrl) {
      await this.rotateWebhookKey(dormitoryId, baseUrl);
      config = await this.getDormitoryLineConfig(dormitoryId, baseUrl);
    }

    if (!config.webhookUrl) {
      throw new AppError('Webhook URL is missing', 400, 'WEBHOOK_URL_MISSING');
    }

    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) {
      throw new AppError('Failed to acquire stateless token for webhook setup', 500, 'TOKEN_ISSUANCE_FAILED');
    }

    const setRes = await this.lineAdapter.setWebhookEndpoint(config.webhookUrl, accessToken);
    if (!setRes.success) {
      throw new AppError('Failed to set webhook endpoint on LINE platform', 400, 'LINE_WEBHOOK_SET_FAILED');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: { webhookEndpointSetAt: new Date() },
      });
    });

    return await this.getDormitoryLineConfig(dormitoryId, baseUrl);
  }

  /**
   * Test Webhook Endpoint on LINE Platform (Fail-closed on webhookActive)
   */
  async testWebhookEndpoint(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    const config = await this.getDormitoryLineConfig(dormitoryId, baseUrl);
    if (!config.webhookUrl) {
      throw new AppError('Webhook URL is missing', 400, 'WEBHOOK_URL_MISSING');
    }

    if (baseUrl) {
      setActiveAppOrigin(baseUrl);
    }

    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) {
      throw new AppError('Failed to acquire stateless token for webhook test', 500, 'TOKEN_ISSUANCE_FAILED');
    }

    let getEndpointInfo = await this.lineAdapter.getWebhookEndpoint(accessToken);

    // Auto-align webhook endpoint on LINE platform if changed or not set
    if (config.webhookUrl && getEndpointInfo && getEndpointInfo.endpoint !== config.webhookUrl) {
      try {
        const setRes = await this.lineAdapter.setWebhookEndpoint(config.webhookUrl, accessToken);
        if (setRes.success) {
          getEndpointInfo = await this.lineAdapter.getWebhookEndpoint(accessToken);
        }
      } catch (autoSetErr: any) {
        console.warn('[LineOaService] Webhook endpoint auto-alignment warning:', autoSetErr.message);
      }
    }

    const testResult = await this.lineAdapter.testWebhookEndpoint(config.webhookUrl, accessToken);

    // LINE-02: webhookTestSucceeded and webhookActive are strictly separated and fail-closed
    const webhookTestSucceeded = testResult.success === true;
    const isWebhookActive = Boolean(getEndpointInfo && getEndpointInfo.active === true);
    const hasEndpointConfigured = Boolean(getEndpointInfo && getEndpointInfo.endpoint);
    const now = new Date();
    const endpointSetAt = config.webhookEndpointSetAt ? new Date(config.webhookEndpointSetAt as any) : (hasEndpointConfigured ? now : null);
    const isEndpointConfigured = Boolean(config.webhookEndpointSet || endpointSetAt);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: {
          webhookEndpointSetAt: endpointSetAt,
          webhookTestSucceededAt: webhookTestSucceeded ? now : null,
          webhookActive: isWebhookActive,
          isConnected: Boolean(config.accessTokenVerifiedAt && isEndpointConfigured && webhookTestSucceeded && isWebhookActive),
        },
      });
    });

    // --- SILENT FIRST-FOLLOWER OWNER AUTO-CLAIM & OWNER RICH MENU LINKING ---
    try {
      const existingOwnerGrant = await this.prisma.dormitoryAccessGrant.findFirst({
        where: {
          dormitoryId,
          roleCode: 'OWNER',
          status: 'ACTIVE',
        },
      });

      let ownerLineUserId: string | null = null;

      if (existingOwnerGrant && existingOwnerGrant.lineFriendId) {
        const friend = await this.prisma.dormitoryLineFriend.findUnique({
          where: { id: existingOwnerGrant.lineFriendId },
        });
        if (friend && friend.lineUserIdEncrypted) {
          const { decryptText } = await import('../utils/crypto-encryption.js');
          ownerLineUserId = decryptText(friend.lineUserIdEncrypted);
        }
      } else if (!existingOwnerGrant && this.lineAdapter.getFollowers) {
        const followersRes = await this.lineAdapter.getFollowers(accessToken).catch(() => null);
        if (followersRes && followersRes.userIds && followersRes.userIds.length > 0) {
          const firstFollowerUserId = followersRes.userIds[0];
          const profile = await this.lineAdapter.getProfile(firstFollowerUserId, accessToken).catch(() => null);
          const displayName = profile?.displayName || `LINE User (${firstFollowerUserId.slice(-4)})`;
          const pictureUrl = profile?.pictureUrl || null;

          await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

            const dorm = await tx.dormitory.findUnique({
              where: { id: dormitoryId },
              select: { createdByUserId: true },
            });

            const friend = await this.friendService.upsertFriendFromWebhook(
              dormitoryId,
              firstFollowerUserId,
              displayName,
              pictureUrl,
              'FOLLOWING',
              tx
            );

            // Double check inside transaction to guarantee strict idempotency
            const doubleCheckOwner = await tx.dormitoryAccessGrant.findFirst({
              where: {
                dormitoryId,
                roleCode: 'OWNER',
                status: 'ACTIVE',
              },
            });

            if (!doubleCheckOwner) {
              const { rawToken, tokenHash, tokenPrefix } = generateGrantToken();
              const tokenEncrypted = encryptText(rawToken);
              await tx.dormitoryAccessGrant.create({
                data: {
                  dormitoryId,
                  lineFriendId: friend.id,
                  tokenHash,
                  tokenEncrypted,
                  tokenPrefix,
                  roleCode: 'OWNER',
                  status: 'ACTIVE',
                  createdByPrincipal: dorm?.createdByUserId ? `usr_${dorm.createdByUserId}` : 'system_line_oa',
                },
              });
            }
          });

          ownerLineUserId = firstFollowerUserId;
        }
      }

      // Link 3-button Owner Rich Menu to the owner LINE user ID whenever available
      if (ownerLineUserId) {
        await this.richMenuService.linkOwnerRichMenu(dormitoryId, ownerLineUserId).catch((err) => {
          console.warn('Failed to link owner rich menu during webhook test:', err.message);
        });
      }
    } catch (silentClaimErr: any) {
      console.warn('Silent owner auto-claim / rich menu link non-fatal error:', silentClaimErr.message);
    }

    return await this.getDormitoryLineConfig(dormitoryId, baseUrl);
  }

  /**
   * Update notification preferences
   */
  async updatePreferences(
    dormitoryId: string,
    prefs: {
      notifyRepairRequest?: boolean;
      notifyRepairCompleted?: boolean;
      notifyPaymentReceived?: boolean;
      notifyTenantRegister?: boolean;
      notifyTenantApproved?: boolean;
    },
    baseUrl = getPublicWebhookOrigin()
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: {
          notifyRepairRequest: prefs.notifyRepairRequest,
          notifyRepairCompleted: prefs.notifyRepairCompleted,
          notifyPaymentReceived: prefs.notifyPaymentReceived,
          notifyTenantRegister: prefs.notifyTenantRegister,
          notifyTenantApproved: prefs.notifyTenantApproved,
        }
      });
    });

    return await this.getDormitoryLineConfig(dormitoryId, baseUrl);
  }

  /**
   * Disconnect LINE OA credentials & deactivate webhook
   */
  async disconnectLineConfig(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const existing = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId }
      });

      if (existing) {
        await tx.dormitoryLineConfig.update({
          where: { dormitoryId },
          data: {
            channelSecretEncrypted: null,
            accessTokenVerifiedAt: null,
            isConnected: false,
            webhookActive: false,
            webhookEndpointSetAt: null,
            webhookTestSucceededAt: null,
          }
        });
      }
    });

    return await this.getDormitoryLineConfig(dormitoryId, baseUrl);
  }

  /**
   * Rotate Webhook Key
   */
  async rotateWebhookKey(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const opaque = generateOpaqueWebhookKey();

      await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: {
          webhookKeyHash: opaque.keyHash,
          webhookKeyEncrypted: opaque.keyEncrypted,
          webhookVerifiedAt: null,
          webhookEndpointSetAt: null,
          webhookTestSucceededAt: null,
          webhookActive: false,
          isConnected: false,
        }
      });
    });

    return await this.getDormitoryLineConfig(dormitoryId, baseUrl);
  }

  /**
   * Resolve per-dormitory decrypted Channel Access Token (internal use for push/profile).
   * NEVER expose or log the returned value.
   */
  async resolveAccessToken(dormitoryId: string): Promise<string | null> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      const config = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId },
        select: {
          channelId: true,
          channelSecretEncrypted: true,
          channelAccessTokenEncrypted: true,
        }
      });
      if (!config) return null;

      if (config.channelAccessTokenEncrypted) {
        try {
          return decryptText(config.channelAccessTokenEncrypted);
        } catch {}
      }

      if (config.channelId && config.channelSecretEncrypted) {
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
   * Process raw LINE Webhook payload.
   */
  async processWebhookEvent(rawKey: string, bodyBuffer: Buffer, signatureHeader: string, detectedOrigin?: string) {
    const keyHash = hashToken(rawKey);

    const configs = await this.prisma.$queryRaw<any[]>`
      SELECT config_id, dormitory_id
      FROM public.resolve_line_webhook_config(${keyHash})
    `;

    if (!configs || configs.length === 0) {
      throw new AppError('LINE webhook endpoint configuration not found', 404, 'WEBHOOK_CONFIG_NOT_FOUND');
    }

    const resolvedDormitoryId = configs[0].dormitory_id as string;

    const fullConfig = await this.prisma.dormitoryLineConfig.findUnique({
      where: { dormitoryId: resolvedDormitoryId },
      select: {
        channelSecretEncrypted: true,
        channelAccessTokenEncrypted: true,
        accessTokenVerifiedAt: true,
        webhookEndpointSetAt: true,
        isConnected: true,
        webhookVerifiedAt: true,
        id: true
      }
    });

    if (!fullConfig || !fullConfig.channelSecretEncrypted) {
      throw new AppError('LINE webhook config credentials not found', 404, 'WEBHOOK_CONFIG_NOT_FOUND');
    }

    const channelSecret = decryptText(fullConfig.channelSecretEncrypted);
    const isValid = verifyLineSignature(bodyBuffer, channelSecret, signatureHeader);
    if (!isValid) {
      throw new AppError('Invalid x-line-signature header', 401, 'INVALID_SIGNATURE');
    }

    // Origin activation is ONLY trusted AFTER HMAC-SHA256 signature verification passes (SEC-04)
    if (detectedOrigin) {
      setActiveAppOrigin(detectedOrigin);
    }

    let accessToken: string | null = null;
    if (fullConfig.channelAccessTokenEncrypted) {
      try {
        accessToken = decryptText(fullConfig.channelAccessTokenEncrypted);
      } catch {
        accessToken = null;
      }
    }
    if (!accessToken) {
      accessToken = await this.resolveAccessToken(resolvedDormitoryId).catch(() => null);
    }

    let payload: any = {};
    try {
      payload = JSON.parse(bodyBuffer.toString('utf8'));
    } catch {
      throw new AppError('Failed to parse webhook JSON body', 400, 'INVALID_JSON_BODY');
    }

    const events = payload.events || [];

    // Pre-fetch LINE user profiles outside $transaction to prevent DB table locks during external network latency (PERF-04)
    const userProfiles = new Map<string, { displayName: string; pictureUrl: string | null }>();
    if (accessToken) {
      const uniqueUserIds = [...new Set(events.map((e: any) => e.source?.userId).filter(Boolean))] as string[];
      await Promise.all(
        uniqueUserIds.map(async (uid: string) => {
          const profile = await this.lineAdapter.getProfile(uid, accessToken!).catch(() => null);
          const displayName = profile?.displayName || `LINE User (${uid.slice(-4)})`;
          const pictureUrl = profile?.pictureUrl || null;
          userProfiles.set(uid, { displayName, pictureUrl });
        })
      );
    }

    const replyActions: Array<{
      replyToken: string;
      dormitoryName: string;
      rawToken: string;
      accessToken: string;
      inviteId?: string;
      receiptId?: string;
      dormitoryId?: string;
    }> = [];

    const postbackActions: Array<{
      type: 'manage_dormitory' | 'tenant_register' | 'owner_user_guide' | 'tenant_user_guide';
      replyToken: string;
      lineUserId: string;
      accessToken: string;
      dormitoryName: string;
      dormitoryId: string;
      ticket?: string;
      rawToken?: string;
      inviteId?: string;
      authorized?: boolean;
      shouldLinkOwnerMenu?: boolean;
    }> = [];

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${resolvedDormitoryId}, true)`;

      const now = new Date();
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId: resolvedDormitoryId },
        data: {
          webhookVerifiedAt: now,
          webhookEndpointSetAt: fullConfig.webhookEndpointSetAt || now,
          webhookTestSucceededAt: now,
          webhookActive: true,
          isConnected: Boolean(fullConfig.accessTokenVerifiedAt),
        }
      });

      let processedCount = 0;
      let deduplicatedCount = 0;

      for (const event of events) {
        const eventId = event.webhookEventId || event.eventId || `${event.type}_${event.timestamp}_${event.source?.userId}`;

        try {
          const receipt = await tx.lineWebhookEventReceipt.create({
            data: {
              dormitoryId: resolvedDormitoryId,
              webhookEventId: eventId,
              eventType: event.type || 'unknown',
              status: 'processing',
              receivedAt: new Date(),
              processedAt: null
            }
          });

          const lineUserId = event.source?.userId;
          if (lineUserId) {
            const cachedProfile = userProfiles.get(lineUserId);
            const displayName = cachedProfile?.displayName || `LINE User (${lineUserId.slice(-4)})`;
            const pictureUrl = cachedProfile?.pictureUrl || null;

            if (event.type === 'follow') {
              const friend = await this.friendService.upsertFriendFromWebhook(
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'FOLLOWING', tx
              );

              const dorm = await tx.dormitory.findUnique({
                where: { id: resolvedDormitoryId },
                select: { name: true },
              });
              const dormName = dorm?.name || 'หอพัก';

              const invite = await this.inviteService.createInvite(
                resolvedDormitoryId,
                friend.id,
                tx
              );

              if (event.replyToken && accessToken) {
                replyActions.push({
                  replyToken: event.replyToken,
                  dormitoryName: dormName,
                  rawToken: invite.rawToken,
                  accessToken,
                  inviteId: invite.id,
                  receiptId: receipt.id,
                  dormitoryId: resolvedDormitoryId,
                });
              }
            } else if (event.type === 'unfollow') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'UNFOLLOWED', tx
              );
            } else if (event.type === 'message' || event.type === 'postback') {
              const friend = await this.friendService.upsertFriendFromWebhook(
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'FOLLOWING', tx
              );

              let action: string | null = null;
              if (event.type === 'postback') {
                const postbackData = event.postback?.data || '';
                const params = new URLSearchParams(postbackData);
                action = params.get('action');
              } else if (event.type === 'message' && event.message?.type === 'text') {
                const text = (event.message.text || '').trim().toLowerCase();
                if (text.includes('จัดการหอพัก') || text.includes('dashboard') || text.includes('เข้าสู่ระบบจัดการ')) {
                  action = 'manage_dormitory';
                } else if (text.includes('ลงทะเบียน') || text.includes('จองห้อง')) {
                  action = 'tenant_register';
                } else if (text.includes('วิธี') || text.includes('คู่มือ') || text.includes('guide')) {
                  const isOwner = await tx.dormitoryAccessGrant.findFirst({
                    where: {
                      dormitoryId: resolvedDormitoryId,
                      lineFriendId: friend.id,
                      roleCode: { in: ['OWNER', 'MANAGER', 'STAFF'] },
                      status: 'ACTIVE',
                    },
                  });
                  action = isOwner ? 'owner_user_guide' : 'tenant_user_guide';
                }
              }

              if (action) {
                const dorm = await tx.dormitory.findUnique({
                  where: { id: resolvedDormitoryId },
                  select: { name: true, createdByUserId: true },
                });
                const dormName = dorm?.name || 'หอพัก';

                if (action === 'manage_dormitory') {
                  const grant = await tx.dormitoryAccessGrant.findFirst({
                    where: {
                      dormitoryId: resolvedDormitoryId,
                      lineFriendId: friend.id,
                      status: 'ACTIVE',
                    },
                  });

                  if (grant && ['OWNER', 'MANAGER', 'STAFF'].includes(grant.roleCode)) {
                    const ticket = this.richMenuService.createDirectEntryTicket({
                      dormitoryId: resolvedDormitoryId,
                      lineUserId,
                      roleCode: grant.roleCode,
                      grantId: grant.id,
                    });
                    if (event.replyToken && accessToken) {
                      postbackActions.push({
                        type: 'manage_dormitory',
                        replyToken: event.replyToken,
                        lineUserId,
                        accessToken,
                        dormitoryName: dormName,
                        dormitoryId: resolvedDormitoryId,
                        ticket,
                        authorized: true,
                        shouldLinkOwnerMenu: true,
                      });
                    }
                  } else {
                    // Check if any active OWNER grant exists in this dormitory
                    const existingOwnerGrant = await tx.dormitoryAccessGrant.findFirst({
                      where: {
                        dormitoryId: resolvedDormitoryId,
                        roleCode: 'OWNER',
                        status: 'ACTIVE',
                      },
                    });

                    if (!existingOwnerGrant) {
                      // First owner accessing via LINE OA: auto-provision OWNER grant
                      const { rawToken, tokenHash, tokenPrefix } = generateGrantToken();
                      const tokenEncrypted = encryptText(rawToken);
                      const newGrant = await tx.dormitoryAccessGrant.create({
                        data: {
                          dormitoryId: resolvedDormitoryId,
                          lineFriendId: friend.id,
                          tokenHash,
                          tokenEncrypted,
                          tokenPrefix,
                          roleCode: 'OWNER',
                          status: 'ACTIVE',
                          createdByPrincipal: dorm?.createdByUserId ? `usr_${dorm.createdByUserId}` : 'system_line_oa',
                        },
                      });

                      const ticket = this.richMenuService.createDirectEntryTicket({
                        dormitoryId: resolvedDormitoryId,
                        lineUserId,
                        roleCode: 'OWNER',
                        grantId: newGrant.id,
                      });

                      if (event.replyToken && accessToken) {
                        postbackActions.push({
                          type: 'manage_dormitory',
                          replyToken: event.replyToken,
                          lineUserId,
                          accessToken,
                          dormitoryName: dormName,
                          dormitoryId: resolvedDormitoryId,
                          ticket,
                          authorized: true,
                          shouldLinkOwnerMenu: true,
                        });
                      }
                    } else {
                      if (event.replyToken && accessToken) {
                        postbackActions.push({
                          type: 'manage_dormitory',
                          replyToken: event.replyToken,
                          lineUserId,
                          accessToken,
                          dormitoryName: dormName,
                          dormitoryId: resolvedDormitoryId,
                          authorized: false,
                        });
                      }
                    }
                  }
                } else if (action === 'tenant_register') {
                  const invite = await this.inviteService.createInvite(
                    resolvedDormitoryId,
                    friend.id,
                    tx
                  );

                  if (event.replyToken && accessToken) {
                    postbackActions.push({
                      type: 'tenant_register',
                      replyToken: event.replyToken,
                      lineUserId,
                      accessToken,
                      dormitoryName: dormName,
                      dormitoryId: resolvedDormitoryId,
                      rawToken: invite.rawToken,
                      inviteId: invite.id,
                    });
                  }
                } else if (action === 'owner_user_guide') {
                  const isOwner = await tx.dormitoryAccessGrant.findFirst({
                    where: {
                      dormitoryId: resolvedDormitoryId,
                      lineFriendId: friend.id,
                      roleCode: { in: ['OWNER', 'MANAGER', 'STAFF'] },
                      status: 'ACTIVE',
                    },
                  });
                  if (event.replyToken && accessToken) {
                    postbackActions.push({
                      type: 'owner_user_guide',
                      replyToken: event.replyToken,
                      lineUserId,
                      accessToken,
                      dormitoryName: dormName,
                      dormitoryId: resolvedDormitoryId,
                      shouldLinkOwnerMenu: Boolean(isOwner),
                    });
                  }
                } else if (action === 'tenant_user_guide') {
                  if (event.replyToken && accessToken) {
                    postbackActions.push({
                      type: 'tenant_user_guide',
                      replyToken: event.replyToken,
                      lineUserId,
                      accessToken,
                      dormitoryName: dormName,
                      dormitoryId: resolvedDormitoryId,
                    });
                  }
                }
              }
            }
          }

          await tx.lineWebhookEventReceipt.update({
            where: { id: receipt.id },
            data: { status: 'processed', processedAt: new Date() }
          });

          processedCount++;
        } catch (err: any) {
          if (err.code === 'P2002' || err.message?.includes('unique constraint')) {
            deduplicatedCount++;
            continue;
          }
          throw err;
        }
      }

      return { success: true, processedCount, deduplicatedCount };
    });

    // Send follow replies outside database transaction
    for (const action of replyActions) {
      try {
        const appOrigin = detectedOrigin || getPublicAppOrigin();
        const registrationUrl = getTenantRegistrationUrl(action.rawToken, appOrigin);
        const flexMessage = buildTenantRegistrationFlexMessage(action.dormitoryName, registrationUrl);
        const deliveryResult = await this.lineAdapter.replyMessage(action.replyToken, [flexMessage], action.accessToken);

        if (action.inviteId) {
          await this.inviteService.updateDeliveryOutcome(action.inviteId, deliveryResult).catch(() => {});
        }

        if (deliveryResult.outcome === 'FAILED') {
          console.warn('LINE follow reply delivery failed with explicit rejection:', {
            httpStatus: deliveryResult.httpStatus,
            errorCode: deliveryResult.errorCode,
            requestId: deliveryResult.requestId,
          });
        }
      } catch (err: any) {
        console.warn('Unexpected error in LINE follow reply loop:', { message: err.message });
        if (action.inviteId) {
          await this.inviteService.updateDeliveryOutcome(action.inviteId, {
            outcome: 'UNKNOWN',
            transportErrorCode: err.code || err.name || 'UNEXPECTED_ERROR',
          }).catch(() => {});
        }
      }
    }

    // Handle postback actions outside database transaction
    for (const action of postbackActions) {
      try {
        const appOrigin = detectedOrigin || getPublicAppOrigin();

        // Trigger LINE loading animation API immediately for responsiveness
        if (action.lineUserId && action.accessToken && this.lineAdapter.displayLoadingAnimation) {
          await this.lineAdapter.displayLoadingAnimation(action.lineUserId, action.accessToken, 5).catch(() => {});
        }

        if (action.shouldLinkOwnerMenu) {
          await this.richMenuService.linkOwnerRichMenu(action.dormitoryId, action.lineUserId).catch(() => {});
        }

        if (action.type === 'manage_dormitory') {
          if (action.authorized && action.ticket) {
            const directEntryPath = `/api/v1/auth/line-direct-entry?ticket=${action.ticket}&openExternalBrowser=1`;
            const directEntryUrl = `${appOrigin}${directEntryPath}`;
            const flex = buildOwnerDirectEntryFlexMessage(action.dormitoryName, directEntryUrl);
            await this.lineAdapter.replyMessage(action.replyToken, [flex], action.accessToken);
          } else {
            const textMsg = {
              type: 'text',
              text: `บัญชี LINE นี้ยังไม่ได้รับสิทธิ์จัดการหอพัก ${action.dormitoryName}\nกรุณาติดต่อเจ้าของหอพักเพื่อขอสิทธิ์การเข้าถึง`,
            };
            await this.lineAdapter.replyMessage(action.replyToken, [textMsg], action.accessToken);
          }
        } else if (action.type === 'tenant_register' && action.rawToken) {
          const registrationUrl = getTenantRegistrationUrl(action.rawToken, appOrigin);
          const flex = buildTenantRegistrationFlexMessage(action.dormitoryName, registrationUrl);
          const deliveryResult = await this.lineAdapter.replyMessage(action.replyToken, [flex], action.accessToken);
          if (action.inviteId) {
            await this.inviteService.updateDeliveryOutcome(action.inviteId, deliveryResult).catch(() => {});
          }
        } else if (action.type === 'owner_user_guide') {
          const flex = buildOwnerGuideCarouselFlexMessage(action.dormitoryName, appOrigin);
          await this.lineAdapter.replyMessage(action.replyToken, [flex], action.accessToken);
        } else if (action.type === 'tenant_user_guide') {
          const flex = buildTenantGuideCarouselFlexMessage(action.dormitoryName, appOrigin);
          await this.lineAdapter.replyMessage(action.replyToken, [flex], action.accessToken);
        }
      } catch (err: any) {
        console.warn('Unexpected error in LINE postback reply loop:', { message: err.message, actionType: action.type });
      }
    }

    return result;
  }

  /**
   * Get cached LINE Platform quota status with 15-minute TTL.
   */
  async getLinePlatformQuotaStatus(dormitoryId: string): Promise<{
    available: boolean;
    remaining: number;
    type: 'limited' | 'none';
    totalUsage?: number;
    limit?: number;
  }> {
    const cached = LINE_QUOTA_CACHE.get(dormitoryId);
    const now = Date.now();
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
      return {
        available: cached.type === 'none' || cached.remaining > 0,
        remaining: cached.remaining,
        type: cached.type,
        totalUsage: cached.totalUsage,
        limit: cached.value,
      };
    }

    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) {
      return { available: false, remaining: 0, type: 'limited' };
    }

    if (!this.lineAdapter.getQuota) {
      return { available: true, remaining: 999, type: 'none' };
    }

    const quota = await this.lineAdapter.getQuota(accessToken);
    if (!quota) {
      return { available: true, remaining: 999, type: 'none' };
    }

    if (quota.type === 'none') {
      LINE_QUOTA_CACHE.set(dormitoryId, {
        remaining: Infinity,
        type: 'none',
        cachedAt: now,
      });
      return { available: true, remaining: Infinity, type: 'none' };
    }

    const consumption = this.lineAdapter.getQuotaConsumption
      ? await this.lineAdapter.getQuotaConsumption(accessToken)
      : null;
    const totalUsage = consumption?.totalUsage ?? 0;
    const limit = quota.value ?? 500;
    const remaining = Math.max(0, limit - totalUsage);

    LINE_QUOTA_CACHE.set(dormitoryId, {
      remaining,
      type: 'limited',
      value: limit,
      totalUsage,
      cachedAt: now,
    });

    return {
      available: remaining > 0,
      remaining,
      type: 'limited',
      totalUsage,
      limit,
    };
  }

  async pushOutcomeNotification(
    dormitoryId: string,
    toLineUserId: string,
    flexMessage: any
  ): Promise<boolean> {
    try {
      // 1. Check Dormitory Preferences & Connection Status
      if (this.prisma && typeof (this.prisma as any).$transaction === 'function') {
        const config = await this.prisma.dormitoryLineConfig?.findUnique?.({
          where: { dormitoryId },
          select: { isConnected: true, notifyTenantApproved: true },
        }).catch(() => null);

        if (config && (!config.isConnected || config.notifyTenantApproved === false)) {
          console.info(`[LineOaService] Push skipped: config isConnected=${config?.isConnected}, notifyTenantApproved=${config?.notifyTenantApproved}`);
          return false;
        }
      }

      // 2. Guard 1: HorPlus Business Quota (DB-First, Short-Circuit)
      if (this.prisma && typeof (this.prisma as any).$transaction === 'function') {
        try {
          const pushUsageService = new LinePushUsageService(this.prisma);
          const quotaStatus = await pushUsageService.getQuotaStatus(dormitoryId);
          if (!quotaStatus.isAvailable) {
            console.warn(`[LineOaService] Push blocked: HorPlus quota exhausted for dormitory ${dormitoryId}`);
            return false;
          }
        } catch (quotaErr: any) {
          console.warn('[LineOaService] Could not verify HorPlus quota status:', quotaErr.message);
        }
      }

      // 3. Guard 2: LINE Platform Quota (Cached with 15-min TTL)
      const platformQuota = await this.getLinePlatformQuotaStatus(dormitoryId);
      if (!platformQuota.available) {
        console.warn(`[LineOaService] Push blocked: LINE platform quota exhausted for dormitory ${dormitoryId}`);
        return false;
      }

      // 4. Resolve Token and Dispatch
      const accessToken = await this.resolveAccessToken(dormitoryId);
      if (!accessToken) return false;
      const retryKey = crypto.randomUUID();
      const res = await this.lineAdapter.pushMessage(toLineUserId, flexMessage, accessToken, retryKey);
      const isAccepted = res.outcome === 'ACCEPTED' || res.outcome === 'ALREADY_ACCEPTED';

      // 5. Update usage count if accepted
      if (isAccepted && this.prisma && typeof (this.prisma as any).$transaction === 'function') {
        try {
          const pushUsageService = new LinePushUsageService(this.prisma);
          const dorm = await this.prisma.dormitory?.findUnique?.({
            where: { id: dormitoryId },
            select: { timezone: true },
          });
          const timezone = dorm?.timezone || 'Asia/Bangkok';
          const periodKey = pushUsageService.getCurrentPeriodKey(timezone);

          await this.prisma.$executeRaw`
            INSERT INTO "line_push_usage" ("id", "dormitory_id", "period_key", "success_count", "reserved_count", "created_at", "updated_at")
            VALUES (gen_random_uuid(), ${dormitoryId}::uuid, ${periodKey}, 1, 0, NOW(), NOW())
            ON CONFLICT ("dormitory_id", "period_key")
            DO UPDATE SET "success_count" = "line_push_usage"."success_count" + 1, "updated_at" = NOW()
          `;

          // Decrement cached remaining
          const cached = LINE_QUOTA_CACHE.get(dormitoryId);
          if (cached && cached.type === 'limited' && cached.remaining > 0) {
            cached.remaining -= 1;
            if (cached.totalUsage !== undefined) cached.totalUsage += 1;
          }
        } catch (updateErr: any) {
          console.warn('[LineOaService] Failed to increment line_push_usage on push outcome:', updateErr.message);
        }
      }

      return isAccepted;
    } catch (err: any) {
      console.warn('Failed to push LINE outcome notification:', err.message);
      return false;
    }
  }
}
