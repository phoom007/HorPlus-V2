import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Wave 1 Frontend Business Authority Regression Guards Suite', () => {
  const ownerPath = path.resolve(process.cwd(), 'src/pages/owner.tsx');
  const dashboardPath = path.resolve(process.cwd(), 'src/pages/owner/dashboard.tsx');
  const metersPath = path.resolve(process.cwd(), 'src/pages/owner/meters.tsx');
  const tenantsPath = path.resolve(process.cwd(), 'src/pages/owner/tenants.tsx');
  const contractsPath = path.resolve(process.cwd(), 'src/pages/owner/contracts.tsx');

  it('1. owner.tsx does not use hardcoded 2026-08 or 2026-07 cycle fallbacks', () => {
    const content = fs.readFileSync(ownerPath, 'utf8');
    expect(content).not.toContain("selectedCycleCode || '2026-08'");
    expect(content).not.toContain("setSelectedCycle('2026-07')");
    expect(content).not.toContain("minCycle = '2026-01'");
    expect(content).not.toContain("const maxCycle = getMaxCycle()");
  });

  it('2. dashboard.tsx does not use localCycle 2026-07 state fallback', () => {
    const content = fs.readFileSync(dashboardPath, 'utf8');
    expect(content).not.toContain("localCycle, setLocalCycle");
    expect(content).not.toContain("useState('2026-07')");
  });

  it('3. meters.tsx does not use default selectedCycle 2026-07 or 2026-01 assumptions', () => {
    const content = fs.readFileSync(metersPath, 'utf8');
    expect(content).not.toContain("selectedCycle = '2026-07'");
    expect(content).not.toContain("isFirstCycle = selectedCycle === '2026-01'");
  });

  it('4. tenants.tsx does not use registered_dorm_profile or fake dorm-1 authority', () => {
    const content = fs.readFileSync(tenantsPath, 'utf8');
    expect(content).not.toContain("registered_dorm_profile");
    expect(content).not.toContain("id: 'dorm-1'");
  });

  it('5. contracts.tsx does not use ct-${Date.now()} or CNT-2026- frontend authority', () => {
    const content = fs.readFileSync(contractsPath, 'utf8');
    expect(content).not.toContain("`ct-${Date.now()}`");
    expect(content).not.toContain("CNT-2026-");
    expect(content).not.toContain("HorPlus_pending_contract_submissions");
    expect(content).not.toContain("id: 'dorm-1'");
  });

  it('6. OwnerMeters requires selectedBillingCycleId and does not mutate local bill status', () => {
    const content = fs.readFileSync(metersPath, 'utf8');
    expect(content).toContain('selectedBillingCycleId: string');
    expect(content).not.toContain('handleTogglePaid');
    expect(content).not.toContain('saveBulkMeterRecords(meterRows as any, selectedCycle)');
  });

  it('7. OwnerTenants uses updateTenant API and no fake setTimeout move-out mutations', () => {
    const content = fs.readFileSync(tenantsPath, 'utf8');
    expect(content).toContain('updateTenant');
    expect(content).not.toContain('tenant_moveout_request_');
    expect(content).not.toContain('co-${Date.now()}');
  });

  it('8. OwnerContracts starts with empty tenant signature and no fake local termination/renewal mutations', () => {
    const content = fs.readFileSync(contractsPath, 'utf8');
    expect(content).toContain('useState<string | undefined>(undefined)');
    expect(content).toContain('ฟังก์ชันยุติสัญญา/สรุปยอดย้ายออกยังไม่พร้อมใช้งานในเวอร์ชันนี้');
    expect(content).toContain('ฟังก์ชันต่ออายุสัญญาเช่ายังไม่พร้อมใช้งานในเวอร์ชันนี้');
  });
});
