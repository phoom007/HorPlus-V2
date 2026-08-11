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
    expect(content).not.toContain('waterUnitRate || 18');
    expect(content).not.toContain('electricUnitRate || 7');
    expect(content).not.toContain('commonFee !== undefined ? cycleRates.commonFee : 200');
    expect(content).not.toContain('parkingFee !== undefined ? cycleRates.parkingFee : 100');
    expect(content).not.toContain('Math.random');
  });

  it('settings.tsx must not contain line-channel-access-token-input or line-oa-id-input test IDs', () => {
    const settingsPath = path.resolve(__dirname, '../pages/owner/settings.tsx');
    const content = fs.readFileSync(settingsPath, 'utf-8');

    expect(content).not.toContain('line-channel-access-token-input');
    expect(content).not.toContain('line-oa-id-input');
    expect(content).toContain('line-channel-id-input');
    expect(content).toContain('line-channel-secret-input');
  });
});
