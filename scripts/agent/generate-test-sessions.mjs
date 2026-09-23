/**
 * HorPlus Agent Helper - Test Session Generator for 4 Roles
 *
 * Requirements:
 * - Reads DATABASE_URL and encryption keys from server/.env.
 * - Refuses any database not listed in runtime.md (127.0.0.1:15555/horplus_wave1d_fasttrack_test).
 * - Generates valid sessions for Owner, Manager, Staff (Tech), Tenant.
 * - Does not revoke or delete existing grants or data.
 * - Writes cookies and storage states to .agents/local/ (git-ignored).
 * - Prints links for https://app.hor-plus.com.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const LOCAL_DIR = path.join(ROOT_DIR, '.agents/local');
const SESSIONS_DIR = path.join(LOCAL_DIR, 'sessions');

// Load environment variables from server/.env
const envPath = path.join(ROOT_DIR, 'server/.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ server/.env not found');
  process.exit(1);
}
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const DATABASE_URL = envConfig.DATABASE_URL || process.env.DATABASE_URL;
const DIRECT_URL = envConfig.DIRECT_URL || process.env.DIRECT_URL || DATABASE_URL;
const SESSION_KEY = envConfig.SESSION_ENCRYPTION_KEY || process.env.SESSION_ENCRYPTION_KEY;
const CSRF_KEY = envConfig.CSRF_SIGNING_KEY || process.env.CSRF_SIGNING_KEY;

if (!SESSION_KEY || !CSRF_KEY) {
  console.error('❌ SESSION_ENCRYPTION_KEY or CSRF_SIGNING_KEY missing from environment');
  process.exit(1);
}

// Hard safety gate: must match runtime.md pilot database
const parsedDb = new URL(DATABASE_URL);
const targetHost = parsedDb.hostname;
const targetPort = parsedDb.port;
const targetDb = parsedDb.pathname.replace(/^\//, '');

if (targetHost !== '127.0.0.1' || targetPort !== '15555' || targetDb !== 'horplus_wave1d_fasttrack_test') {
  console.error(`❌ CRITICAL SAFETY ERROR: Target database ${targetHost}:${targetPort}/${targetDb} is NOT the allowed pilot database (127.0.0.1:15555/horplus_wave1d_fasttrack_test)!`);
  process.exit(1);
}

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function hashSessionId(sessionId) {
  return crypto.createHash('sha256').update(`horplus_sid_${sessionId}`).digest('hex');
}

function encryptSessionToken(payload, secretKey, ttlSeconds = 86400 * 7) {
  const key = deriveKey(secretKey);
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(fullPayload);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function generateCsrfToken(sessionId, csrfKey) {
  const key = deriveKey(csrfKey);
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', key).update(`${sessionId}.${nonce}`).digest('hex');
  return `${nonce}.${signature}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: DIRECT_URL },
  },
});

const ROLES_TO_PROVISION = [
  {
    role: 'Owner',
    key: 'owner',
    userId: '20000002-0000-4000-8000-000000000002',
    email: 'owner.comp@horplus-uat.local',
    name: 'เจ้าของทดสอบ Comprehensive Owner',
    targetPath: '/owner/dashboard',
  },
  {
    role: 'Manager',
    key: 'manager',
    userId: '20000003-0000-4000-8000-000000000003',
    email: 'manager@horplus-uat.local',
    name: 'นางสาวปราณี ผู้จัดการ',
    targetPath: '/owner/dashboard',
  },
  {
    role: 'Staff',
    key: 'staff',
    userId: '20000004-0000-4000-8000-000000000004',
    email: 'tech@horplus-uat.local',
    name: 'นายสุรชัย ช่างเทคนิค',
    targetPath: '/owner/dashboard',
  },
  {
    role: 'Tenant',
    key: 'tenant',
    userId: '20000005-0000-4000-8000-000000000005',
    email: 'tenant.somchai@horplus-uat.local',
    name: 'นายสมชาย ใจดี',
    targetPath: '/tenant/dashboard',
  },
];

const COMP_DORM_ID = '20000001-0000-4000-8000-000000000002';
const DORM_NAME = 'หอพัก HorPlus UAT Comprehensive Manor';

async function main() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  console.log(`\n============================================================`);
  console.log(`  HorPlus Agent - Generating Test Sessions for 4 Roles`);
  console.log(`  Database: ${targetHost}:${targetPort}/${targetDb}`);
  console.log(`============================================================\n`);

  const results = [];

  for (const item of ROLES_TO_PROVISION) {
    const user = await prisma.user.findUnique({
      where: { id: item.userId },
    });
    if (!user) {
      console.error(`⚠️ User ${item.name} (${item.userId}) not found in DB!`);
      continue;
    }

    const sessionId = crypto.randomUUID();
    const sessionIdHash = hashSessionId(sessionId);
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000); // 7 days

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        sessionIdHash,
        tokenVersion: 1,
        status: 'active',
        expiresAt,
        ipMetadata: '127.0.0.1',
        principalType: 'GOOGLE_USER',
      },
    });

    const sessionToken = encryptSessionToken(
      {
        sub: user.id,
        sid: sessionId,
        type: 'session',
        version: 1,
      },
      SESSION_KEY,
      7 * 86400
    );

    const csrfToken = generateCsrfToken(sessionId, CSRF_KEY);

    // Build storageState for Playwright / browser injection
    const domains = ['app.hor-plus.com', '127.0.0.1', 'localhost'];
    const cookies = [];
    for (const d of domains) {
      cookies.push(
        {
          name: 'horplus_session',
          value: sessionToken,
          domain: d,
          path: '/',
          httpOnly: true,
          secure: d.startsWith('app.hor-plus.com'),
          sameSite: 'Lax',
        },
        {
          name: 'horplus_csrf',
          value: csrfToken,
          domain: d,
          path: '/',
          httpOnly: false,
          secure: d.startsWith('app.hor-plus.com'),
          sameSite: 'Lax',
        }
      );
    }

    const storageState = {
      cookies,
      origins: [
        {
          origin: 'https://app.hor-plus.com',
          localStorage: [{ name: 'selected_dormitory_id', value: COMP_DORM_ID }],
        },
        {
          origin: 'http://127.0.0.1:5173',
          localStorage: [{ name: 'selected_dormitory_id', value: COMP_DORM_ID }],
        },
      ],
    };

    const sessionFilePath = path.join(SESSIONS_DIR, `${item.key}.json`);
    fs.writeFileSync(sessionFilePath, JSON.stringify(storageState, null, 2), 'utf8');

    results.push({
      ...item,
      sessionId,
      sessionToken,
      csrfToken,
      sessionFilePath,
      directUrl: `https://app.hor-plus.com${item.targetPath}`,
    });

    console.log(`✅ [${item.role}] ${item.name} (${item.email})`);
    console.log(`   URL: ${`https://app.hor-plus.com${item.targetPath}`}`);
    console.log(`   Session State: .agents/local/sessions/${item.key}.json\n`);
  }

  // Write .agents/local/test-access.md
  let accessDoc = `# Test Access for HorPlus Roles (Local only, git-ignored)\n\n`;
  accessDoc += `Generated: ${new Date().toISOString()}\n`;
  accessDoc += `Dormitory: ${DORM_NAME} (\`${COMP_DORM_ID}\`)\n\n`;

  accessDoc += `| Role | Name | Email | Direct URL | StorageState File |\n`;
  accessDoc += `|---|---|---|---|---|\n`;
  for (const r of results) {
    accessDoc += `| ${r.role} | ${r.name} | ${r.email} | [${r.role} Dashboard](${r.directUrl}) | \`.agents/local/sessions/${r.key}.json\` |\n`;
  }

  accessDoc += `\n## Session Details & Tokens\n\n`;
  for (const r of results) {
    accessDoc += `### ${r.role}: ${r.name} (${r.email})\n`;
    accessDoc += `- **Target URL**: \`${r.directUrl}\`\n`;
    accessDoc += `- **Cookie (horplus_session)**:\n\`\`\`\n${r.sessionToken}\n\`\`\`\n`;
    accessDoc += `- **CSRF Token (horplus_csrf)**:\n\`\`\`\n${r.csrfToken}\n\`\`\`\n`;
    accessDoc += `- **Quick API Verification**:\n\`\`\`bash\ncurl.exe -s -b "horplus_session=${r.sessionToken}" https://app.hor-plus.com/api/v1/users/me\n\`\`\`\n\n`;
  }

  const accessDocPath = path.join(LOCAL_DIR, 'test-access.md');
  fs.writeFileSync(accessDocPath, accessDoc, 'utf8');
  console.log(`📄 Saved credentials to .agents/local/test-access.md\n`);
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
