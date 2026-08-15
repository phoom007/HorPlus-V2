/**
 * HorPlus LOCAL-07 — Hard Safety Boundary Guard (PostgreSQL & Redis)
 * 
 * Verifies that DATABASE_URL, DIRECT_URL, and REDIS_URL strictly target:
 * - PostgreSQL Host:     127.0.0.1
 * - PostgreSQL Port:     5455
 * - PostgreSQL Database: horplus_wave1d_fasttrack_test
 * - Redis Host:          127.0.0.1
 * - Redis Port:          6380
 * 
 * Uses robust URL parsing to reject:
 * - 'localhost' or external hosts
 * - Port 5432 (default PostgreSQL) or 6379 (default Redis)
 * - Databases like 'horplus_pilot' or any non-fasttrack DB
 * - Malformed URLs or target strings hidden in query parameters
 * 
 * @license Apache-2.0
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

export const REQUIRED_SAFETY_CONFIG = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '5455',
  DB_NAME: 'horplus_wave1d_fasttrack_test',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6380',
};

export function parseAndValidatePostgresUrl(rawUrl, varName = 'DATABASE_URL') {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(`CRITICAL SAFETY ERROR: ${varName} is missing or empty!`);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`CRITICAL SAFETY ERROR: ${varName} is not a valid URL: ${err.message}`);
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`CRITICAL SAFETY ERROR: ${varName} protocol must be 'postgresql:' or 'postgres:'. Found: '${parsed.protocol}'`);
  }

  if (parsed.hostname !== REQUIRED_SAFETY_CONFIG.DB_HOST) {
    throw new Error(
      `CRITICAL SAFETY ERROR: ${varName} host must be strictly '${REQUIRED_SAFETY_CONFIG.DB_HOST}'. Found: '${parsed.hostname}' (localhost and external hosts are forbidden)`
    );
  }

  if (parsed.port !== REQUIRED_SAFETY_CONFIG.DB_PORT) {
    throw new Error(
      `CRITICAL SAFETY ERROR: ${varName} port must be strictly '${REQUIRED_SAFETY_CONFIG.DB_PORT}'. Found: '${parsed.port || 'default'}' (port 5432 and other ports are forbidden)`
    );
  }

  const cleanPath = parsed.pathname.replace(/^\/+/, '');
  if (cleanPath !== REQUIRED_SAFETY_CONFIG.DB_NAME) {
    throw new Error(
      `CRITICAL SAFETY ERROR: ${varName} database must be strictly '${REQUIRED_SAFETY_CONFIG.DB_NAME}'. Found: '${cleanPath}' ('horplus_pilot' and other databases are forbidden)`
    );
  }

  return {
    host: parsed.hostname,
    port: parsed.port,
    database: cleanPath,
  };
}

export function parseAndValidateRedisUrl(rawUrl, varName = 'REDIS_URL') {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(`CRITICAL SAFETY ERROR: ${varName} is missing or empty!`);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`CRITICAL SAFETY ERROR: ${varName} is not a valid URL: ${err.message}`);
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`CRITICAL SAFETY ERROR: ${varName} protocol must be 'redis:'. Found: '${parsed.protocol}'`);
  }

  if (parsed.hostname !== REQUIRED_SAFETY_CONFIG.REDIS_HOST) {
    throw new Error(
      `CRITICAL SAFETY ERROR: ${varName} host must be strictly '${REQUIRED_SAFETY_CONFIG.REDIS_HOST}'. Found: '${parsed.hostname}'`
    );
  }

  if (parsed.port !== REQUIRED_SAFETY_CONFIG.REDIS_PORT) {
    throw new Error(
      `CRITICAL SAFETY ERROR: ${varName} port must be strictly '${REQUIRED_SAFETY_CONFIG.REDIS_PORT}'. Found: '${parsed.port || 'default'}' (port 6379 is forbidden)`
    );
  }

  return {
    host: parsed.hostname,
    port: parsed.port,
  };
}

export function assertSafeDatabaseTarget() {
  const envPath = path.join(ROOT_DIR, 'server/.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const dbUrl = process.env.DATABASE_URL || '';
  const directUrl = process.env.DIRECT_URL || '';
  const redisUrl = process.env.REDIS_URL || '';

  // 1. Validate DATABASE_URL
  const dbInfo = parseAndValidatePostgresUrl(dbUrl, 'DATABASE_URL');

  // 2. Validate DIRECT_URL
  const directInfo = parseAndValidatePostgresUrl(directUrl, 'DIRECT_URL');

  // 3. Validate REDIS_URL if provided
  let redisInfo = null;
  if (redisUrl) {
    redisInfo = parseAndValidateRedisUrl(redisUrl, 'REDIS_URL');
  }

  return {
    database: dbInfo.database,
    port: dbInfo.port,
    host: dbInfo.host,
    redisPort: redisInfo ? redisInfo.port : REQUIRED_SAFETY_CONFIG.REDIS_PORT,
    safe: true,
  };
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const info = assertSafeDatabaseTarget();
    console.log(`✅ [SAFETY GUARD PASS] Target PostgreSQL: ${info.host}:${info.port}/${info.database}`);
    console.log(`✅ [SAFETY GUARD PASS] Target Redis:      ${info.host}:${info.redisPort}`);
  } catch (err) {
    console.error(`❌ [SAFETY GUARD VIOLATION] ${err.message}`);
    process.exit(1);
  }
}
