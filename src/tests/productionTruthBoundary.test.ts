import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDataMode } from '../data/dataMode';

describe('Production Truth Boundary Architectural Gate', () => {
  it('getDataMode() must strictly return "api"', () => {
    expect(getDataMode()).toBe('api');
  });

  it('no runtime owner/tenant pages or router guards import mockData', () => {
    const srcDir = path.resolve(__dirname, '..');
    const targetDirs = [
      path.join(srcDir, 'pages', 'owner'),
      path.join(srcDir, 'router'),
      path.join(srcDir, 'data', 'adapters', 'api')
    ];

    const targetFiles = [
      path.join(srcDir, 'pages', 'tenant.tsx'),
      path.join(srcDir, 'pages', 'tenant', 'TenantInvitePage.tsx'),
      path.join(srcDir, 'components', 'LineNotificationModal.tsx'),
      path.join(srcDir, 'components', 'tenant', 'TenantRegisterView.tsx')
    ];

    const getAllFiles = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(getAllFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          files.push(fullPath);
        }
      }
      return files;
    };

    let allPaths: string[] = [...targetFiles];
    for (const dir of targetDirs) {
      allPaths = allPaths.concat(getAllFiles(dir));
    }

    const violations: string[] = [];

    for (const filePath of allPaths) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        if (/import.*from.*['"].*mockData['"]/.test(line)) {
          violations.push(`${path.relative(srcDir, filePath)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations, `Found mockData import violations:\n${violations.join('\n')}`).toEqual([]);
  });

  it('no runtime files reference external payment QR generators (api.qrserver.com, promptpay.io)', () => {
    const srcDir = path.resolve(__dirname, '..');
    const ownerPagesDir = path.join(srcDir, 'pages', 'owner');
    
    const getFiles = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(getFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          files.push(fullPath);
        }
      }
      return files;
    };

    const files = getFiles(ownerPagesDir);
    const violations: string[] = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('api.qrserver.com') || content.includes('promptpay.io')) {
        violations.push(path.relative(srcDir, filePath));
      }
    }

    expect(violations, `Found forbidden external QR generator URLs in:\n${violations.join('\n')}`).toEqual([]);
  });

  it('meters.tsx must not contain legacy meters_state_, numeric rate fallbacks (18/7/200/100), or Math.random', () => {
    const metersPath = path.resolve(__dirname, '../pages/owner/meters.tsx');
    const content = fs.readFileSync(metersPath, 'utf-8');

    expect(content).not.toContain('meters_state_');
    expect(content).not.toMatch(/waterUnitRate.*\|\|\s*18/);
    expect(content).not.toMatch(/electricUnitRate.*\|\|\s*7/);
    expect(content).not.toContain('commonFee !== undefined ? cycleRates.commonFee : 200');
    expect(content).not.toContain('parkingFee !== undefined ? cycleRates.parkingFee : 100');
    expect(content).not.toContain('Math.random');
  });

  it('owner.tsx must not contain meters_issued_rooms_ or meters_state_ business authority', () => {
    const ownerPath = path.resolve(__dirname, '../pages/owner.tsx');
    const content = fs.readFileSync(ownerPath, 'utf-8');

    expect(content).not.toContain('meters_issued_rooms_');
    expect(content).not.toContain('meters_state_');
  });

  it('settings.tsx must not contain fake dormitory definitions, no-op save, or hardcoded business defaults', () => {
    const settingsPath = path.resolve(__dirname, '../pages/owner/settings.tsx');
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const lineOaPath = path.resolve(__dirname, '../pages/owner/line-oa.tsx');
    const lineOaContent = fs.readFileSync(lineOaPath, 'utf-8');

    expect(settingsPath).toBeDefined();
    expect(lineOaContent).toContain('Channel ID');
    expect(lineOaContent).toContain('Channel Secret');
    expect(content).not.toContain('line-channel-access-token-input');
    expect(content).not.toContain('line-oa-id-input');
    expect(content).not.toContain('export function getDormitoryRatesForCycle');
    expect(content).not.toContain('const getDormitory =');
    expect(content).not.toContain('const saveDormitory =');
    expect(content).not.toContain('const seedDatabase =');
    expect(content).not.toContain("useState<number>(4500)");
    expect(content).not.toContain("useState<number>(9000)");
    expect(content).not.toContain('handleResetDemoData');
    expect(content).not.toContain('รีเซ็ตข้อมูลสาธิต');
    expect(content).not.toContain('Prototype');
  });

  it('tenant.tsx must not contain demoHasRoom, A-101 room fallback, fake repair upload success label, or mock date fallbacks', () => {
    const tenantPath = path.resolve(__dirname, '../pages/tenant.tsx');
    const content = fs.readFileSync(tenantPath, 'utf-8');

    expect(content).not.toContain('demoHasRoom');
    expect(content).not.toContain('A-101');
    expect(content).not.toContain('อัปโหลดสำเร็จ</p>');
    expect(content).not.toContain("dormInfo.bankAccountNumber || '123-4-56789-0'");
    expect(content).not.toContain("dormInfo?.bankAccountNumber || '123-4-56789-0'");
    expect(content).not.toContain("{ name: 'มี.ค.', water: 7, elec: 112 }");
    expect(content).not.toContain('tenant_moveout_request_');
    expect(content).not.toContain("`rep-${Date.now()}`");
    expect(content).toContain("res.ok");
    expect(content).not.toContain('Safe hardcoded fallbacks matching mockData');
    expect(content).not.toContain("return '30 มิ.ย. 2569'");
  });

  it('server tenant contract PDF route and DocumentPdfService must not contain billingDay fallback 1, dueDay fallback 1, internetFee || 0.00, or synthetic createdAt 2026-01-01', () => {
    const pdfRoutePath = path.resolve(__dirname, '../../server/src/routes/tenant-portal.routes.ts');
    const pdfServicePath = path.resolve(__dirname, '../../server/src/services/document-pdf.service.ts');
    const routeContent = fs.readFileSync(pdfRoutePath, 'utf-8');
    const serviceContent = fs.readFileSync(pdfServicePath, 'utf-8');

    expect(routeContent).not.toContain("waterRate: '18.00'");
    expect(routeContent).not.toContain("electricityRate: '7.00'");
    expect(routeContent).not.toContain("roomNumber: room?.roomNumber || '101'");
    expect(routeContent).not.toContain("billingDay: 25");
    expect(routeContent).not.toContain("dueDay: 5");
    expect(routeContent).not.toContain("billingDayVal = billSettings?.billingDay !== undefined ? billSettings.billingDay : 1");
    expect(routeContent).not.toContain("dueDayVal = billSettings?.dueDay !== undefined ? billSettings.dueDay : 1");

    expect(serviceContent).not.toContain("data.internetFee || '0.00'");
    expect(serviceContent).not.toContain("2026-01-01T00:00:00.000Z");
  });
});
