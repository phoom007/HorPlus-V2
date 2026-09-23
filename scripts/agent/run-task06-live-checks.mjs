/**
 * HorPlus Task 06 Live Verification Script
 * Validates AC-1 through AC-8 against live pilot PostgreSQL database and API.
 */

import { execSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://horplus:horplus_dev_secret@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public',
    },
  },
});

function runDockerPsql(sql) {
  try {
    const cmd = `docker exec horplus-v2-db-1 psql -U horplus -d horplus_wave1d_fasttrack_test -c "${sql.replace(/"/g, '\\"')}"`;
    const stdout = execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
    return { success: true, output: stdout.trim() };
  } catch (err) {
    const output = (err.stderr || err.stdout || err.message || '').trim();
    return { success: false, output };
  }
}

async function main() {
  console.log('=== STARTING TASK 06 LIVE CHECKS ===\n');
  const results = {};

  // AC-1: UPDATE on audit_logs blocked by trigger
  console.log('--- Checking AC-1: UPDATE trigger immutability ---');
  const ac1Result = runDockerPsql("UPDATE audit_logs SET action = 'tampered' WHERE id = (SELECT id FROM audit_logs LIMIT 1);");
  console.log('AC-1 raw output:', ac1Result.output);
  const ac1Pass = !ac1Result.success && ac1Result.output.includes('AUDIT_LOG_IMMUTABLE');
  results['AC-1'] = {
    pass: ac1Pass,
    evidence: ac1Result.output.split('\n')[0],
  };
  console.log(`AC-1: ${ac1Pass ? 'PASS' : 'FAIL'}\n`);

  // AC-2: DELETE on audit_logs blocked by trigger
  console.log('--- Checking AC-2: DELETE trigger immutability ---');
  const ac2Result = runDockerPsql("DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs LIMIT 1);");
  console.log('AC-2 raw output:', ac2Result.output);
  const ac2Pass = !ac2Result.success && ac2Result.output.includes('AUDIT_LOG_IMMUTABLE');
  results['AC-2'] = {
    pass: ac2Pass,
    evidence: ac2Result.output.split('\n')[0],
  };
  console.log(`AC-2: ${ac2Pass ? 'PASS' : 'FAIL'}\n`);

  // AC-3: TRUNCATE on audit_logs blocked by trigger
  console.log('--- Checking AC-3: TRUNCATE trigger immutability ---');
  const ac3Result = runDockerPsql("TRUNCATE TABLE audit_logs;");
  console.log('AC-3 raw output:', ac3Result.output);
  const ac3Pass = !ac3Result.success && ac3Result.output.includes('AUDIT_LOG_IMMUTABLE');
  results['AC-3'] = {
    pass: ac3Pass,
    evidence: ac3Result.output.split('\n')[0],
  };
  console.log(`AC-3: ${ac3Pass ? 'PASS' : 'FAIL'}\n`);

  // AC-4: Role horplus_app privileges
  console.log('--- Checking AC-4: App role horplus_app privileges on audit_logs ---');
  const ac4Rows = await prisma.$queryRawUnsafe(`
    SELECT privilege_type 
    FROM information_schema.table_privileges 
    WHERE table_name = 'audit_logs' AND grantee = 'horplus_app';
  `);
  const privs = ac4Rows.map(r => r.privilege_type).sort();
  console.log('AC-4 privileges for horplus_app:', privs);
  const ac4Pass = privs.length === 2 && privs.includes('INSERT') && privs.includes('SELECT') && !privs.includes('UPDATE') && !privs.includes('DELETE') && !privs.includes('TRUNCATE');
  results['AC-4'] = {
    pass: ac4Pass,
    evidence: `Privileges: [${privs.join(', ')}] (NO UPDATE, DELETE, TRUNCATE)`,
  };
  console.log(`AC-4: ${ac4Pass ? 'PASS' : 'FAIL'}\n`);

  // AC-5: Financial mutation audit record
  console.log('--- Checking AC-5: Financial mutation audit record in live DB ---');
  const finRows = await prisma.$queryRawUnsafe(`
    SELECT id, entity_type, action, entity_id, after_values, created_at 
    FROM audit_logs 
    WHERE entity_type = 'PAYMENT' 
    ORDER BY created_at DESC 
    LIMIT 1;
  `);
  console.log('AC-5 latest payment audit row:', finRows[0]);
  const ac5Pass = finRows.length > 0 && finRows[0].entity_type === 'PAYMENT';
  results['AC-5'] = {
    pass: ac5Pass,
    evidence: finRows.length > 0 ? `id=${finRows[0].id}, action=${finRows[0].action}, entityId=${finRows[0].entity_id}` : 'NONE',
  };
  console.log(`AC-5: ${ac5Pass ? 'PASS' : 'FAIL'}\n`);

  // AC-6: Permissions mutation audit record
  console.log('--- Checking AC-6: Permissions mutation audit record in live DB ---');
  const permRows = await prisma.$queryRawUnsafe(`
    SELECT id, entity_type, action, entity_id, after_values, created_at 
    FROM audit_logs 
    WHERE entity_type = 'DormitoryAccessGrant' 
    ORDER BY created_at DESC 
    LIMIT 1;
  `);
  console.log('AC-6 latest grant audit row:', permRows[0]);
  const ac6Pass = permRows.length > 0 && permRows[0].entity_type === 'DormitoryAccessGrant';
  results['AC-6'] = {
    pass: ac6Pass,
    evidence: permRows.length > 0 ? `id=${permRows[0].id}, action=${permRows[0].action}, entityId=${permRows[0].entity_id}` : 'NONE',
  };
  console.log(`AC-6: ${ac6Pass ? 'PASS' : 'FAIL'}\n`);

  // AC-7: Contracts & Approvals mutation audit record
  console.log('--- Checking AC-7: Contracts & Approvals mutation audit records in live DB ---');
  const ctrRows = await prisma.$queryRawUnsafe(`
    SELECT id, entity_type, action, entity_id, after_values, created_at 
    FROM audit_logs 
    WHERE entity_type IN ('Contract', 'TenantRegistrationRequest') 
    ORDER BY created_at DESC 
    LIMIT 2;
  `);
  console.log('AC-7 latest contract/approval audit rows:', ctrRows);
  const ac7Pass = ctrRows.length >= 2;
  results['AC-7'] = {
    pass: ac7Pass,
    evidence: ctrRows.map(r => `${r.entity_type}:${r.action}(${r.entity_id})`).join('; '),
  };
  console.log(`AC-7: ${ac7Pass ? 'PASS' : 'FAIL'}\n`);

  // AC-8: Security / Redaction
  console.log('--- Checking AC-8: Redaction of sensitive fields in audit values ---');
  // Insert test mutation with sensitive payload
  const dorm = await prisma.dormitory.findFirst({ select: { id: true } });
  const { auditService } = await import('../../server/dist/services/audit.service.js');
  const sanitizedRow = await auditService.recordMutation({
    dormitoryId: dorm.id,
    action: 'TEST_REDACTION_VERIFICATION',
    entityType: 'SECURITY_TEST',
    entityId: 'sec-test-888',
    beforeValues: {
      password: 'plain-password-123',
      userToken: 'token-xyz-secret',
      nested: { secretKey: 'do-not-reveal', apiKey: 'api-key-999' },
      credentials: { raw: 'data' }
    },
    afterValues: {
      authToken: 'token-abc',
      safeField: 'visible-data'
    }
  });

  const persistedRow = await prisma.auditLog.findUnique({ where: { id: sanitizedRow.id } });
  console.log('AC-8 persisted before_values:', persistedRow.beforeValues);
  console.log('AC-8 persisted after_values:', persistedRow.afterValues);

  const beforeVal = persistedRow.beforeValues;
  const afterVal = persistedRow.afterValues;

  const ac8Pass = 
    beforeVal.password === '[REDACTED]' &&
    beforeVal.userToken === '[REDACTED]' &&
    beforeVal.nested.secretKey === '[REDACTED]' &&
    beforeVal.nested.apiKey === '[REDACTED]' &&
    beforeVal.credentials === '[REDACTED]' &&
    afterVal.authToken === '[REDACTED]' &&
    afterVal.safeField === 'visible-data';

  results['AC-8'] = {
    pass: ac8Pass,
    evidence: `password=${beforeVal.password}, userToken=${beforeVal.userToken}, secretKey=${beforeVal.nested.secretKey}, safeField=${afterVal.safeField}`,
  };
  console.log(`AC-8: ${ac8Pass ? 'PASS' : 'FAIL'}\n`);

  console.log('=== TASK 06 LIVE CHECK RESULTS SUMMARY ===');
  console.table(results);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Check failed with error:', err);
  process.exit(1);
});
