import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkRefreshLockState, assertNoActiveRefresh } from '../../../scripts/local07/refresh-lock.mjs';
import { runPreflight } from '../../../scripts/local07/preflight.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');
const LOCK_FILE = path.join(ROOT_DIR, '.local07-refresh.lock');

describe('LOCAL-07 Refresh Lock & Mutual Exclusion Guard', () => {
  beforeEach(() => {
    if (fs.existsSync(LOCK_FILE)) {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  });

  afterEach(() => {
    if (fs.existsSync(LOCK_FILE)) {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  });

  it('reports unlocked when no lock file exists', () => {
    const state = checkRefreshLockState();
    expect(state.isLocked).toBe(false);
    expect(() => assertNoActiveRefresh('Test Process')).not.toThrow();
  });

  it('reports locked when a valid active lock exists with current process PID', () => {
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }),
      'utf8'
    );

    const state = checkRefreshLockState();
    expect(state.isLocked).toBe(true);
    expect(state.pid).toBe(process.pid);

    expect(() => assertNoActiveRefresh('Test Runner')).toThrow(
      /Cannot start Test Runner while npm run uat:refresh/
    );
  });

  it('detects and cleans up stale lock with dead PID', () => {
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: 9999999, timestamp: new Date().toISOString() }),
      'utf8'
    );

    const state = checkRefreshLockState();
    expect(state.isLocked).toBe(false);
    expect(state.isStale).toBe(true);
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
  });

  it('detects and cleans up stale lock older than 10 minutes', () => {
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, timestamp: elevenMinutesAgo }),
      'utf8'
    );

    const state = checkRefreshLockState();
    expect(state.isLocked).toBe(false);
    expect(state.isStale).toBe(true);
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
  });
});

describe('Full-Stack Preflight Integration & Negative Assertions', () => {
  beforeEach(() => {
    if (fs.existsSync(LOCK_FILE)) {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  });

  afterEach(() => {
    if (fs.existsSync(LOCK_FILE)) {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  });

  it('passes completely when running against the healthy local stack', async () => {
    const result = await runPreflight({ silent: true });
    expect(result.passed).toBe(true);
    expect(result.checks.postgres).toBe(true);
    expect(result.checks.redis).toBe(true);
    expect(result.checks.apiLiveness).toBe(true);
    expect(result.checks.apiReady).toBe(true);
    expect(result.checks.frontend).toBe(true);
    expect(result.checks.authSession).toBe(true);
    expect(result.checks.uatSessions).toBe(true);
  });

  it('fails closed when API port is unavailable', async () => {
    // Port 39999 is not running any API
    const result = await runPreflight({ apiPort: 39999, silent: true });
    expect(result.passed).toBe(false);
    expect(result.checks.apiLiveness).toBe(false);
    expect(result.checks.apiReady).toBe(false);
    expect(result.errors.apiLiveness).toMatch(/unreachable|refused/i);
  });

  it('fails closed when Frontend port is unavailable', async () => {
    // Port 59999 is not running Vite
    const result = await runPreflight({ frontendPort: 59999, silent: true });
    expect(result.passed).toBe(false);
    expect(result.checks.frontend).toBe(false);
    expect(result.checks.authSession).toBe(false);
    expect(result.errors.frontend).toMatch(/unreachable|refused/i);
  });

  it('fails closed when active refresh lock exists', async () => {
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }),
      'utf8'
    );

    const result = await runPreflight({ silent: true });
    expect(result.passed).toBe(false);
    expect(result.errors.refreshLock).toMatch(/Active uat:refresh process detected/);
  });
});
