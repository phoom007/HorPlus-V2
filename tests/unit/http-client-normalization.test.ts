/**
 * Unit test for httpClient URL Normalization (ROR3-009)
 * Proves buildRequestUrl handles relative paths, redundant /api/v1 paths,
 * and absolute base URLs without double concatenation or stripping required path segments.
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { buildRequestUrl } from '../../src/data/httpClient.js';

describe('httpClient buildRequestUrl Normalization Matrix', () => {
  it('1. Relative path with default /api/v1 base URL -> /api/v1/onboarding/complete', () => {
    const url = buildRequestUrl('/api/v1', '/onboarding/complete');
    expect(url).toBe('/api/v1/onboarding/complete');
  });

  it('2. Redundant /api/v1/ path with /api/v1 base URL -> /api/v1/onboarding/complete (no double /api/v1/api/v1)', () => {
    const url = buildRequestUrl('/api/v1', '/api/v1/onboarding/complete');
    expect(url).toBe('/api/v1/onboarding/complete');
  });

  it('3. Absolute base URL http://127.0.0.1:3001/api/v1 with /onboarding/complete -> http://127.0.0.1:3001/api/v1/onboarding/complete', () => {
    const url = buildRequestUrl('http://127.0.0.1:3001/api/v1', '/onboarding/complete');
    expect(url).toBe('http://127.0.0.1:3001/api/v1/onboarding/complete');
  });

  it('4. Absolute base URL http://127.0.0.1:3001/api/v1 with redundant /api/v1/onboarding/complete -> http://127.0.0.1:3001/api/v1/onboarding/complete', () => {
    const url = buildRequestUrl('http://127.0.0.1:3001/api/v1', '/api/v1/onboarding/complete');
    expect(url).toBe('http://127.0.0.1:3001/api/v1/onboarding/complete');
  });

  it('5. Base URL with trailing slash /api/v1/ with relative path -> /api/v1/auth/session', () => {
    const url = buildRequestUrl('/api/v1/', 'auth/session');
    expect(url).toBe('/api/v1/auth/session');
  });

  it('6. Custom root base URL / with relative path -> /auth/session', () => {
    const url = buildRequestUrl('/', '/auth/session');
    expect(url).toBe('/auth/session');
  });
});
