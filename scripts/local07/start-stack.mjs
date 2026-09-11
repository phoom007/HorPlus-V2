/**
 * HorPlus LOCAL-07 — Single UAT Runtime Stack Starter
 * 
 * Runtime-only orchestrator:
 * 1. Checks mutual-exclusion lock (.local07-refresh.lock)
 * 2. Validates session state exists (fails with guidance to run uat:refresh if absent)
 * 3. Ensures Docker DB & Redis are running (uat:infra:up) and healthy
 * 4. Detects existing healthy API on 3001 (reuses it) or starts it
 * 5. Detects existing healthy Frontend on 5173 (reuses it) or starts it
 * 6. Executes full-stack preflight verification
 * 7. Reports ready for manual UAT (browser launch remains explicit via uat:open:owner)
 * 
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import net from 'net';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertNoActiveRefresh } from './refresh-lock.mjs';
import { assertSafeDatabaseTarget, getConfiguredDbPort } from './db-safety-guard.mjs';
import { runPreflight } from './preflight.mjs';

function isPortReachable(port, host = '127.0.0.1', timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isConnected = false;

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      isConnected = true;
      socket.end();
      resolve(true);
    });

    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.local07-sessions');

function httpGet(urlStr, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
      }
    );
    req.on('error', () => resolve({ ok: false, error: 'connection refused' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end();
  });
}

async function waitForEndpoint(urlStr, maxWaitSeconds = 30, intervalMs = 1000) {
  const start = Date.now();
  while ((Date.now() - start) < maxWaitSeconds * 1000) {
    const res = await httpGet(urlStr, 1000);
    if (res.ok) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function detectAndHandleLegacyStack() {
  try {
    const runningContainers = execSync('docker ps --format "{{.Names}}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const legacyNames = ['horplus_api', 'horplus_postgres', 'horplus_redis'];
    const activeLegacy = legacyNames.filter((name) => runningContainers.includes(name));

    if (activeLegacy.length > 0) {
      console.warn('\n⚠️  [POLICY WARNING] Legacy HorPlus Docker stack detected.');
      console.warn('   Current HORPLUS-V2 UAT uses strictly horplus-v2-db-1 and horplus-v2-redis-1.');
      console.warn(`   Active legacy containers: ${activeLegacy.join(', ')}`);
      console.warn('   Per Product Owner policy, tooling does not kill legacy stacks implicitly.');
      console.warn('   If port or resource conflicts occur, please stop the legacy stack manually:');
      console.warn(`     docker stop ${activeLegacy.join(' ')}\n`);
    }
  } catch (err) {
    // Docker command may fail if docker is not running; handled below
  }
}

async function main() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — UAT RUNTIME STACK STARTER');
  console.log('================================================================================\n');

  // 1. Refresh Mutual Exclusion Guard
  assertNoActiveRefresh('UAT Stack Starter');

  // 2. Legacy HorPlus Stack Detection & Safe Resolution
  detectAndHandleLegacyStack();

  // 3. Runtime-only gate: verify session files exist
  const sessionFile = path.join(SESSIONS_DIR, 'comp-owner.json');
  if (!fs.existsSync(sessionFile)) {
    console.error('❌ UAT START ABORTED: Missing required LOCAL-07 session state (.local07-sessions/comp-owner.json).');
    console.error('   uat:start is runtime-only and does not modify database fixtures or regenerate sessions.');
    console.error('   Please run: npm run uat:refresh first to seed the sandbox.\n');
    process.exit(1);
  }

  // 4. Ensure Docker Infrastructure
  const dbPort = getConfiguredDbPort();
  console.log(`📦 [1/4] Ensuring Docker PostgreSQL (${dbPort}) & Redis (6380) infrastructure...`);
  const dbReachable = await isPortReachable(Number(dbPort));
  const redisReachable = await isPortReachable(6380);

  if (dbReachable && redisReachable) {
    console.log(`   ✅ PostgreSQL (${dbPort}) and Redis (6380) are already running and reachable.`);
  } else {
    try {
      execSync('docker compose -f docker-compose.windows-pilot.yml up -d db redis', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    } catch (err) {
      console.error(`❌ Failed to start Docker infrastructure: ${err.message}`);
      process.exit(1);
    }
  }

  // Wait for PostgreSQL to accept connections
  let dbReady = false;
  for (let i = 0; i < 30; i++) {
    if (await isPortReachable(Number(dbPort))) {
      dbReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!dbReady) {
    console.error(`❌ PostgreSQL failed to become reachable on port ${dbPort} within 30 seconds.`);
    process.exit(1);
  }

  // Run DB Safety Guard to ensure target is safe
  const safety = assertSafeDatabaseTarget();
  console.log(`   🛡️ Database safety target verified: ${safety.host}:${safety.port}/${safety.database}`);

  // 5. Check / Start Backend API (Port 3001)
  console.log('\n⚙️  [2/4] Checking Backend API on port 3001...');
  const apiCheck = await httpGet('http://127.0.0.1:3001/health/liveness');
  let apiChild = null;

  if (apiCheck.ok) {
    console.log('   ✅ Existing healthy HorPlus API detected on port 3001. Reusing.');
  } else {
    console.log('   Starting Backend API server on port 3001...');
    apiChild = spawn('npm.cmd', ['--prefix', 'server', 'run', 'dev'], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: 'ignore',
      detached: false,
    });

    const apiReady = await waitForEndpoint('http://127.0.0.1:3001/health/liveness', 60);
    if (!apiReady) {
      console.error('❌ Backend API failed to become ready on http://127.0.0.1:3001 within 60 seconds.');
      if (apiChild) apiChild.kill();
      process.exit(1);
    }
    console.log('   ✅ Backend API server is ready.');
  }

  // 5. Check / Start Frontend (Port 5173)
  console.log('\n🖥️  [3/4] Checking Frontend on port 5173...');
  const feCheck = await httpGet('http://127.0.0.1:5173');
  let feChild = null;

  if (feCheck.ok) {
    console.log('   ✅ Existing healthy Frontend detected on port 5173. Reusing.');
  } else {
    console.log('   Starting Frontend dev server on port 5173...');
    feChild = spawn('npx.cmd', ['vite', '--port=5173', '--host=0.0.0.0'], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: 'ignore',
      detached: false,
    });

    const feReady = await waitForEndpoint('http://127.0.0.1:5173', 20);
    if (!feReady) {
      console.error('❌ Frontend failed to become ready on http://127.0.0.1:5173 within 20 seconds.');
      if (feChild) feChild.kill();
      process.exit(1);
    }
    console.log('   ✅ Frontend dev server is ready.');
  }

  // Allow servers to settle before running preflight
  await new Promise((r) => setTimeout(r, 2500));

  // 6. Full-Stack Preflight
  console.log('\n🔍 [4/4] Executing full-stack UAT preflight...\n');
  const preflight = await runPreflight({ silent: false });

  if (!preflight.passed) {
    console.error('\n❌ UAT Stack is NOT ready due to preflight errors above.');
    process.exit(1);
  }

  console.log('\n================================================================================');
  console.log('🚀 HORPLUS LOCAL-07 UAT RUNTIME STACK IS READY');
  console.log('================================================================================');
  console.log('Stack is verified and ready for Product Owner UAT.');
  console.log('To launch the manual review browser, run:');
  console.log('  npm run uat:open:owner');
  console.log('================================================================================\n');

  // Keep alive if we spawned child processes, otherwise exit 0
  if (apiChild || feChild) {
    console.log('💡 Child dev servers are running. Press Ctrl+C to stop.\n');
    const shutdown = () => {
      console.log('\nStopping spawned servers...');
      if (apiChild) apiChild.kill();
      if (feChild) feChild.kill();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`\n❌ [START ERROR] ${err.message}`);
  process.exit(1);
});
