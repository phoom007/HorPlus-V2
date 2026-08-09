/**
 * Owner Signature Storage Service (Task-009 — Durable & Versioned Owner Signatures)
 * @license Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
}

export class S3CompatibleOwnerSignatureStorage implements OwnerSignatureStorageProvider {
  constructor() {
    const isConfigured = Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
    if (!isConfigured) {
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
      }
    }
  }

  async save(objectKey: string, buffer: Buffer): Promise<void> {
    if (!process.env.R2_ACCESS_KEY_ID) {
      throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
    }
  }

  async getStream(objectKey: string): Promise<Readable> {
    if (!process.env.R2_ACCESS_KEY_ID) {
      throw new AppError('Production object storage is unconfigured', 500, 'STORAGE_UNCONFIGURED');
    }
    throw new AppError('S3 storage stream not implemented', 501, 'NOT_IMPLEMENTED');
  }
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

    // Validate PNG magic bytes
    if (!this.validatePngHeader(buffer)) {
      throw new AppError('Invalid signature image file format. Must be a valid PNG file.', 400, 'INVALID_SIGNATURE_FORMAT');
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
