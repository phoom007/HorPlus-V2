#!/usr/bin/env node
/**
 * HorPlus LOCAL-06 — Validator & Generator Soundness Negative Proofs Test Suite
 * 
 * Verifies that the acceptance matrix validator and route reconciliation generator
 * strictly reject and fail (exit code 1) on:
 * 1. Duplicate Inventory ID (INV-*)
 * 2. Duplicate UAT ID (UAT-*)
 * 3. Unknown Inventory Reference in matrix
 * 4. Missing exact test title in spec file
 * 5. Bare spec reference without "::" format
 * 6. Signoff document total or domain breakdown mismatch
 * 7. Discovered source route without inventory declaration
 * 8. Declared in-scope inventory route absent from source
 * 
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('================================================================================');
console.log('  HORPLUS LOCAL-06 — VALIDATOR SOUNDNESS NEGATIVE PROOFS TEST SUITE');
console.log('================================================================================');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, testFn) {
  process.stdout.write(`Testing: ${testName} ... `);
  try {
    testFn();
    console.log('✅ PASS (Negative assertion satisfied)');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    failedTests++;
  }
}

const VALIDATOR_SCRIPT = path.join(ROOT_DIR, 'scripts/verify-local06-acceptance-matrix.mjs');
const GENERATOR_SCRIPT = path.join(ROOT_DIR, 'scripts/generate-route-menu-evidence.mjs');

// Helper to create disposable sandbox
function createSandbox() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'horplus-soundness-test-'));
  
  // Copy docs and scripts structure
  const docsDir = path.join(tempDir, 'docs/uat');
  const evidenceDir = path.join(tempDir, 'docs/evidence');
  const scriptsDir = path.join(tempDir, 'scripts');
  const srcPagesDir = path.join(tempDir, 'src/pages');
  const testsE2eDir = path.join(tempDir, 'tests/e2e');
  
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(srcPagesDir, { recursive: true });
  fs.mkdirSync(testsE2eDir, { recursive: true });

  fs.copyFileSync(path.join(ROOT_DIR, 'docs/uat/local06-feature-menu-inventory.md'), path.join(docsDir, 'local06-feature-menu-inventory.md'));
  fs.copyFileSync(path.join(ROOT_DIR, 'docs/uat/local06-master-acceptance-matrix.md'), path.join(docsDir, 'local06-master-acceptance-matrix.md'));
  fs.copyFileSync(path.join(ROOT_DIR, 'docs/uat/local06-final-local-product-signoff.md'), path.join(docsDir, 'local06-final-local-product-signoff.md'));

  // Copy evidence files
  const evFiles = fs.readdirSync(path.join(ROOT_DIR, 'docs/evidence'));
  for (const f of evFiles) {
    fs.copyFileSync(path.join(ROOT_DIR, 'docs/evidence', f), path.join(evidenceDir, f));
  }

  // Copy scripts
  fs.copyFileSync(VALIDATOR_SCRIPT, path.join(scriptsDir, 'verify-local06-acceptance-matrix.mjs'));
  fs.copyFileSync(GENERATOR_SCRIPT, path.join(scriptsDir, 'generate-route-menu-evidence.mjs'));

  // Copy src files needed for inspection
  fs.copyFileSync(path.join(ROOT_DIR, 'src/App.tsx'), path.join(tempDir, 'src/App.tsx'));
  fs.copyFileSync(path.join(ROOT_DIR, 'src/pages/owner.tsx'), path.join(tempDir, 'src/pages/owner.tsx'));
  fs.copyFileSync(path.join(ROOT_DIR, 'src/pages/tenant.tsx'), path.join(tempDir, 'src/pages/tenant.tsx'));

  // Copy tests/e2e/local06-master-local-uat.spec.ts
  fs.copyFileSync(path.join(ROOT_DIR, 'tests/e2e/local06-master-local-uat.spec.ts'), path.join(testsE2eDir, 'local06-master-local-uat.spec.ts'));

  return tempDir;
}

function cleanupSandbox(tempDir) {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}

// -----------------------------------------------------------------------------
// Test 1: Duplicate Inventory ID Detection
// -----------------------------------------------------------------------------
runTest('Validator fails on duplicate Inventory ID (INV-*)', () => {
  const sb = createSandbox();
  try {
    const invPath = path.join(sb, 'docs/uat/local06-feature-menu-inventory.md');
    let content = fs.readFileSync(invPath, 'utf8');
    // Duplicate the first row
    content = content.replace(
      '| **INV-PUB-001** |',
      '| **INV-PUB-001** | PUBLIC | Public Site | Landing Page | `/` | Main | Extra duplicate | View | Read | PUBLIC | Static | Public | NO | None | YES | NONE | IN_SCOPE |\n| **INV-PUB-001** |'
    );
    fs.writeFileSync(invPath, content, 'utf8');

    let failed = false;
    let output = '';
    try {
      execSync(`node "${path.join(sb, 'scripts/verify-local06-acceptance-matrix.mjs')}"`, { cwd: sb, stdio: 'pipe' });
    } catch (err) {
      failed = true;
      output = err.stdout.toString() + err.stderr.toString();
    }

    if (!failed) throw new Error('Validator did NOT fail on duplicate Inventory ID');
    if (!output.includes('Duplicate Inventory ID detected')) throw new Error(`Missing expected error message, got: ${output}`);
  } finally {
    cleanupSandbox(sb);
  }
});

// -----------------------------------------------------------------------------
// Test 2: Duplicate UAT ID Detection
// -----------------------------------------------------------------------------
runTest('Validator fails on duplicate UAT ID (UAT-*)', () => {
  const sb = createSandbox();
  try {
    const matrixPath = path.join(sb, 'docs/uat/local06-master-acceptance-matrix.md');
    let content = fs.readFileSync(matrixPath, 'utf8');
    // Duplicate UAT-PUB-001 row
    content = content.replace(
      '| **UAT-PUB-001** |',
      '| **UAT-PUB-001** | INV-PUB-001 | PUBLIC | Landing Page | `/` | Duplicate | None | Nav | Displays | 200 | N/A | None | Displays | Allowed | Mobile | `tests/e2e/local06-master-local-uat.spec.ts` :: `UAT-PUB-001: Public Landing Page renders hero and value props` | PASS |\n| **UAT-PUB-001** |'
    );
    fs.writeFileSync(matrixPath, content, 'utf8');

    let failed = false;
    let output = '';
    try {
      execSync(`node "${path.join(sb, 'scripts/verify-local06-acceptance-matrix.mjs')}"`, { cwd: sb, stdio: 'pipe' });
    } catch (err) {
      failed = true;
      output = err.stdout.toString() + err.stderr.toString();
    }

    if (!failed) throw new Error('Validator did NOT fail on duplicate UAT ID');
    if (!output.includes('Duplicate UAT ID detected')) throw new Error(`Missing expected error message, got: ${output}`);
  } finally {
    cleanupSandbox(sb);
  }
});

// -----------------------------------------------------------------------------
// Test 3: Unknown Inventory Reference Detection
// -----------------------------------------------------------------------------
runTest('Validator fails on unknown Inventory ID reference in matrix', () => {
  const sb = createSandbox();
  try {
    const matrixPath = path.join(sb, 'docs/uat/local06-master-acceptance-matrix.md');
    let content = fs.readFileSync(matrixPath, 'utf8');
    content = content.replace('INV-PUB-001', 'INV-UNKNOWN-999');
    fs.writeFileSync(matrixPath, content, 'utf8');

    let failed = false;
    let output = '';
    try {
      execSync(`node "${path.join(sb, 'scripts/verify-local06-acceptance-matrix.mjs')}"`, { cwd: sb, stdio: 'pipe' });
    } catch (err) {
      failed = true;
      output = err.stdout.toString() + err.stderr.toString();
    }

    if (!failed) throw new Error('Validator did NOT fail on unknown Inventory reference');
    if (!output.includes('references unknown Inventory ID')) throw new Error(`Missing expected error message, got: ${output}`);
  } finally {
    cleanupSandbox(sb);
  }
});

// -----------------------------------------------------------------------------
// Test 4: Missing Exact Test Title in Spec Reference
// -----------------------------------------------------------------------------
runTest('Validator fails on missing exact test title in referenced spec', () => {
  const sb = createSandbox();
  try {
    const matrixPath = path.join(sb, 'docs/uat/local06-master-acceptance-matrix.md');
    let content = fs.readFileSync(matrixPath, 'utf8');
    content = content.replace(
      'UAT-PUB-001: Public Landing Page renders hero and value props',
      'NON_EXISTENT_TEST_TITLE_FOR_LANDING_PAGE_12345'
    );
    fs.writeFileSync(matrixPath, content, 'utf8');

    let failed = false;
    let output = '';
    try {
      execSync(`node "${path.join(sb, 'scripts/verify-local06-acceptance-matrix.mjs')}"`, { cwd: sb, stdio: 'pipe' });
    } catch (err) {
      failed = true;
      output = err.stdout.toString() + err.stderr.toString();
    }

    if (!failed) throw new Error('Validator did NOT fail on missing test title');
    if (!output.includes('not found as declared test in')) throw new Error(`Missing expected error message, got: ${output}`);
  } finally {
    cleanupSandbox(sb);
  }
});

// -----------------------------------------------------------------------------
// Test 5: Bare Spec Reference Without "::" Test Title
// -----------------------------------------------------------------------------
runTest('Validator fails on bare spec reference without exact "::" test title', () => {
  const sb = createSandbox();
  try {
    const matrixPath = path.join(sb, 'docs/uat/local06-master-acceptance-matrix.md');
    let content = fs.readFileSync(matrixPath, 'utf8');
    content = content.replace(
      '`tests/e2e/local06-master-local-uat.spec.ts` :: `UAT-PUB-001: Public Landing Page renders hero and value props`',
      '`tests/e2e/local06-master-local-uat.spec.ts`'
    );
    fs.writeFileSync(matrixPath, content, 'utf8');

    let failed = false;
    let output = '';
    try {
      execSync(`node "${path.join(sb, 'scripts/verify-local06-acceptance-matrix.mjs')}"`, { cwd: sb, stdio: 'pipe' });
    } catch (err) {
      failed = true;
      output = err.stdout.toString() + err.stderr.toString();
    }

    if (!failed) throw new Error('Validator did NOT fail on bare spec reference');
    if (!output.includes('Bare spec reference without exact test title')) throw new Error(`Missing expected error message, got: ${output}`);
  } finally {
    cleanupSandbox(sb);
  }
});

// -----------------------------------------------------------------------------
// Test 6: Signoff Document Mismatch Detection
// -----------------------------------------------------------------------------
runTest('Validator fails on signoff document total / count mismatch', () => {
  const sb = createSandbox();
  try {
    const signoffPath = path.join(sb, 'docs/uat/local06-final-local-product-signoff.md');
    let content = fs.readFileSync(signoffPath, 'utf8');
    content = content.replace('| **TOTAL PRODUCT SCOPE** | **87** |', '| **TOTAL PRODUCT SCOPE** | **99** |');
    fs.writeFileSync(signoffPath, content, 'utf8');

    let failed = false;
    let output = '';
    try {
      execSync(`node "${path.join(sb, 'scripts/verify-local06-acceptance-matrix.mjs')}"`, { cwd: sb, stdio: 'pipe' });
    } catch (err) {
      failed = true;
      output = err.stdout.toString() + err.stderr.toString();
    }

    if (!failed) throw new Error('Validator did NOT fail on signoff total mismatch');
    if (!output.includes('Signoff Total Items') && !output.includes('does not match')) throw new Error(`Missing expected error message, got: ${output}`);
  } finally {
    cleanupSandbox(sb);
  }
});

// -----------------------------------------------------------------------------
// Test 7: Generator Fails on Unmapped Source Route
// -----------------------------------------------------------------------------
runTest('Route Generator fails when source route has no inventory declaration', () => {
  const sb = createSandbox();
  try {
    const appPath = path.join(sb, 'src/App.tsx');
    let content = fs.readFileSync(appPath, 'utf8');
    content = content.replace(
      '<Route path="/features"',
      '<Route path="/unmapped-secret-feature" element={<FeaturesPage />} />\n        <Route path="/features"'
    );
    fs.writeFileSync(appPath, content, 'utf8');

    let failed = false;
    let output = '';
    try {
      execSync(`node "${path.join(sb, 'scripts/generate-route-menu-evidence.mjs')}"`, { cwd: sb, stdio: 'pipe' });
    } catch (err) {
      failed = true;
      output = err.stdout.toString() + err.stderr.toString();
    }

    if (!failed) throw new Error('Generator did NOT fail on unmapped source route');
    if (!output.includes('Missing from Inventory: 1')) throw new Error(`Missing expected error message, got: ${output}`);
  } finally {
    cleanupSandbox(sb);
  }
});

// -----------------------------------------------------------------------------
// Test 8: Generator Fails on Declared Inventory Route Absent in Source
// -----------------------------------------------------------------------------
runTest('Route Generator fails when declared in-scope inventory route is absent in source', () => {
  const sb = createSandbox();
  try {
    const invPath = path.join(sb, 'docs/uat/local06-feature-menu-inventory.md');
    let content = fs.readFileSync(invPath, 'utf8');
    content = content.replace(
      '| **INV-PUB-002** | PUBLIC | Public Site | Features Page | `/features` |',
      '| **INV-PUB-002** | PUBLIC | Public Site | Features Page | `/non-existent-features-page` |'
    );
    fs.writeFileSync(invPath, content, 'utf8');

    let failed = false;
    let output = '';
    try {
      execSync(`node "${path.join(sb, 'scripts/generate-route-menu-evidence.mjs')}"`, { cwd: sb, stdio: 'pipe' });
    } catch (err) {
      failed = true;
      output = err.stdout.toString() + err.stderr.toString();
    }

    if (!failed) throw new Error('Generator did NOT fail on absent in-scope inventory route');
    if (!output.includes('Missing from Source: 1')) throw new Error(`Missing expected error message, got: ${output}`);
  } finally {
    cleanupSandbox(sb);
  }
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n================================================================================');
console.log(`NEGATIVE PROOFS TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('================================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
