/**
 * Owner Signature Storage Service (Task-009 — Durable & Versioned Owner Signatures)
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { PNG } from 'pngjs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
  private s3Client: S3Client | null = null;
  private bucket: string;

  constructor(customClient?: S3Client) {
    this.bucket = process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME || 'horplus-signatures';

    if (customClient) {
      this.s3Client = customClient;
    } else {
      const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
      const endpoint = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || '';

      if (!accessKeyId || !secretAccessKey || !endpoint) {
        if (process.env.NODE_ENV === 'production') {
          throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
        }
      } else {
        this.s3Client = new S3Client({
          region: 'auto',
          endpoint,
          credentials: { accessKeyId, secretAccessKey },
        });
      }
    }
  }

  async save(objectKey: string, buffer: Buffer): Promise<void> {
    if (!this.s3Client) {
      throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
    }
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: buffer,
          ContentType: 'image/png',
        })
      );
    } catch (err: any) {
      throw new AppError(`Object storage PUT failed: ${err.message}`, 502, 'STORAGE_ERROR');
    }
  }

  async getStream(objectKey: string): Promise<Readable> {
    if (!this.s3Client) {
      throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
    }
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        })
      );
      if (!response.Body) {
        throw new AppError('Empty body from object storage', 502, 'STORAGE_ERROR');
      }
      return response.Body as Readable;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError('Signature file not found in object storage', 404, 'SIGNATURE_NOT_FOUND');
    }
  }

  async delete(objectKey: string): Promise<void> {
    if (!this.s3Client) return;
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        })
      );
    } catch {}
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

  let png: PNG;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    throw new AppError('Invalid signature image file format. Must be a valid PNG file.', 400, 'INVALID_SIGNATURE_FORMAT');
  }

  const { width, height, data } = png;
  if (!width || !height || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new AppError(`PNG dimensions out of bounds (${width}x${height})`, 400, 'INVALID_SIGNATURE_DIMENSIONS');
  }

  let nonBackgroundPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a > 20 && (r < 240 || g < 240 || b < 240)) {
      nonBackgroundPixels++;
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

