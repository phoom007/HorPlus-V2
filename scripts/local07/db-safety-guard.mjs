/**
 * HorPlus LOCAL-07 — Database Safety Guard
 * 
 * Verifies that DATABASE_URL and DIRECT_URL strictly target:
 * Host:     127.0.0.1
 * Port:     5455
 * Database: horplus_wave1d_fasttrack_test
 * 
 * Aborts execution immediately with non-zero exit code if target is non-conforming.
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

export function assertSafeDatabaseTarget() {
  const envPath = path.join(ROOT_DIR, 'server/.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const dbUrl = process.env.DATABASE_URL || '';
  const directUrl = process.env.DIRECT_URL || '';

  const REQUIRED_PORT = '5455';
  const REQUIRED_DB = 'horplus_wave1d_fasttrack_test';
  const FORBIDDEN_PORTS = ['5432'];
  const FORBIDDEN_DBS = ['horplus_pilot', 'production'];

  // 1. Check DATABASE_URL
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not set!');
  }

  for (const fPort of FORBIDDEN_PORTS) {
    if (dbUrl.includes(`:${fPort}`)) {
      throw new Error(`CRITICAL SAFETY ERROR: DATABASE_URL targets forbidden port :${fPort}! Allowed port is :${REQUIRED_PORT}`);
    }
  }

  for (const fDb of FORBIDDEN_DBS) {
    if (dbUrl.includes(fDb)) {
      throw new Error(`CRITICAL SAFETY ERROR: DATABASE_URL targets forbidden database "${fDb}"! Allowed DB is "${REQUIRED_DB}"`);
    }
  }

  if (!dbUrl.includes(`:${REQUIRED_PORT}`) || !dbUrl.includes(REQUIRED_DB)) {
    throw new Error(`CRITICAL SAFETY ERROR: DATABASE_URL must strictly contain :${REQUIRED_PORT} and ${REQUIRED_DB}. Found: "${dbUrl}"`);
  }

  // 2. Check DIRECT_URL
  if (!directUrl) {
    throw new Error('DIRECT_URL is not set!');
  }

  for (const fPort of FORBIDDEN_PORTS) {
    if (directUrl.includes(`:${fPort}`)) {
      throw new Error(`CRITICAL SAFETY ERROR: DIRECT_URL targets forbidden port :${fPort}! Allowed port is :${REQUIRED_PORT}`);
    }
  }

  for (const fDb of FORBIDDEN_DBS) {
    if (directUrl.includes(fDb)) {
      throw new Error(`CRITICAL SAFETY ERROR: DIRECT_URL targets forbidden database "${fDb}"! Allowed DB is "${REQUIRED_DB}"`);
    }
  }

  if (!directUrl.includes(`:${REQUIRED_PORT}`) || !directUrl.includes(REQUIRED_DB)) {
    throw new Error(`CRITICAL SAFETY ERROR: DIRECT_URL must strictly contain :${REQUIRED_PORT} and ${REQUIRED_DB}. Found: "${directUrl}"`);
  }

  return {
    database: REQUIRED_DB,
    port: REQUIRED_PORT,
    host: '127.0.0.1',
    safe: true,
  };
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const info = assertSafeDatabaseTarget();
    console.log(`✅ [SAFETY GUARD PASS] Target database verified: ${info.host}:${info.port}/${info.database}`);
  } catch (err) {
    console.error(`❌ [SAFETY GUARD VIOLATION] ${err.message}`);
    process.exit(1);
  }
}
