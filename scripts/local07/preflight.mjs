/**
 * HorPlus LOCAL-07 — Full-Stack UAT Preflight Hardening
 * 
 * Verifies complete stack readiness before manual Product Owner UAT:
 * 1. PostgreSQL (127.0.0.1:5455 / horplus_wave1d_fasttrack_test) - SELECT 1
 * 2. Redis (127.0.0.1:6380) - PING -> PONG
 * 3. API Liveness (http://127.0.0.1:3001/health/liveness) - HTTP 200
 * 4. API Ready (http://127.0.0.1:3001/health/readiness) - HTTP 200, DB & Redis UP
 * 5. Frontend (http://127.0.0.1:5173) - HTTP 200
 * 6. Auth Session API (http://127.0.0.1:5173/api/v1/auth/session) - Proxy reachability (not ECONNREFUSED)
 * 7. UAT Sessions (.local07-sessions/comp-owner.json) - Authenticated Comprehensive Owner session validation
 * 
 * Output Format:
 *   PostgreSQL   PASS
 *   Redis        PASS
 *   API Liveness PASS
 *   API Ready    PASS
 *   Frontend     PASS
 *   Auth Session PASS
 *   UAT Sessions PASS
 * 
 * Exit Code: 0 on success, 1 on any failure.
 * 
 * @license Apache-2.0
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { COMP_DORM } from './constants.mjs';
import { checkRefreshLockState } from './refresh-lock.mjs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
const Redis = require('../../server/node_modules/ioredis/built/index.js').default || require('../../server/node_modules/ioredis');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.local07-sessions');

function httpGet(urlStr, headers = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms connecting to ${urlStr}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

export async function runPreflight(options = {}) {
  const apiPort = options.apiPort || 3001;
  const frontendPort = options.frontendPort || 5173;
  const dbUrl = options.dbUrl || process.env.DIRECT_URL || process.env.DATABASE_URL;
  const redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6380';

  const checks = {
    postgres: false,
    redis: false,
    apiLiveness: false,
    apiReady: false,
    frontend: false,
    authSession: false,
    uatSessions: false,
  };
  const errors = {};

  // Check refresh lock first
  const refreshState = checkRefreshLockState();
  if (refreshState.isLocked) {
    errors.refreshLock = `Active uat:refresh process detected (PID ${refreshState.pid}). Sandbox refresh in progress.`;
  }

  // 1. PostgreSQL Check
  let prisma = null;
  let pgTarget = '';
  try {
    const safety = assertSafeDatabaseTarget();
    pgTarget = `127.0.0.1:${safety.port}/${safety.database}`;
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
    });
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = true;
  } catch (err) {
    errors.postgres = `PostgreSQL check failed on ${pgTarget || 'PostgreSQL'}: ${err.message}`;
  } finally {
    if (prisma) {
      await prisma.$disconnect().catch(() => {});
    }
  }

  // 2. Redis Check
  let redisClient = null;
  try {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6380', {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redisClient.connect();
    const pingRes = await redisClient.ping();
    if (pingRes === 'PONG') {
      checks.redis = true;
    } else {
      errors.redis = `Redis returned unexpected ping response: ${pingRes}`;
    }
  } catch (err) {
    errors.redis = `Redis check failed on 127.0.0.1:6380: ${err.message}`;
  } finally {
    if (redisClient) {
      redisClient.disconnect();
    }
  }

  // 3. API Liveness Check
  try {
    const liveness = await httpGet(`http://127.0.0.1:${apiPort}/health/liveness`, {}, 2000);
    if (liveness.statusCode === 200) {
      const data = JSON.parse(liveness.body);
      if (data.status === 'UP') {
        checks.apiLiveness = true;
      } else {
        errors.apiLiveness = `API liveness returned status: ${data.status}`;
      }
    } else {
      errors.apiLiveness = `API liveness endpoint returned HTTP ${liveness.statusCode}`;
    }
  } catch (err) {
    errors.apiLiveness = `API liveness unreachable on 127.0.0.1:${apiPort}: ${err.message}`;
  }

  // 4. API Ready Check
  try {
    const readiness = await httpGet(`http://127.0.0.1:${apiPort}/health/readiness`, {}, 2000);
    if (readiness.statusCode === 200) {
      const data = JSON.parse(readiness.body);
      if (data.status === 'UP' && data.database === 'UP' && data.redis === 'UP') {
        checks.apiReady = true;
      } else {
        errors.apiReady = `API readiness degraded: DB=${data.database}, Redis=${data.redis}`;
      }
    } else {
      errors.apiReady = `API readiness returned HTTP ${readiness.statusCode} (Dependencies not ready)`;
    }
  } catch (err) {
    errors.apiReady = `API readiness check failed: ${err.message}`;
  }

  // 5. Frontend Check
  try {
    const fe = await httpGet(`http://127.0.0.1:${frontendPort}`, {}, 10000);
    if (fe.statusCode === 200) {
      checks.frontend = true;
    } else {
      errors.frontend = `Frontend returned HTTP ${fe.statusCode}`;
    }
  } catch (err) {
    errors.frontend = `Frontend unreachable on 127.0.0.1:${frontendPort}: ${err.message}`;
  }

  // 6. Auth Session API Check (Via Vite Proxy)
  try {
    const authProxy = await httpGet(`http://127.0.0.1:${frontendPort}/api/v1/auth/session`, {}, 5000);
    // 401 or 200 proves Vite proxied successfully to backend without ECONNREFUSED
    if (authProxy.statusCode === 401 || authProxy.statusCode === 200) {
      checks.authSession = true;
    } else {
      errors.authSession = `Auth session proxy returned unexpected HTTP ${authProxy.statusCode}`;
    }
  } catch (err) {
    errors.authSession = `Auth session proxy failed on http://127.0.0.1:${frontendPort}/api/v1/auth/session: ${err.message}`;
  }

  // 7. UAT Sessions Validation (Comprehensive Owner)
  const sessionFile = path.join(SESSIONS_DIR, 'comp-owner.json');
  try {
    if (!fs.existsSync(sessionFile)) {
      throw new Error(`Session file not found at ${sessionFile}. Run npm run uat:refresh first.`);
    }

    const raw = fs.readFileSync(sessionFile, 'utf8');
    const state = JSON.parse(raw);
    if (!Array.isArray(state.cookies) || state.cookies.length === 0) {
      throw new Error('Session storage state contains no cookies.');
    }

    const sessionCookie = state.cookies.find((c) => c.name === 'horplus_session' && (c.domain === '127.0.0.1' || c.domain === 'localhost'));
    if (!sessionCookie || !sessionCookie.value) {
      throw new Error('Session cookie horplus_session missing in storage state.');
    }

    if (sessionCookie.expires && sessionCookie.expires > 0) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (sessionCookie.expires < nowSeconds) {
        throw new Error('Comprehensive Owner session cookie has expired.');
      }
    }

    // Authenticated probe through Vite proxy
    const cookieHeader = state.cookies
      .filter((c) => c.domain === '127.0.0.1' || c.domain === 'localhost')
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    const probe = await httpGet(`http://127.0.0.1:${frontendPort}/api/v1/auth/session`, { Cookie: cookieHeader }, 3000);
    if (probe.statusCode !== 200) {
      throw new Error(`Authenticated session probe returned HTTP ${probe.statusCode} (Expected 200)`);
    }

    const probeData = JSON.parse(probe.body);
    if (!probeData?.data?.authenticated) {
      throw new Error('Session probe returned unauthenticated.');
    }

    const memberships = probeData.data.memberships || [];
    const hasCompDorm = memberships.some((m) => m.dormitoryId === COMP_DORM.id);
    if (!hasCompDorm) {
      throw new Error(`Comprehensive Owner session does not belong to expected LOCAL-07 dormitory (${COMP_DORM.id}).`);
    }

    checks.uatSessions = true;
  } catch (err) {
    errors.uatSessions = `UAT session validation failed: ${err.message}`;
  }

  const passed = Object.values(checks).every(Boolean) && !errors.refreshLock;

  if (!options.silent) {
    console.log(`PostgreSQL   ${checks.postgres ? `PASS — ${pgTarget}` : 'FAIL'}`);
    console.log(`Redis        ${checks.redis ? 'PASS' : 'FAIL'}`);
    console.log(`API Liveness ${checks.apiLiveness ? 'PASS' : 'FAIL'}`);
    console.log(`API Ready    ${checks.apiReady ? 'PASS' : 'FAIL'}`);
    console.log(`Frontend     ${checks.frontend ? 'PASS' : 'FAIL'}`);
    console.log(`Auth Session ${checks.authSession ? 'PASS' : 'FAIL'}`);
    console.log(`UAT Sessions ${checks.uatSessions ? 'PASS' : 'FAIL'}`);

    if (!passed) {
      console.error('\n--- Preflight Failure Details ---');
      for (const [key, msg] of Object.entries(errors)) {
        console.error(`  ❌ [${key}]: ${msg}`);
      }
      console.error('---------------------------------\n');
    }
  }

  return { passed, checks, errors };
}

// CLI Execution
if (process.argv[1] && (process.argv[1].endsWith('preflight.mjs') || process.argv[1].endsWith('preflight'))) {
  runPreflight()
    .then(({ passed }) => {
      process.exit(passed ? 0 : 1);
    })
    .catch((err) => {
      console.error(`\n❌ Unexpected preflight error: ${err.message}`);
      process.exit(1);
    });
}
