import * as fs from 'fs';

const logPath = 'C:\\Users\\phoom\\.gemini\\antigravity\\brain\\0948dd5a-0a64-4282-b04b-4e09ff06f118\\.system_generated\\tasks\\task-41349.log';
const content = fs.readFileSync(logPath, 'utf-8');
const lines = content.split('\n');

console.log('Total log lines:', lines.length);
const matching = lines.filter(l => 
  l.includes('tenant-registration') || 
  l.includes('tenant_registration') || 
  l.includes('CreateTenantRegistrationSchema') ||
  l.includes('VALIDATION_ERROR') ||
  l.includes('TERMS_NOT_ACCEPTED') ||
  l.includes('SIGNATURE_REQUIRED') ||
  l.includes('DORMITORY_ID_REQUIRED') ||
  l.includes('POST /api/v1/tenant-registrations')
);

console.log('Matching log lines count:', matching.length);
for (const m of matching.slice(-20)) {
  console.log(m);
}
