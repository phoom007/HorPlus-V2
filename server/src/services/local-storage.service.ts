import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { CreateUploadIntentInput, UploadIntent, ReadAccess } from './storage-provider.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads/private');

// Ensure upload dir exists asynchronously/safely
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class LocalStorageProvider {
  /**
   * Safely resolves and validates candidate path against upload root directory
   */
  public resolveSafePath(objectKey: string): string {
    if (!objectKey || typeof objectKey !== 'string') {
      throw new Error('INVALID_OBJECT_KEY: Object key must be a non-empty string');
    }

    // Reject null bytes
    if (objectKey.includes('\0')) {
      throw new Error('INVALID_OBJECT_KEY: Object key contains null bytes');
    }

    // Reject encoded traversal or URL encoded null bytes
    const lowerKey = objectKey.toLowerCase();
    let decodedKey = objectKey;
    try {
      decodedKey = decodeURIComponent(objectKey);
    } catch {
      throw new Error('PATH_TRAVERSAL_DETECTED: Invalid URL encoding in object key');
    }

    if (
      lowerKey.includes('%00') ||
      lowerKey.includes('%2e%2e') ||
      lowerKey.includes('%2f') ||
      lowerKey.includes('%5c') ||
      decodedKey.includes('..') ||
      decodedKey.includes('\0')
    ) {
      throw new Error('PATH_TRAVERSAL_DETECTED: Encoded traversal sequence rejected');
    }

    // Reject absolute paths (Unix, Windows drive letter, UNC)
    if (
      path.isAbsolute(objectKey) ||
      objectKey.startsWith('/') ||
      objectKey.startsWith('\\') ||
      /^[a-zA-Z]:[/\\]/.test(objectKey) ||
      objectKey.startsWith('\\\\')
    ) {
      throw new Error('ABSOLUTE_PATH_REJECTED: Object key cannot be an absolute path');
    }

    // Reject literal '..' segments in path
    const parts = objectKey.split(/[/\\]/);
    if (parts.includes('..')) {
      throw new Error('PATH_TRAVERSAL_DETECTED: Path traversal segment rejected');
    }

    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    const candidatePath = path.resolve(resolvedUploadDir, objectKey);

    // Verify candidatePath is strictly inside resolvedUploadDir
    const relative = path.relative(resolvedUploadDir, candidatePath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || candidatePath === resolvedUploadDir) {
      throw new Error('PATH_TRAVERSAL_DETECTED: Target path is outside upload root directory');
    }

    return candidatePath;
  }

  /**
   * Generates a signed URL (simulated for local disk) or simply the upload intent.
   */
  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const intentId = uuidv4();
    const extension = path.extname(input.fileName) || '.jpg';
    const sanitizedExt = extension.replace(/[^a-zA-Z0-9.]/g, '');
    const objectKey = `payments/${input.dormitoryId}/${input.billId}/${intentId}${sanitizedExt}`;

    return {
      intentId,
      objectKey,
      uploadUrl: `/api/v1/payments/slip/upload-chunk/${intentId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
    };
  }

  /**
   * Generates a read-only signed URL.
   */
  async getReadAccess(dormitoryId: string, objectKey: string): Promise<ReadAccess> {
    // Validate objectKey safely
    this.resolveSafePath(objectKey);
    return {
      url: `/api/v1/payments/slip/preview?key=${encodeURIComponent(objectKey)}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    };
  }

  /**
   * Physically save the file buffer to the object key path
   */
  async saveFile(objectKey: string, buffer: Buffer): Promise<void> {
    const fullPath = this.resolveSafePath(objectKey);
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  }
  
  async getFile(objectKey: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(objectKey);
    return await fs.promises.readFile(fullPath);
  }

  async fileExists(objectKey: string): Promise<boolean> {
    try {
      const fullPath = this.resolveSafePath(objectKey);
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(objectKey: string): Promise<void> {
    try {
      const fullPath = this.resolveSafePath(objectKey);
      await fs.promises.unlink(fullPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
}

export const localStorageProvider = new LocalStorageProvider();
