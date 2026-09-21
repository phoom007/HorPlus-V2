/**
 * Unit tests for resolveWebhookBaseUrl in LINE OA Routes
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveWebhookBaseUrl } from '../../routes/line-oa.routes.js';

describe('resolveWebhookBaseUrl Unit Test Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createMockReq = (headers: Record<string, string>, protocol = 'http') => {
    return {
      get: (headerName: string) => headers[headerName.toLowerCase()] || headers[headerName] || undefined,
      protocol,
    } as any;
  };

  it('resolves dynamic HTTPS base URL when request comes from Cloudflare Tunnel', () => {
    const req = createMockReq({
      host: 'envelope-ethics-reporting-defence.trycloudflare.com',
      'x-forwarded-proto': 'https',
    });

    const result = resolveWebhookBaseUrl(req);
    expect(result).toBe('https://envelope-ethics-reporting-defence.trycloudflare.com');
  });

  it('guarantees HTTPS protocol for Cloudflare Tunnel even if protocol defaults to http', () => {
    const req = createMockReq({
      host: 'test-tunnel-subdomain.trycloudflare.com',
    }, 'http');

    const result = resolveWebhookBaseUrl(req);
    expect(result).toBe('https://test-tunnel-subdomain.trycloudflare.com');
  });

  it('resolves dynamic HTTPS base URL when request comes from ngrok', () => {
    const req = createMockReq({
      'x-forwarded-host': 'my-custom-tunnel.ngrok-free.app',
      'x-forwarded-proto': 'https',
    });

    const result = resolveWebhookBaseUrl(req);
    expect(result).toBe('https://my-custom-tunnel.ngrok-free.app');
  });

  it('resolves dynamic HTTPS base URL for production custom domain', () => {
    const req = createMockReq({
      host: 'api.horplus.com',
      'x-forwarded-proto': 'https',
    }, 'https');

    const result = resolveWebhookBaseUrl(req);
    expect(result).toBe('https://api.horplus.com');
  });

  it('falls back to getPublicWebhookOrigin when request host is localhost or 127.0.0.1', () => {
    process.env.PUBLIC_WEBHOOK_ORIGIN = 'https://webhook.horplus.com';
    const req = createMockReq({
      host: 'localhost:3001',
    }, 'http');

    const result = resolveWebhookBaseUrl(req);
    expect(result).toBe('https://webhook.horplus.com');
  });
});
