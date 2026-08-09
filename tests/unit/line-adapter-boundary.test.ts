/**
 * Unit Test Suite for BR-001 & RI-001 LINE API Security & Boundary Controls
 * Verifies runtime boundary rules and adapter isolation.
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpLinePlatformAdapter, MockLinePlatformAdapter } from '../../server/src/services/line-platform-adapter.js';

describe('BR-001 & RI-001 — LINE API Security & Boundary Controls', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LINE_PLATFORM_URL;
    delete process.env.LINE_API_BASE_URL;
    delete process.env.HORPLUS_E2E;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. development + no E2E flag -> HORPLUS_E2E stays unset/false, LINE base = https://api.line.me', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.HORPLUS_E2E;

    const adapter = new HttpLinePlatformAdapter();
    expect(process.env.HORPLUS_E2E).toBeUndefined();
    expect(adapter.getBaseUrl()).toBe('https://api.line.me');
  });

  it('2. development + hostile LINE_PLATFORM_URL + no E2E flag -> hostile URL rejected, base = https://api.line.me', () => {
    process.env.NODE_ENV = 'development';
    process.env.LINE_PLATFORM_URL = 'http://evil.example.com';
    delete process.env.HORPLUS_E2E;

    const adapter = new HttpLinePlatformAdapter();
    expect(adapter.getBaseUrl()).toBe('https://api.line.me');
  });

  it('3. production + hostile override -> https://api.line.me', () => {
    process.env.NODE_ENV = 'production';
    process.env.LINE_PLATFORM_URL = 'http://evil.example.com';
    delete process.env.HORPLUS_E2E;

    const adapter = new HttpLinePlatformAdapter();
    expect(adapter.getBaseUrl()).toBe('https://api.line.me');
  });

  it('4. HORPLUS_E2E=true + fake URL -> fake URL accepted', () => {
    process.env.NODE_ENV = 'development';
    process.env.HORPLUS_E2E = 'true';
    process.env.LINE_PLATFORM_URL = 'http://127.0.0.1:5456';

    const adapter = new HttpLinePlatformAdapter();
    expect(adapter.getBaseUrl()).toBe('http://127.0.0.1:5456');
  });

  it('5. NODE_ENV=test with explicitly injected MockLinePlatformAdapter -> no real LINE network', async () => {
    const mockAdapter = new MockLinePlatformAdapter();
    const verifyRes = await mockAdapter.verifyAccessToken('test_token_123456');
    expect(verifyRes.verified).toBe(true);
    expect(verifyRes.botInfo?.displayName).toBe('Mock Bot');
    expect(mockAdapter.verifyAccessTokenCalls.length).toBe(1);
  });

  it('6. Normal development runtime preflight -> fake server 5456 is NOT selected by default (FD-007)', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.HORPLUS_E2E;
    delete process.env.LINE_PLATFORM_URL;
    delete process.env.LINE_API_BASE_URL;

    const adapter = new HttpLinePlatformAdapter();
    expect(adapter).toBeInstanceOf(HttpLinePlatformAdapter);
    expect(adapter.getBaseUrl()).toBe('https://api.line.me');
    expect(process.env.HORPLUS_E2E).toBeUndefined();
    expect(adapter.getBaseUrl()).not.toBe('http://127.0.0.1:5456');
  });
});
