import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_BASE_PATH: z.string().default('/api/v1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  BODY_LIMIT: z.string().default('1mb'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().default(10000),

  // Auth & Session Configuration
  E2E_TEST_MODE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  GOOGLE_CLIENT_ID: z.string().default('horplus-test-google-client-id'),
  SESSION_ENCRYPTION_KEY: z.string().min(32, 'SESSION_ENCRYPTION_KEY must be at least 32 characters').default('0123456789abcdef0123456789abcdef'),
  SESSION_TTL_SECONDS: z.coerce.number().int().default(86400),
  SESSION_COOKIE_NAME: z.string().default('horplus_session'),
  CSRF_SIGNING_KEY: z.string().min(16).default('csrf-secret-key-0123456789abcdef'),
  CSRF_COOKIE_NAME: z.string().default('horplus_csrf'),
  COOKIE_SECURE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  TRUST_PROXY: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),

  // Sensitive Field Encryption Key
  FIELD_ENCRYPTION_KEY: z.string().min(32, 'FIELD_ENCRYPTION_KEY must be at least 32 characters').default('fedcba9876543210fedcba9876543210'),
  FIELD_ENCRYPTION_KEY_VERSION: z.coerce.number().int().default(1),
});

export type EnvConfig = {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  API_BASE_PATH: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  CORS_ORIGINS: string[];
  BODY_LIMIT: string;
  SHUTDOWN_TIMEOUT_MS: number;

  E2E_TEST_MODE: boolean;
  GOOGLE_CLIENT_ID: string;
  SESSION_ENCRYPTION_KEY: string;
  SESSION_TTL_SECONDS: number;
  SESSION_COOKIE_NAME: string;
  CSRF_SIGNING_KEY: string;
  CSRF_COOKIE_NAME: string;
  COOKIE_SECURE: boolean;
  COOKIE_SAME_SITE: 'lax' | 'strict' | 'none';
  TRUST_PROXY: boolean;

  FIELD_ENCRYPTION_KEY: string;
  FIELD_ENCRYPTION_KEY_VERSION: number;
};

export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): EnvConfig {
  const envToParse = { ...rawEnv };

  // Only inject default fallback if validating current process.env in non-production
  if (rawEnv === process.env && !envToParse.DATABASE_URL && envToParse.NODE_ENV !== 'production') {
    envToParse.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/horplus';
  }

  const parsed = envSchema.safeParse(envToParse);

  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    throw new Error(`Environment validation failed: ${errorDetails}`);
  }

  const corsOriginsList = parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);

  if (parsed.data.NODE_ENV === 'production' && corsOriginsList.includes('*')) {
    throw new Error("Production CORS origins cannot include wildcard '*'");
  }

  if (parsed.data.NODE_ENV === 'production' && (process.env.ALLOW_TEST_LIFF_ADAPTER === 'true' || process.env.USE_MOCK_LIFF === 'true')) {
    throw new Error("PRODUCTION_SECURITY_VIOLATION: Test LIFF identity verifier adapter cannot be enabled in NODE_ENV=production");
  }

  if (parsed.data.E2E_TEST_MODE) {
    if (parsed.data.NODE_ENV !== 'test') {
      throw new Error("E2E_TEST_MODE is true but NODE_ENV is not test.");
    }
    try {
      const dbUrl = new URL(parsed.data.DATABASE_URL);
      const dbName = dbUrl.pathname.replace(/^\//, '');
      if (dbName !== 'horplus_test' && dbName !== 'horplus_e2e') {
        throw new Error(`E2E_TEST_MODE is true but connected to unauthorized database '${dbName}'. Allowed: 'horplus_test', 'horplus_e2e'`);
      }
    } catch (err: any) {
      if (err.message.includes('unauthorized database')) throw err;
      throw new Error("Invalid DATABASE_URL format.");
    }
  }

  return {
    NODE_ENV: parsed.data.NODE_ENV,
    PORT: parsed.data.PORT,
    API_BASE_PATH: parsed.data.API_BASE_PATH,
    DATABASE_URL: parsed.data.DATABASE_URL,
    REDIS_URL: parsed.data.REDIS_URL,
    LOG_LEVEL: parsed.data.LOG_LEVEL,
    CORS_ORIGINS: corsOriginsList,
    BODY_LIMIT: parsed.data.BODY_LIMIT,
    SHUTDOWN_TIMEOUT_MS: parsed.data.SHUTDOWN_TIMEOUT_MS,

    E2E_TEST_MODE: parsed.data.E2E_TEST_MODE,
    GOOGLE_CLIENT_ID: parsed.data.GOOGLE_CLIENT_ID,
    SESSION_ENCRYPTION_KEY: parsed.data.SESSION_ENCRYPTION_KEY,
    SESSION_TTL_SECONDS: parsed.data.SESSION_TTL_SECONDS,
    SESSION_COOKIE_NAME: parsed.data.SESSION_COOKIE_NAME,
    CSRF_SIGNING_KEY: parsed.data.CSRF_SIGNING_KEY,
    CSRF_COOKIE_NAME: parsed.data.CSRF_COOKIE_NAME,
    COOKIE_SECURE: parsed.data.COOKIE_SECURE,
    COOKIE_SAME_SITE: parsed.data.COOKIE_SAME_SITE,
    TRUST_PROXY: parsed.data.TRUST_PROXY,

    FIELD_ENCRYPTION_KEY: parsed.data.FIELD_ENCRYPTION_KEY,
    FIELD_ENCRYPTION_KEY_VERSION: parsed.data.FIELD_ENCRYPTION_KEY_VERSION,
  };
}

export function redactSecrets(envConfig: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...envConfig };
  if (typeof redacted.DATABASE_URL === 'string') {
    redacted.DATABASE_URL = redacted.DATABASE_URL.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@');
  }
  if (typeof redacted.REDIS_URL === 'string') {
    redacted.REDIS_URL = redacted.REDIS_URL.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@');
  }
  if (typeof redacted.SESSION_ENCRYPTION_KEY === 'string') {
    redacted.SESSION_ENCRYPTION_KEY = '[REDACTED]';
  }
  if (typeof redacted.CSRF_SIGNING_KEY === 'string') {
    redacted.CSRF_SIGNING_KEY = '[REDACTED]';
  }
  if (typeof redacted.FIELD_ENCRYPTION_KEY === 'string') {
    redacted.FIELD_ENCRYPTION_KEY = '[REDACTED]';
  }
  return redacted;
}

let cachedEnv: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!cachedEnv) {
    cachedEnv = validateEnv(process.env);
  }
  return cachedEnv;
}

export function resetCachedEnv(): void {
  cachedEnv = null;
}
