/**
 * HorPlus LOCAL-07 — Master UAT Sandbox Refresh Command
 * 
 * Orchestrates:
 * 1. Database Target Safety Verification
 * 2. Deterministic Reset & Seed
 * 3. Dashboard/Reports KPI Oracle Generation
 * 4. Authenticated Browser Sessions Generation
 * 5. Full Sandbox Verification & Integrity Check
 * 
 * Usage: npm run uat:refresh
 * 
 * @license Apache-2.0
 */

import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { seedLocal07Data } from './seed.mjs';
import { generateOracle } from './generate-oracle.mjs';
import { createAllSessions } from './login-helper.mjs';
import { runVerification } from './verify.mjs';

async function main() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — MASTER REFRESH ORCHESTRATOR');
  console.log('================================================================================\n');

  // 1. Safety Guard
  const safety = assertSafeDatabaseTarget();
  console.log(`🔒 [1/5] Safety Guard: Target confirmed ${safety.host}:${safety.port}/${safety.database}`);

  // 2. Reset & Seed
  console.log(`🌱 [2/5] Seeding deterministic LOCAL-07 dataset...`);
  await seedLocal07Data();

  // 3. Oracle Generation
  console.log(`📊 [3/5] Generating Dashboard & Reports Oracle...`);
  generateOracle();

  // 4. Authenticated Sessions
  console.log(`🔑 [4/5] Generating authenticated sessions & storage states...`);
  const sessions = await createAllSessions();

  // 5. Verification
  console.log(`🔍 [5/5] Running sandbox integrity verification...`);
  const ok = await runVerification();

  if (!ok) {
    console.error('❌ Sandbox refresh completed with verification errors.');
    process.exit(1);
  }

  console.log('================================================================================');
  console.log('🚀 HORPLUS LOCAL-07 SANDBOX IS READY FOR MANUAL PRODUCT OWNER UAT');
  console.log('================================================================================');
  console.log('\n📖 Manual Test Guide: docs/uat/LOCAL07_MANUAL_TEST_GUIDE_TH.md');
  console.log('📊 Expected Results:   docs/uat/LOCAL07_EXPECTED_RESULTS_TH.md\n');
  console.log('🌐 QUICK ACCESS URLS (Local Dev Server running on http://127.0.0.1:5173):');
  console.log('  1. Fresh Owner:          http://127.0.0.1:5173/owner/dashboard');
  console.log('  2. Comprehensive Owner:  http://127.0.0.1:5173/owner/dashboard');
  console.log('  3. Tenant Somchai:       http://127.0.0.1:5173/tenant/dashboard');
  console.log('  4. Manager:              http://127.0.0.1:5173/owner/dashboard');
  console.log('  5. Tech:                 http://127.0.0.1:5173/owner/dashboard');
  console.log('\n💡 Tip: Session storage states are saved in .local07-sessions/*.json');
  console.log('================================================================================\n');
}

main().catch((err) => {
  console.error(`❌ [FATAL ERROR] ${err.message}`);
  process.exit(1);
});
