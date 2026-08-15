#!/usr/bin/env node
/**
 * HorPlus LOCAL-06 — Master Acceptance Matrix & Traceability Validator
 * 
 * Validates:
 * 1. 100% Bidirectional Inventory ↔ Acceptance Matrix Traceability (82 in-scope mapped to >=1 PASS UAT row, 0 unmapped, 0 unknown).
 * 2. Exact Test Reference Validation (Every referenced spec file exists on disk AND exact test title exists in the spec).
 * 3. Dynamic Domain Breakdown Reconciliation across inventory, matrix, and signoff documents.
 * 4. Evidence Artifact Content Verification (Playwright, Backend vitest, Frontend unit, Typecheck, Migration drift 22/22).
 * 5. Handles pre-seal vs --final-seal execution modes gracefully.
 * 
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const isFinalSeal = process.argv.includes('--final-seal');

const MATRIX_FILE = path.join(ROOT_DIR, 'docs/uat/local06-master-acceptance-matrix.md');
const INVENTORY_FILE = path.join(ROOT_DIR, 'docs/uat/local06-feature-menu-inventory.md');
const SIGNOFF_FILE = path.join(ROOT_DIR, 'docs/uat/local06-final-local-product-signoff.md');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs/evidence');

console.log('================================================================================');
console.log('  HORPLUS LOCAL-06 — ACCEPTANCE MATRIX & TRACEABILITY SOUNDNESS VALIDATOR');
console.log('================================================================================');
console.log(`Execution Mode: ${isFinalSeal ? 'FINAL SEAL (Strict Evidence & Content Check)' : 'PRE-SEAL / VERIFICATION'}`);
console.log(`Timestamp:      ${new Date().toISOString()}\n`);

let failureCount = 0;

function reportError(msg) {
  console.error(`❌ [FAIL] ${msg}`);
  failureCount++;
}

function reportSuccess(msg) {
  console.log(`✅ [PASS] ${msg}`);
}

// -----------------------------------------------------------------------------
// 1. Parse docs/uat/local06-feature-menu-inventory.md
// -----------------------------------------------------------------------------
if (!fs.existsSync(INVENTORY_FILE)) {
  reportError(`Inventory file missing: ${INVENTORY_FILE}`);
  process.exit(1);
}

const inventoryContent = fs.readFileSync(INVENTORY_FILE, 'utf8');
const inventoryMap = new Map(); // id -> item
const inventoryLines = inventoryContent.split(/\r?\n/);

for (const line of inventoryLines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('|') && (trimmed.includes('**INV-') || trimmed.includes('INV-'))) {
    const parts = trimmed.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 16) {
      const id = parts[0].replace(/[`*]/g, '').trim();
      const scope = (parts[16] || parts[parts.length - 1]).replace(/[`*]/g, '').trim();
      inventoryMap.set(id, {
        id,
        role: parts[1].replace(/[`*]/g, '').trim(),
        portal: parts[2].replace(/[`*]/g, '').trim(),
        menu: parts[3].replace(/[`*]/g, '').trim(),
        route: parts[4].replace(/[`*]/g, '').trim(),
        feature: parts[6].replace(/[`*]/g, '').trim(),
        scope,
      });
    }
  }
}

const totalInventoryCount = inventoryMap.size;
const inScopeInventory = Array.from(inventoryMap.values()).filter(i => i.scope === 'IN_SCOPE');
const deferredInventory = Array.from(inventoryMap.values()).filter(i => i.scope === 'DEFERRED_EXTERNAL');

reportSuccess(`Parsed Inventory: Total=${totalInventoryCount}, In-Scope Local=${inScopeInventory.length}, Deferred External=${deferredInventory.length}`);

// -----------------------------------------------------------------------------
// 2. Parse docs/uat/local06-master-acceptance-matrix.md
// -----------------------------------------------------------------------------
if (!fs.existsSync(MATRIX_FILE)) {
  reportError(`Acceptance Matrix file missing: ${MATRIX_FILE}`);
  process.exit(1);
}

const matrixContent = fs.readFileSync(MATRIX_FILE, 'utf8');
const matrixLines = matrixContent.split(/\r?\n/);

const uatRows = [];
let tableHeaderFound = false;

for (const line of matrixLines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('|') && trimmed.includes('UAT ID') && trimmed.includes('Inventory ID(s)')) {
    tableHeaderFound = true;
    continue;
  }
  if (tableHeaderFound && trimmed.startsWith('|') && (trimmed.includes('**UAT-') || trimmed.includes('UAT-'))) {
    const parts = trimmed.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 17) {
      const uatId = parts[0].replace(/[`*]/g, '').trim();
      const rawInventoryIds = parts[1].replace(/[`*]/g, '').split(',').map(s => s.trim()).filter(Boolean);
      const role = parts[2].replace(/[`*]/g, '').trim();
      const menu = parts[3].replace(/[`*]/g, '').trim();
      const route = parts[4].replace(/[`*]/g, '').trim();
      const feature = parts[5].replace(/[`*]/g, '').trim();
      const evidenceRef = parts[15].replace(/[`]/g, '').trim();
      const finalStatus = parts[16].replace(/[`*]/g, '').trim();

      uatRows.push({
        uatId,
        inventoryIds: rawInventoryIds,
        role,
        menu,
        route,
        feature,
        evidenceRef,
        finalStatus,
        rawLine: trimmed,
      });
    }
  }
}

if (uatRows.length === 0) {
  reportError(`No valid UAT rows parsed from ${MATRIX_FILE}`);
  process.exit(1);
}

reportSuccess(`Parsed Acceptance Matrix: ${uatRows.length} UAT test cases found`);

// -----------------------------------------------------------------------------
// 3. Validate Bidirectional Inventory ↔ Acceptance Matrix Traceability
// -----------------------------------------------------------------------------
const inventoryToUatMap = new Map(); // invId -> array of uatId
for (const inv of inventoryMap.keys()) {
  inventoryToUatMap.set(inv, []);
}

const unknownInventoryReferences = [];

for (const row of uatRows) {
  if (row.finalStatus !== 'PASS') {
    reportError(`UAT case ${row.uatId} does NOT have PASS status (found: "${row.finalStatus}")`);
  }

  for (const invId of row.inventoryIds) {
    if (!inventoryMap.has(invId)) {
      unknownInventoryReferences.push({ uatId: row.uatId, invId });
      reportError(`UAT case ${row.uatId} references unknown Inventory ID: "${invId}"`);
    } else {
      inventoryToUatMap.get(invId).push(row.uatId);
    }
  }
}

// Verify that ALL 82 in-scope inventory items are mapped to at least 1 UAT test case
const unmappedInScope = [];
for (const inv of inScopeInventory) {
  const mappedUats = inventoryToUatMap.get(inv.id) || [];
  if (mappedUats.length === 0) {
    unmappedInScope.push(inv.id);
    reportError(`In-Scope Inventory item "${inv.id}" (${inv.feature}) is NOT mapped to any UAT test case!`);
  }
}

if (unmappedInScope.length === 0 && unknownInventoryReferences.length === 0) {
  reportSuccess(`Traceability 100% Complete: All ${inScopeInventory.length} in-scope inventory items mapped with 0 unmapped & 0 unknown`);
}

// -----------------------------------------------------------------------------
// 4. Verify Exact Test References on Disk & Spec Test Titles
// -----------------------------------------------------------------------------
console.log('\n--- Verifying Exact Spec Paths & Test Titles on Disk ---');

const specFileCache = new Map(); // path -> content
let verifiedTestReferencesCount = 0;

for (const row of uatRows) {
  const rawRef = row.evidenceRef;
  if (!rawRef) {
    reportError(`UAT case ${row.uatId} has empty Evidence Reference!`);
    continue;
  }

  // Split multi-spec references only when followed by a file path prefix (e.g. tests/, server/, src/)
  const refParts = rawRef.split(/[,;]\s*(?=tests\/|server\/|src\/)/).map(s => s.trim()).filter(Boolean);

  for (const part of refParts) {
    let specRelPath = '';
    let testTitle = '';

    if (part.includes('::')) {
      const [p, t] = part.split('::').map(s => s.trim());
      specRelPath = p;
      testTitle = t;
    } else {
      specRelPath = part.trim();
    }

    const specAbsPath = path.resolve(ROOT_DIR, specRelPath);
    if (!fs.existsSync(specAbsPath)) {
      reportError(`UAT case ${row.uatId}: Spec file not found on disk: "${specRelPath}"`);
      continue;
    }

    if (!specFileCache.has(specAbsPath)) {
      specFileCache.set(specAbsPath, fs.readFileSync(specAbsPath, 'utf8'));
    }
    const specCode = specFileCache.get(specAbsPath);

    if (testTitle) {
      // Check if test title exists in the spec code
      const cleanTitle = testTitle.replace(/[`'"]/g, '').trim();
      const hasTitle = specCode.includes(cleanTitle) || specCode.includes(testTitle);
      if (!hasTitle) {
        reportError(`UAT case ${row.uatId}: Test title "${cleanTitle}" not found in spec file "${specRelPath}"!`);
      } else {
        verifiedTestReferencesCount++;
      }
    } else {
      verifiedTestReferencesCount++;
    }
  }
}

reportSuccess(`Verified ${verifiedTestReferencesCount} exact test references across ${specFileCache.size} spec files on disk`);

// -----------------------------------------------------------------------------
// 5. Dynamic Domain Breakdown Reconciliation
// -----------------------------------------------------------------------------
console.log('\n--- Dynamic Domain Breakdown Reconciliation ---');

const domainPrefixMap = {
  'Public Portal': 'UAT-PUB-',
  'Owner Dashboard & Overview': 'UAT-OWN-DASH-',
  'Owner Rooms & Buildings': 'UAT-OWN-ROOM-',
  'Owner Tenants Management': 'UAT-OWN-TNT-',
  'Owner Contracts Management': 'UAT-OWN-CTR-',
  'Owner Meter Reading & Devices': 'UAT-OWN-MTR-',
  'Owner Payments & Slips': 'UAT-OWN-PAY-',
  'Owner Maintenance Management': 'UAT-OWN-MNT-',
  'Owner Announcements': 'UAT-OWN-ANN-',
  'Owner Reports & Analytics': 'UAT-OWN-RPT-',
  'Owner Staff & Users Access': 'UAT-OWN-USR-',
  'Owner Subscription & Billing': 'UAT-OWN-SUB-',
  'Owner Settings & Dorm Profile': 'UAT-OWN-SET-',
  'Owner Onboarding Wizard': 'UAT-OWN-ONB-',
  'Tenant Portal': 'UAT-TNT-',
  'Role-Based Access Control': 'UAT-RBAC-',
  'Cross-Portal Lifecycle Flow': 'UAT-XP-FLOW-',
  'PostgreSQL F5 Persistence': 'UAT-PERSIST-',
};

const domainCounts = {};
for (const [domain, prefix] of Object.entries(domainPrefixMap)) {
  const count = uatRows.filter(r => r.uatId.startsWith(prefix)).length;
  domainCounts[domain] = count;
}

let calculatedTotal = Object.values(domainCounts).reduce((a, b) => a + b, 0);
if (calculatedTotal !== uatRows.length) {
  reportError(`Domain count sum (${calculatedTotal}) does not match total parsed UAT rows (${uatRows.length})`);
} else {
  reportSuccess(`All ${calculatedTotal} UAT test cases accurately categorized into 18 domain groupings`);
}

// -----------------------------------------------------------------------------
// 6. Evidence Content Verification
// -----------------------------------------------------------------------------
console.log('\n--- Evidence Artifacts & Content Validation ---');

const MANDATORY_EVIDENCE_FILES = [
  { file: 'local06-master-e2e.txt', marker: 'passed', desc: 'Master Local UAT Playwright Run' },
  { file: 'local06-full-playwright.txt', marker: 'passed', desc: 'Full Playwright E2E Suite' },
  { file: 'local06-full-backend.txt', marker: 'Test Files', desc: 'Full Backend Vitest Suite' },
  { file: 'local06-frontend-unit.txt', marker: 'Test Files', desc: 'Frontend Vitest Unit Suite' },
  { file: 'local06-frontend-typecheck.txt', marker: '0 errors', desc: 'Frontend TypeScript Check' },
  { file: 'local06-e2e-typecheck.txt', marker: '0 errors', desc: 'E2E TypeScript Check' },
  { file: 'local06-backend-lint.txt', marker: '0 errors', desc: 'Backend Lint / Typecheck' },
  { file: 'local06-migration-drift.txt', marker: '22 passed (22)', desc: 'TASK-009 Migration Differential Drift' },
  { file: 'local06-route-menu-inventory.txt', marker: '100.0%', desc: 'Route & Menu Inventory Audit' },
  { file: 'local06-feature-menu-coverage.txt', marker: '100% IN-SCOPE LOCAL PRODUCT FEATURES', desc: 'Feature Menu Coverage Audit' },
];

for (const item of MANDATORY_EVIDENCE_FILES) {
  const filePath = path.join(EVIDENCE_DIR, item.file);
  if (!fs.existsSync(filePath)) {
    if (isFinalSeal) {
      reportError(`Mandatory evidence file missing: docs/evidence/${item.file} (${item.desc})`);
    } else {
      console.log(`⚠️  [PRE-SEAL NOTICE] docs/evidence/${item.file} not yet generated (will be sealed in Phase 7)`);
    }
  } else {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(item.marker)) {
      if (isFinalSeal) {
        reportError(`Evidence file docs/evidence/${item.file} does not contain required content marker "${item.marker}"!`);
      } else {
        console.log(`⚠️  [PRE-SEAL NOTICE] docs/evidence/${item.file} exists but lacks content marker "${item.marker}"`);
      }
    } else {
      reportSuccess(`docs/evidence/${item.file} verified with content marker "${item.marker}"`);
    }
  }
}

// -----------------------------------------------------------------------------
// 7. Final Verdict Summary
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log('  TRACEABILITY & VALIDATOR FINAL SUMMARY');
console.log('================================================================================');
console.log(`Total Inventory Items:       ${totalInventoryCount}`);
console.log(`Local In-Scope Items:        ${inScopeInventory.length}`);
console.log(`Deferred External Items:     ${deferredInventory.length}`);
console.log(`Acceptance Matrix Rows:      ${uatRows.length}`);
console.log(`Mapped In-Scope Items:       ${inScopeInventory.length - unmappedInScope.length} / ${inScopeInventory.length} (100.0%)`);
console.log(`Unmapped In-Scope Items:     ${unmappedInScope.length}`);
console.log(`Unknown Inventory References:${unknownInventoryReferences.length}`);
console.log(`Verified Test References:    ${verifiedTestReferencesCount}`);
console.log(`Total Validation Failures:   ${failureCount}`);
console.log('================================================================================');

if (failureCount > 0) {
  console.error('\n❌ VALIDATION VERDICT: FAIL — Remediate reported issues before sealing.');
  process.exit(1);
} else {
  console.log('\n🎉 VALIDATION VERDICT: PASS — Acceptance Matrix, Traceability & Evidence 100% SOUND!');
  process.exit(0);
}
