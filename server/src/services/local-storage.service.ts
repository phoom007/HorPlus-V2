import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CreateUploadIntentInput, UploadIntent, ReadAccess } from './storage-provider.service.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads/private');

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class LocalStorageProvider {
  /**
   * Generates a signed URL (simulated for local disk) or simply the upload intent.
   * In a real system (S3), this returns a pre-signed PUT url.
   * Here we just return an intent ID and object key. The actual upload
   * will happen via a multipart/form-data POST to our API.
   */
  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const intentId = uuidv4();
    const extension = path.extname(input.fileName) || '.jpg';
    const objectKey = `payments/${input.dormitoryId}/${input.billId}/${intentId}${extension}`;

    return {
      intentId,
      objectKey,
      uploadUrl: `/api/v1/payments/slip/upload-chunk/${intentId}`, // A mocked local path
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
    };
  }

  /**
   * Generates a read-only signed URL.
   */
  async getReadAccess(dormitoryId: string, objectKey: string): Promise<ReadAccess> {
    // In local dev, we could serve this through a special authenticated endpoint
    // e.g., /api/v1/files/private?key=...
    return {
      url: `/api/v1/files/private?key=${encodeURIComponent(objectKey)}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    };
  }

  /**
   * Physically save the file buffer to the object key path
   */
  async saveFile(objectKey: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(UPLOAD_DIR, objectKey);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, buffer);
  }
  
  async getFile(objectKey: string): Promise<Buffer> {
    const fullPath = path.join(UPLOAD_DIR, objectKey);
    return fs.readFileSync(fullPath);
  }

  async fileExists(objectKey: string): Promise<boolean> {
    const fullPath = path.join(UPLOAD_DIR, objectKey);
    return fs.existsSync(fullPath);
  }

  async deleteFile(objectKey: string): Promise<void> {
    const fullPath = path.join(UPLOAD_DIR, objectKey);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}

export const localStorageProvider = new LocalStorageProvider();

