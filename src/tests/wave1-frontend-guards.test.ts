import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Wave 1 Frontend Business Authority Regression Guards Suite', () => {
  const ownerPath = path.resolve(process.cwd(), 'src/pages/owner.tsx');
  const dashboardPath = path.resolve(process.cwd(), 'src/pages/owner/dashboard.tsx');
  const tenantsPath = path.resolve(process.cwd(), 'src/pages/owner/tenants.tsx');
  const contractsPath = path.resolve(process.cwd(), 'src/pages/owner/contracts.tsx');

  it('1. owner.tsx does not use hardcoded 2026-07 or 2026-01 business cycle authority', () => {
    const content = fs.readFileSync(ownerPath, 'utf8');
    expect(content).not.toContain("setSelectedCycle('2026-07')");
    expect(content).not.toContain("minCycle = '2026-01'");
    expect(content).not.toContain("const maxCycle = getMaxCycle()");
  });

  it('2. dashboard.tsx does not use localCycle 2026-07 state fallback', () => {
    const content = fs.readFileSync(dashboardPath, 'utf8');
    expect(content).not.toContain("localCycle, setLocalCycle");
    expect(content).not.toContain("useState('2026-07')");
  });

  it('3. tenants.tsx does not use registered_dorm_profile or fake dorm-1 authority', () => {
    const content = fs.readFileSync(tenantsPath, 'utf8');
    expect(content).not.toContain("registered_dorm_profile");
    expect(content).not.toContain("id: 'dorm-1'");
  });

  it('4. contracts.tsx does not use HorPlus_pending_contract_submissions or fake dorm-1 authority', () => {
    const content = fs.readFileSync(contractsPath, 'utf8');
    expect(content).not.toContain("HorPlus_pending_contract_submissions");
    expect(content).not.toContain("id: 'dorm-1'");
  });
});
