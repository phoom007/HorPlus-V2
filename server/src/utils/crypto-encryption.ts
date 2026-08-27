/**
 * Cryptographic Utility for Task-009 (AES-256-GCM, Token Hashing & Opaque Keys)
 * @license Apache-2.0
 */

import crypto from 'crypto';

const MASTER_ENCRYPTION_KEY_STRING =
  process.env.APP_ENCRYPTION_KEY ||
  process.env.LINE_ENCRYPTION_KEY ||
  'horplus-default-secure-32byte-master-key-2026';

function getMasterKey(): Buffer {
  return crypto.createHash('sha256').update(MASTER_ENCRYPTION_KEY_STRING).digest();
}

/**
 * Encrypts plain text using AES-256-GCM
 */
export function encryptText(text: string): string {
  if (!text) return '';
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Return base64 payload: iv (12) + tag (16) + encrypted
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypts base64 payload encrypted with AES-256-GCM
 */
export function decryptText(payload: string): string {
  if (!payload) return '';
  const combined = Buffer.from(payload, 'base64');
  if (combined.length < 28) {
    throw new Error('Invalid encrypted payload length');
  }

  const key = getMasterKey();
  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(12, 28);
  const ciphertext = combined.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * SHA-256 Hash helper for tokens and keys
 */
export function hashToken(token: string): string {
  if (!token) return '';
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generates 256-bit cryptographically secure raw bearer token (64 hex characters)
 */
export function generateGrantToken(): { rawToken: string; tokenHash: string; tokenPrefix: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 8);
  return { rawToken, tokenHash, tokenPrefix };
}

/**
 * Generates an opaque webhook key and hash
 */
export function generateOpaqueWebhookKey(): { rawKey: string; keyHash: string; keyEncrypted: string } {
  const rawKey = 'whk_' + crypto.randomBytes(24).toString('hex');
  const keyHash = hashToken(rawKey);
  const keyEncrypted = encryptText(rawKey);
  return { rawKey, keyHash, keyEncrypted };
}

/**
 * Compute HMAC-SHA256 signature for LINE webhooks
 */
export function createLineSignature(bodyBuffer: Buffer, channelSecret: string): string {
  return crypto.createHmac('sha256', channelSecret).update(bodyBuffer).digest('base64');
}

/**
 * Constant-time HMAC-SHA256 signature verification for LINE webhooks
 */
export function verifyLineSignature(bodyBuffer: Buffer, channelSecret: string, signatureHeader: string): boolean {
  if (!bodyBuffer || !channelSecret || !signatureHeader) return false;
  try {
    const expectedSignature = createLineSignature(bodyBuffer, channelSecret);

    const sigA = Buffer.from(signatureHeader, 'utf8');
    const sigB = Buffer.from(expectedSignature, 'utf8');

    if (sigA.length !== sigB.length) return false;
    return crypto.timingSafeEqual(sigA, sigB);
  } catch (err) {
    return false;
  }
}
