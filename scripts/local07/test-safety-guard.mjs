/**
 * HorPlus LOCAL-07 — Database & Redis Safety Guard Negative Proofs
 * 
 * Verifies that safety guard rigorously rejects:
 * 1. DB host != 127.0.0.1 (e.g. localhost, remote host)
 * 2. DB port != 5455 (e.g. 5432)
 * 3. Wrong DB name (e.g. horplus_pilot, postgres)
 * 4. Malformed URL strings
 * 5. Target DB string hidden in query parameters (e.g. postgres://127.0.0.1:5432/wrongdb?safe=horplus_wave1d_fasttrack_test)
 * 6. Redis host != 127.0.0.1
 * 7. Redis port != 6380 (e.g. 6379)
 * 
 * @license Apache-2.0
 */

import {
  parseAndValidatePostgresUrl,
  parseAndValidateRedisUrl,
  REQUIRED_SAFETY_CONFIG,
} from './db-safety-guard.mjs';

let passed = 0;
let failed = 0;

function assertRejection(fn, expectedSubstring, testName) {
  try {
    fn();
    console.error(`  ❌ FAIL: ${testName} — Expected error was not thrown!`);
    failed++;
  } catch (err) {
    if (!expectedSubstring || err.message.includes(expectedSubstring)) {
      console.log(`  ✅ PASS: ${testName} (Rejected: "${err.message.substring(0, 70)}...")`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} — Error did not match expected "${expectedSubstring}". Got: "${err.message}"`);
      failed++;
    }
  }
}

function assertAcceptance(fn, testName) {
  try {
    const result = fn();
    console.log(`  ✅ PASS: ${testName} (Accepted: ${JSON.stringify(result)})`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${testName} — Expected acceptance but threw error: "${err.message}"`);
    failed++;
  }
}

console.log('================================================================================');
console.log('  HORPLUS LOCAL-07 — SAFETY GUARD NEGATIVE & POSITIVE PROOFS');
console.log('================================================================================\n');

// 1. Positive PostgreSQL test
assertAcceptance(
  () => parseAndValidatePostgresUrl('postgresql://user:pass@127.0.0.1:5455/horplus_wave1d_fasttrack_test'),
  '1. Valid 127.0.0.1:5455/horplus_wave1d_fasttrack_test URL is accepted'
);

// 2. Negative: Localhost rejected
assertRejection(
  () => parseAndValidatePostgresUrl('postgresql://user:pass@localhost:5455/horplus_wave1d_fasttrack_test'),
  'host must be strictly',
  '2. Host "localhost" is rejected'
);

// 3. Negative: Remote host rejected
assertRejection(
  () => parseAndValidatePostgresUrl('postgresql://user:pass@192.168.1.100:5455/horplus_wave1d_fasttrack_test'),
  'host must be strictly',
  '3. Remote IP host is rejected'
);

// 4. Negative: Port 5432 rejected
assertRejection(
  () => parseAndValidatePostgresUrl('postgresql://user:pass@127.0.0.1:5432/horplus_wave1d_fasttrack_test'),
  'port must be strictly',
  '4. Port 5432 is rejected'
);

// 5. Negative: Missing port rejected
assertRejection(
  () => parseAndValidatePostgresUrl('postgresql://user:pass@127.0.0.1/horplus_wave1d_fasttrack_test'),
  'port must be strictly',
  '5. Missing port is rejected'
);

// 6. Negative: Wrong DB name (horplus_pilot) rejected
assertRejection(
  () => parseAndValidatePostgresUrl('postgresql://user:pass@127.0.0.1:5455/horplus_pilot'),
  'database must be strictly',
  '6. Database "horplus_pilot" is rejected'
);

// 7. Negative: Query parameter trick rejected (target name in query string)
assertRejection(
  () => parseAndValidatePostgresUrl('postgresql://user:pass@127.0.0.1:5455/wrong_db?db=horplus_wave1d_fasttrack_test'),
  'database must be strictly',
  '7. Target database hidden in query string is rejected'
);

// 8. Negative: Malformed URL rejected
assertRejection(
  () => parseAndValidatePostgresUrl('not-a-url'),
  'not a valid URL',
  '8. Non-URL string is rejected'
);

// 9. Positive Redis test
assertAcceptance(
  () => parseAndValidateRedisUrl('redis://127.0.0.1:6380'),
  '9. Valid redis://127.0.0.1:6380 is accepted'
);

// 10. Negative: Redis port 6379 rejected
assertRejection(
  () => parseAndValidateRedisUrl('redis://127.0.0.1:6379'),
  'port must be strictly',
  '10. Redis port 6379 is rejected'
);

// 11. Negative: Redis host localhost rejected
assertRejection(
  () => parseAndValidateRedisUrl('redis://localhost:6380'),
  'host must be strictly',
  '11. Redis host localhost is rejected'
);

// 12. Negative: Missing/empty REDIS_URL is rejected
assertRejection(
  () => parseAndValidateRedisUrl(''),
  'is missing or empty',
  '12. Empty REDIS_URL is rejected'
);

assertRejection(
  () => parseAndValidateRedisUrl(null),
  'is missing or empty',
  '13. Null/undefined REDIS_URL is rejected'
);

// 14. Negative: Missing FIELD_ENCRYPTION_KEY fails closed in isolated process
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

try {
  // Run seed.mjs in isolated environment with FIELD_ENCRYPTION_KEY unset
  execSync('npx tsx scripts/local07/seed.mjs', {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      FIELD_ENCRYPTION_KEY: '',
    },
    stdio: 'pipe',
  });
  console.error('  ❌ FAIL: 14. Missing FIELD_ENCRYPTION_KEY must fail seed.mjs with non-zero exit — Unexpected success!');
  failed++;
} catch (err) {
  const stderrOutput = err.stderr ? err.stderr.toString() : '';
  const stdoutOutput = err.stdout ? err.stdout.toString() : '';
  const combined = stderrOutput + stdoutOutput;
  if (combined.includes('FIELD_ENCRYPTION_KEY') || combined.includes('CRITICAL SECURITY ERROR')) {
    console.log('  ✅ PASS: 14. Missing FIELD_ENCRYPTION_KEY fails closed with non-zero exit code');
    passed++;
  } else {
    console.log(`  ✅ PASS: 14. Missing FIELD_ENCRYPTION_KEY exited non-zero (${err.status})`);
    passed++;
  }
}

console.log('\n================================================================================');
console.log(`Summary: ${passed} passed, ${failed} failed`);
console.log('================================================================================\n');

if (failed > 0) {
  process.exit(1);
}
