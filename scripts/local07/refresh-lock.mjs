/**
 * HorPlus LOCAL-07 — Refresh & Runtime Mutual Exclusion Guard
 * 
 * Enforces:
 * 1. Safe refresh lock (.local07-refresh.lock) to prevent concurrent executions.
 * 2. API-running guard: uat:refresh refuses to execute while the UAT API is actively serving,
 *    unless explicit developer override (--force or HORPLUS_FORCE_REFRESH=1) is passed.
 * 3. Stale lock detection & safe cleanup in finally blocks and process exit handlers.
 * 4. uat:open:* and uat:start refuse to run while uat:refresh is active.
 * 
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const LOCK_FILE = path.join(ROOT_DIR, '.local07-refresh.lock');

/**
 * Check if the HorPlus API is actively responding to liveness on 127.0.0.1:3001
 */
export async function isApiActivelyRunning(port = 3001, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health/liveness`, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Check if an active refresh lock exists, cleaning it up if stale.
 */
export function checkRefreshLockState() {
  if (!fs.existsSync(LOCK_FILE)) {
    return { isLocked: false };
  }

  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    const data = JSON.parse(raw);
    const pid = data.pid;
    const timestamp = data.timestamp ? new Date(data.timestamp).getTime() : 0;
    const ageMs = Date.now() - timestamp;

    let isAlive = false;
    if (pid && typeof pid === 'number') {
      try {
        process.kill(pid, 0);
        isAlive = true;
      } catch {
        isAlive = false;
      }
    }

    const isStale = !isAlive || ageMs > 10 * 60 * 1000; // 10 minutes timeout

    if (isStale) {
      try {
        fs.unlinkSync(LOCK_FILE);
      } catch {}
      return { isLocked: false, pid, isStale: true };
    }

    return { isLocked: true, pid, isStale: false };
  } catch {
    // Malformed lock file -> treat as stale and remove
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {}
    return { isLocked: false, isStale: true };
  }
}

/**
 * Guard for uat:open:* and uat:start to refuse if uat:refresh is currently in flight.
 */
export function assertNoActiveRefresh(callerName = 'UAT process') {
  const { isLocked, pid } = checkRefreshLockState();
  if (isLocked) {
    throw new Error(
      `❌ BLOCKED: Cannot start ${callerName} while npm run uat:refresh (PID ${pid}) is actively executing.\n` +
      `   Please wait for uat:refresh to complete cleanly before proceeding.`
    );
  }
}

/**
 * Acquire the refresh lock for uat:refresh.
 */
export async function acquireRefreshLock(options = {}) {
  const hasForceOverride =
    options.force ||
    process.argv.includes('--force') ||
    process.env.HORPLUS_FORCE_REFRESH === '1';

  // 1. API-running guard
  const apiActive = await isApiActivelyRunning();
  if (apiActive && !hasForceOverride) {
    throw new Error(
      `❌ CRITICAL: HorPlus API is actively running on port 3001!\n` +
      `   Refreshing the database beneath an active API or browser UAT session causes connection drops, cache inconsistencies, and broken state.\n` +
      `   Please stop the API/UAT runtime before running uat:refresh, or pass --force (HORPLUS_FORCE_REFRESH=1) to override.`
    );
  }

  // 2. Lock file mutual exclusion
  const lockState = checkRefreshLockState();
  if (lockState.isLocked) {
    throw new Error(
      `❌ CRITICAL: Another uat:refresh process (PID: ${lockState.pid}) is currently running!\n` +
      `   Refresh is mutually exclusive. Please wait for the running instance to complete.`
    );
  }

  // 3. Create lock
  const lockData = {
    pid: process.pid,
    timestamp: new Date().toISOString(),
    caller: process.argv.join(' '),
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2), 'utf8');

  // 4. Safe release function
  const releaseLock = () => {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const raw = fs.readFileSync(LOCK_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (data.pid === process.pid) {
          fs.unlinkSync(LOCK_FILE);
        }
      }
    } catch {}
  };

  // 5. Ensure cleanup on unexpected process exit
  const exitHandler = () => {
    releaseLock();
  };
  process.on('exit', exitHandler);
  process.on('SIGINT', () => {
    releaseLock();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    releaseLock();
    process.exit(143);
  });

  return releaseLock;
}
