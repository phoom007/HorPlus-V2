import { describe, it, expect, beforeEach } from 'vitest';
import { validateEnv, redactSecrets, resetCachedEnv } from '../src/config/env.js';

describe('Environment Validation', () => {
  beforeEach(() => {
    resetCachedEnv();
  });

  it('validates a correct environment configuration', () => {
    const rawEnv = {
      NODE_ENV: 'development',
      PORT: '3000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGINS: 'http://localhost:5173,http://localhost:3000',
    };

    const env = validateEnv(rawEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:3000']);
  });

  it('fails if DATABASE_URL is missing', () => {
    const rawEnv = {
      REDIS_URL: 'redis://localhost:6379',
    };

    expect(() => validateEnv(rawEnv)).toThrow('Environment validation failed');
  });

  it('fails if CORS_ORIGINS in production includes wildcard *', () => {
    const rawEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGINS: '*',
    };

    expect(() => validateEnv(rawEnv)).toThrow("Production CORS origins cannot include wildcard '*'");
  });

  it('redacts password in DATABASE_URL and REDIS_URL', () => {
    const rawEnv = {
      DATABASE_URL: 'postgresql://admin:secretpassword123@localhost:5432/horplus',
      REDIS_URL: 'redis://default:myredispass@localhost:6379',
    };

    const redacted = redactSecrets(rawEnv);
    expect(redacted.DATABASE_URL).toBe('postgresql://***:***@localhost:5432/horplus');
    expect(redacted.REDIS_URL).toBe('redis://***:***@localhost:6379');
  });
});
