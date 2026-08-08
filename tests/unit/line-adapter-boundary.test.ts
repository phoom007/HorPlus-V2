/**
 * Unit Test Suite for BR-001 LINE API Override Security Boundary
 * Verifies that custom LINE base URL overrides are restricted strictly
 * to NODE_ENV=test OR HORPLUS_E2E=true environments.
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpLinePlatformAdapter } from '../../server/src/services/line-platform-adapter.js';

describe('BR-001 — LINE API Override Security Boundary Unit Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LINE_PLATFORM_URL;
    delete process.env.LINE_API_BASE_URL;
    delete process.env.HORPLUS_E2E;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. production + LINE_PLATFORM_URL evil.example -> adapter targets https://api.line.me', () => {
    process.env.NODE_ENV = 'production';
    process.env.LINE_PLATFORM_URL = 'http://evil.example.com';
    delete process.env.HORPLUS_E2E;

    const adapter = new HttpLinePlatformAdapter();
    expect(adapter.getBaseUrl()).toBe('https://api.line.me');
  });

  it('2. development normal runtime + override -> cannot redirect unless HORPLUS_E2E=true boundary', () => {
    process.env.NODE_ENV = 'development';
    process.env.LINE_PLATFORM_URL = 'http://evil.example.com';
    delete process.env.HORPLUS_E2E;

    const adapterWithoutE2E = new HttpLinePlatformAdapter();
    expect(adapterWithoutE2E.getBaseUrl()).toBe('https://api.line.me');

    // With explicit HORPLUS_E2E boundary
    process.env.HORPLUS_E2E = 'true';
    const adapterWithE2E = new HttpLinePlatformAdapter();
    expect(adapterWithE2E.getBaseUrl()).toBe('http://evil.example.com');
  });

  it('3. NODE_ENV=test + fake URL -> fake URL accepted', () => {
    process.env.NODE_ENV = 'test';
    process.env.LINE_PLATFORM_URL = 'http://127.0.0.1:3009';

    const adapter = new HttpLinePlatformAdapter();
    expect(adapter.getBaseUrl()).toBe('http://127.0.0.1:3009');
  });

  it('4. HORPLUS_E2E=true + fake URL -> fake URL accepted', () => {
    process.env.NODE_ENV = 'development';
    process.env.HORPLUS_E2E = 'true';
    process.env.LINE_PLATFORM_URL = 'http://127.0.0.1:3009';

    const adapter = new HttpLinePlatformAdapter();
    expect(adapter.getBaseUrl()).toBe('http://127.0.0.1:3009');
  });
});
