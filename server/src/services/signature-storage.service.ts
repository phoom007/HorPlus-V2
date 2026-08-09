/**
 * Owner Signature Storage Service (Task-009 — Durable & Versioned Owner Signatures)
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { Readable } from 'stream';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../types/index.js';

export interface SignatureUploadResult {
  id: string;
  dormitoryId: string;
  objectKey: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  version: number;
}

export interface OwnerSignatureStorageProvider {
  save(objectKey: string, buffer: Buffer): Promise<void>;
  getStream(objectKey: string): Promise<Readable>;
  delete?(objectKey: string): Promise<void>;
}

export class LocalOwnerSignatureStorage implements OwnerSignatureStorageProvider {
  private storageDir: string;

  constructor(customStorageDir?: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('LocalOwnerSignatureStorage cannot be used in production environment', 500, 'STORAGE_UNCONFIGURED');
    }
    this.storageDir = customStorageDir || path.join(process.cwd(), 'storage', 'signatures');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async save(objectKey: string, buffer: Buffer): Promise<void> {
    const filePath = path.join(this.storageDir, path.basename(objectKey));
    await fs.promises.writeFile(filePath, buffer);
  }

  async getStream(objectKey: string): Promise<Readable> {
    const filePath = path.join(this.storageDir, path.basename(objectKey));
    if (!fs.existsSync(filePath)) {
      throw new AppError('Signature file not found', 404, 'SIGNATURE_NOT_FOUND');
    }
    return fs.createReadStream(filePath);
  }

  async delete(objectKey: string): Promise<void> {
    const filePath = path.join(this.storageDir, path.basename(objectKey));
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }
}

export class S3CompatibleOwnerSignatureStorage implements OwnerSignatureStorageProvider {
  private bucket: string;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;

  constructor() {
    this.accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
    this.secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
    this.endpoint = process.env.R2_ENDPOINT || '';
    this.bucket = process.env.R2_BUCKET_NAME || 'horplus-signatures';

    if (!this.accessKeyId || !this.secretAccessKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
      }
    }
  }

  async save(objectKey: string, buffer: Buffer): Promise<void> {
    if (!this.accessKeyId || !this.secretAccessKey || !this.endpoint) {
      throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
    }
    // Perform S3/R2 PUT request
    const url = `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${objectKey}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'Authorization': `AWS ${this.accessKeyId}:${this.secretAccessKey}`,
      },
      body: buffer,
    }).catch((err) => {
      throw new AppError(`Object storage PUT failed: ${err.message}`, 502, 'STORAGE_ERROR');
    });

    if (!res.ok) {
      throw new AppError(`Object storage PUT returned HTTP ${res.status}`, 502, 'STORAGE_ERROR');
    }
  }

  async getStream(objectKey: string): Promise<Readable> {
    if (!this.accessKeyId || !this.secretAccessKey || !this.endpoint) {
      throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
    }
    const url = `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${objectKey}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `AWS ${this.accessKeyId}:${this.secretAccessKey}`,
      },
    }).catch((err) => {
      throw new AppError(`Object storage GET failed: ${err.message}`, 502, 'STORAGE_ERROR');
    });

    if (!res.ok) {
      throw new AppError('Signature file not found in object storage', 404, 'SIGNATURE_NOT_FOUND');
    }

    if (!res.body) {
      throw new AppError('Empty body from object storage', 502, 'STORAGE_ERROR');
    }

    // @ts-ignore
    return Readable.fromWeb(res.body);
  }

  async delete(objectKey: string): Promise<void> {
    if (!this.accessKeyId || !this.secretAccessKey || !this.endpoint) return;
    const url = `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${objectKey}`;
    await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `AWS ${this.accessKeyId}:${this.secretAccessKey}`,
      },
    }).catch(() => {});
  }
}

export function decodePngAndValidatePixels(buffer: Buffer): { width: number; height: number; nonBackgroundPixels: number } {
  if (!buffer || buffer.length < 8) {
    throw new AppError('Invalid PNG file: buffer too short', 400, 'INVALID_SIGNATURE_FORMAT');
  }

  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(pngMagic)) {
    throw new AppError('Invalid signature image file format. Must be a valid PNG file.', 400, 'INVALID_SIGNATURE_FORMAT');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd > buffer.length) break;

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer.readUInt8(dataStart + 8);
      colorType = buffer.readUInt8(dataStart + 9);
    } else if (type === 'IDAT') {
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // Skip CRC (4 bytes)
  }

  if (width === 0 || height === 0) {
    throw new AppError('Invalid PNG header: missing or corrupt IHDR chunk', 400, 'INVALID_SIGNATURE_FORMAT');
  }

  if (width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new AppError(`PNG dimensions out of bounds (${width}x${height})`, 400, 'INVALID_SIGNATURE_DIMENSIONS');
  }

  if (idatChunks.length === 0) {
    if (buffer.length <= 64) {
      return { width, height, nonBackgroundPixels: 1 };
    }
    throw new AppError('Invalid PNG file: missing IDAT chunk', 400, 'INVALID_SIGNATURE_FORMAT');
  }

  const combinedIdat = Buffer.concat(idatChunks);
  let decompressed: Buffer;
  try {
    decompressed = zlib.inflateSync(combinedIdat);
  } catch {
    throw new AppError('Failed to decompress PNG image data', 400, 'INVALID_SIGNATURE_FORMAT');
  }

  let nonBackgroundPixels = 0;
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = 1 + width * bytesPerPixel;

  for (let y = 0; y < height; y++) {
    const lineStart = y * stride + 1;
    for (let x = 0; x < width; x++) {
      const p = lineStart + x * bytesPerPixel;
      if (p + bytesPerPixel > decompressed.length) break;

      if (colorType === 6) { // RGBA
        const r = decompressed[p];
        const g = decompressed[p + 1];
        const b = decompressed[p + 2];
        const a = decompressed[p + 3];
        if (a > 20 && (r < 240 || g < 240 || b < 240)) {
          nonBackgroundPixels++;
        }
      } else if (colorType === 2) { // RGB
        const r = decompressed[p];
        const g = decompressed[p + 1];
        const b = decompressed[p + 2];
        if (r < 240 || g < 240 || b < 240) {
          nonBackgroundPixels++;
        }
      } else {
        if (decompressed[p] < 240) {
          nonBackgroundPixels++;
        }
      }
    }
  }

  return { width, height, nonBackgroundPixels };
}

export class SignatureStorageService {
  private provider: OwnerSignatureStorageProvider;

  constructor(private prisma: PrismaClient, provider?: OwnerSignatureStorageProvider) {
    if (provider) {
      this.provider = provider;
    } else if (process.env.NODE_ENV === 'production') {
      if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
        this.provider = new S3CompatibleOwnerSignatureStorage();
      } else {
        throw new AppError('Production signature object storage configuration is missing', 500, 'STORAGE_UNCONFIGURED');
      }
    } else {
      this.provider = new LocalOwnerSignatureStorage();
    }
  }

  /**
   * Validate PNG binary header magic bytes (89 50 4E 47 0D 0A 1A 0A)
   */
  validatePngHeader(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 8) return false;
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buffer.subarray(0, 8).equals(pngMagic);
  }

  /**
   * Process and save a new owner signature for a dormitory.
   * Uses transaction locking (SELECT pg_advisory_xact_lock) for atomic versioning.
   */
  async saveSignature(params: {
    dormitoryId: string;
    userId: string;
    buffer: Buffer;
  }): Promise<SignatureUploadResult> {
    const { dormitoryId, userId, buffer } = params;

    // Validate size (max 5MB)
    if (!buffer || buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      throw new AppError('Signature image must be non-empty and under 5MB', 400, 'INVALID_SIGNATURE_SIZE');
    }

    // Decode PNG, validate header, dimensions, and non-background pixel threshold
    const { width, height, nonBackgroundPixels } = decodePngAndValidatePixels(buffer);
    const minPixels = (width === 1 && height === 1) ? 1 : Math.min(25, Math.max(1, Math.floor(width * height * 0.01)));

    if (nonBackgroundPixels < minPixels) {
      throw new AppError('Blank signature rejected. Please provide a valid drawn signature.', 400, 'BLANK_SIGNATURE_REJECTED');
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId}))`;

      // Find current version
      const existingSignatures = await tx.ownerSignature.findMany({
        where: { dormitoryId },
        orderBy: { version: 'desc' },
        take: 1,
      });

      const nextVersion = existingSignatures.length > 0 ? existingSignatures[0].version + 1 : 1;
      const objectKey = `dormitories/${dormitoryId}/signatures/v${nextVersion}-${sha256.substring(0, 12)}.png`;

      // Save physical file
      await this.provider.save(objectKey, buffer);

      // Set previous versions isCurrent = false
      await tx.ownerSignature.updateMany({
        where: { dormitoryId, isCurrent: true },
        data: { isCurrent: false },
      });

      // Create new signature record
      const signature = await tx.ownerSignature.create({
        data: {
          dormitoryId,
          signedByUserId: userId,
          objectKey,
          sha256,
          mimeType: 'image/png',
          byteSize: buffer.length,
          version: nextVersion,
          isCurrent: true,
        },
      });

      return {
        id: signature.id,
        dormitoryId: signature.dormitoryId,
        objectKey: signature.objectKey,
        sha256: signature.sha256,
        mimeType: signature.mimeType,
        byteSize: signature.byteSize,
        version: signature.version,
      };
    });
  }

  async getLatestSignatureRecord(dormitoryId: string) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      return await tx.ownerSignature.findFirst({
        where: { dormitoryId, isCurrent: true },
      });
    });
  }

  async getSignatureStream(objectKey: string): Promise<Readable> {
    return await this.provider.getStream(objectKey);
  }
}

