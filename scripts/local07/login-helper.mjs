/**
 * HorPlus LOCAL-07 — Login & Session Helper
 * 
 * Provisions deterministic authenticated sessions for all 5 UAT review personas:
 * 1. Fresh Owner (mock_owner_uat_fresh)
 * 2. Comprehensive Owner (mock_owner_uat_comp)
 * 3. Tenant Somchai (mock_tenant_somchai)
 * 4. Staff Manager (mock_manager_uat)
 * 5. Staff Tech (mock_tech_uat)
 * 
 * Generates browser storage states (.local07-sessions/*.json) and direct copy-paste cookies.
 * 
 * @license Apache-2.0
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');

// Explicit Dev/Test runtime gate
if (process.env.NODE_ENV === 'production') {
  throw new Error('CRITICAL SAFETY ERROR: LOCAL-07 session generator refuses execution in production environment!');
}

import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { FRESH_DORM, COMP_DORM, REGISTRATION_OWNER } from './constants.mjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.local07-sessions');

const targetInfo = assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

import { SessionTokenService } from '../../server/src/services/session-token.service.ts';
import { CsrfService } from '../../server/src/services/csrf.service.ts';

// Derive keys strictly from server environment (fail-closed, no hardcoded defaults)
const SESSION_KEY = process.env.SESSION_ENCRYPTION_KEY;
const CSRF_KEY = process.env.CSRF_SIGNING_KEY;

if (!SESSION_KEY || !CSRF_KEY) {
  throw new Error('CRITICAL SECURITY ERROR: SESSION_ENCRYPTION_KEY or CSRF_SIGNING_KEY is missing from environment!');
}

const sessionTokenService = new SessionTokenService(SESSION_KEY);
const csrfService = new CsrfService(CSRF_KEY);

export async function createAllSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const identities = [
    {
      key: 'registration-owner',
      title: '0. Registration Owner (ทดสอบกรอก Onboarding UI ด้วยตนเอง)',
      userId: REGISTRATION_OWNER.id,
      dormId: null,
      userType: 'owner',
      targetPath: '/owner/register',
    },
    {
      key: 'fresh-owner',
      title: '1. Fresh Owner (เพิ่งเสร็จสิ้น Onboarding - Service Oracle)',
      userId: FRESH_DORM.owner.id,
      dormId: FRESH_DORM.id,
      userType: 'owner',
      targetPath: '/owner/dashboard',
    },
    {
      key: 'comp-owner',
      title: '2. Comprehensive Owner (หอพักขนาดเต็ม 18 ห้อง)',
      userId: COMP_DORM.owner.id,
      dormId: COMP_DORM.id,
      userType: 'owner',
      targetPath: '/owner/dashboard',
    },
    {
      key: 'tenant-somchai',
      title: '3. Tenant Somchai (ผู้เช่าห้อง 101 - นายสมชาย ใจดี)',
      userId: COMP_DORM.tenantSomchai.id,
      dormId: COMP_DORM.id,
      userType: 'tenant',
      targetPath: '/tenant/dashboard',
    },
    {
      key: 'manager',
      title: '4. Staff Manager (ผู้จัดการ - นางสาวปราณี)',
      userId: COMP_DORM.manager.id,
      dormId: COMP_DORM.id,
      userType: 'owner',
      targetPath: '/owner/dashboard',
    },
    {
      key: 'tech',
      title: '5. Staff Tech (ช่างเทคนิค - นายสุรชัย)',
      userId: COMP_DORM.tech.id,
      dormId: COMP_DORM.id,
      userType: 'owner',
      targetPath: '/owner/dashboard',
    },
  ];

  const sessionManifest = {};

  console.log('\n================================================================================');
  console.log('  HORPLUS LOCAL-07 — AUTHENTICATED SESSIONS GENERATOR');
  console.log('================================================================================\n');

  for (const id of identities) {
    const member = await prisma.dormitoryMember.findFirst({
      where: { userId: id.userId, status: 'active' },
    });
    const effectiveDormId = member?.dormitoryId || id.dormId;

    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
    const expiresAt = new Date(Date.now() + 86400 * 1000);

    // Save session in DB
    await prisma.session.create({
      data: {
        id: sessionId,
        userId: id.userId,
        sessionIdHash,
        tokenVersion: 1,
        status: 'active',
        expiresAt,
        ipMetadata: '127.0.0.1',
      },
    });

    const sessionToken = sessionTokenService.encryptToken({
      sub: id.userId,
      sid: sessionId,
      type: 'session',
      version: 1,
    }, 86400);

    const csrfToken = csrfService.generateCsrfToken(sessionId);

    // Generate Playwright storage state
    const storageState = {
      cookies: [
        {
          name: 'horplus_session',
          value: sessionToken,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
        {
          name: 'horplus_csrf',
          value: csrfToken,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
        {
          name: 'horplus_session',
          value: sessionToken,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
        {
          name: 'horplus_csrf',
          value: csrfToken,
          domain: 'localhost',
          path: '/',
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [
        {
          origin: 'http://127.0.0.1:5173',
          localStorage: effectiveDormId ? [{ name: 'selected_dormitory_id', value: effectiveDormId }] : [],
        },
        {
          origin: 'http://localhost:5173',
          localStorage: effectiveDormId ? [{ name: 'selected_dormitory_id', value: effectiveDormId }] : [],
        },
      ],
    };

    const filePath = path.join(SESSIONS_DIR, `${id.key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(storageState, null, 2), 'utf8');

    sessionManifest[id.key] = {
      title: id.title,
      userId: id.userId,
      dormitoryId: effectiveDormId,
      sessionToken,
      csrfToken,
      storageStatePath: filePath,
      directUrl: `http://127.0.0.1:5173${id.targetPath}`,
    };

    console.log(`📌 ${id.title}`);
    console.log(`   Session State: .local07-sessions/${id.key}.json`);
    console.log(`   Dormitory ID:  ${effectiveDormId}`);
    console.log(`   Target URL:    http://127.0.0.1:5173${id.targetPath}`);
    console.log(`   Session ID:    ${sessionId.substring(0, 8)}... (active in DB)`);
    console.log('');
  }

  const manifestPath = path.join(SESSIONS_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(sessionManifest, null, 2), 'utf8');

  console.log(`✅ All 5 sessions generated and saved in .local07-sessions/manifest.json\n`);
  await prisma.$disconnect();
  return sessionManifest;
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('login-helper.mjs')) {
  createAllSessions().catch((err) => {
    console.error(`❌ [SESSION GENERATION FAILED] ${err.message}`);
    process.exit(1);
  });
}
