/**
 * Dormitory Logo Service (Owner Round 2.4E)
 * Handles durable logo storage, magic byte verification, and per-dormitory scoping.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { logger } from '../config/logger.js';

export interface ValidatedImageInfo {
  mimeType: string;
  extension: string;
}

/**
 * Validates binary signature (magic bytes) to strictly allow PNG, JPEG, and WebP.
 * Rejects SVGs, scripts, executables, and spoofed extensions.
 */
export function validateImageMagicBytes(buffer: Buffer): ValidatedImageInfo {
  if (!buffer || buffer.length < 12) {
    throw new AppError('ไฟล์รูปภาพไม่ถูกต้องหรือไม่สมบูรณ์', 400, 'INVALID_IMAGE_PAYLOAD');
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  throw new AppError('รองรับเฉพาะไฟล์รูปภาพประเภท PNG, JPG และ WebP เท่านั้น', 400, 'UNSUPPORTED_IMAGE_FORMAT');
}

export interface DormitoryLogoStorageProvider {
  save(objectKey: string, buffer: Buffer, mimeType: string): Promise<void>;
  getStream(objectKey: string): Promise<Readable>;
  delete?(objectKey: string): Promise<void>;
}

export class LocalDormitoryLogoStorage implements DormitoryLogoStorageProvider {
  private storageDir: string;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir || path.join(process.cwd(), 'storage', 'logos');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async save(objectKey: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(this.storageDir, ...objectKey.split('/'));
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, buffer);
  }

  async getStream(objectKey: string): Promise<Readable> {
    const fullPath = path.join(this.storageDir, ...objectKey.split('/'));
    if (!fs.existsSync(fullPath)) {
      throw new AppError('Logo file not found', 404, 'LOGO_NOT_FOUND');
    }
    return fs.createReadStream(fullPath);
  }

  async delete(objectKey: string): Promise<void> {
    const fullPath = path.join(this.storageDir, ...objectKey.split('/'));
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath).catch(() => {});
    }
  }
}

export class S3DormitoryLogoStorage implements DormitoryLogoStorageProvider {
  private s3Client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET || 'horplus-uploads';
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-southeast-1',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
  }

  async save(objectKey: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
      })
    );
  }

  async getStream(objectKey: string): Promise<Readable> {
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      })
    );
    if (!response.Body) {
      throw new AppError('Logo file not found', 404, 'LOGO_NOT_FOUND');
    }
    return response.Body as Readable;
  }

  async delete(objectKey: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      })
    );
  }
}

export class DormitoryLogoService {
  private prisma: PrismaClient;
  private provider: DormitoryLogoStorageProvider;

  constructor(prisma?: PrismaClient, provider?: DormitoryLogoStorageProvider) {
    this.prisma = prisma || getPrismaClient();
    if (provider) {
      this.provider = provider;
    } else if (process.env.STORAGE_PROVIDER === 's3') {
      this.provider = new S3DormitoryLogoStorage();
    } else {
      this.provider = new LocalDormitoryLogoStorage();
    }
  }

  async uploadLogo(params: {
    dormitoryId: string;
    buffer: Buffer;
    originalName?: string;
  }): Promise<{
    dormitoryId: string;
    logoUrl: string;
    sha256: string;
    mimeType: string;
    updatedAt: Date;
  }> {
    const { dormitoryId, buffer } = params;

    if (!dormitoryId) {
      throw new AppError('Dormitory ID is required', 400, 'DORMITORY_ID_REQUIRED');
    }

    if (!buffer || buffer.length === 0) {
      throw new AppError('กรุณาเลือกไฟล์โลโก้หอพัก', 400, 'EMPTY_FILE');
    }

    if (buffer.length > 5 * 1024 * 1024) {
      throw new AppError('ขนาดไฟล์โลโก้ต้องไม่เกิน 5MB', 400, 'FILE_TOO_LARGE');
    }

    // Strictly validate binary signature
    const { mimeType, extension } = validateImageMagicBytes(buffer);

    // Verify dormitory exists (including provisional setup_pending)
    const dorm = await this.prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { id: true, logoObjectKey: true },
    });

    if (!dorm) {
      throw new AppError('ไม่พบข้อมูลหอพัก', 404, 'DORMITORY_NOT_FOUND');
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const randomKey = crypto.randomUUID();
    const objectKey = `dormitory-logos/${dormitoryId}/${randomKey}.${extension}`;

    // Physical save
    await this.provider.save(objectKey, buffer, mimeType);

    // Delete old physical file if exists
    if (dorm.logoObjectKey && this.provider.delete) {
      this.provider.delete(dorm.logoObjectKey).catch((err) => {
        logger.warn({ err, oldKey: dorm.logoObjectKey }, 'Failed to delete old logo file');
      });
    }

    const now = new Date();
    await this.prisma.dormitory.update({
      where: { id: dormitoryId },
      data: {
        logoObjectKey: objectKey,
        logoMimeType: mimeType,
        logoSha256: sha256,
        logoUpdatedAt: now,
      },
    });

    logger.info({ dormitoryId, objectKey, mimeType }, '[DormitoryLogo] Uploaded and saved dormitory logo');

    return {
      dormitoryId,
      logoUrl: `/api/v1/dormitories/${dormitoryId}/logo`,
      sha256,
      mimeType,
      updatedAt: now,
    };
  }

  async getLogoStream(dormitoryId: string): Promise<{ stream: Readable; mimeType: string }> {
    const dorm = await this.prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { id: true, logoObjectKey: true, logoMimeType: true },
    });

    if (!dorm || !dorm.logoObjectKey) {
      throw new AppError('ไม่พบโลโก้ของหอพักนี้', 404, 'LOGO_NOT_FOUND');
    }

    const stream = await this.provider.getStream(dorm.logoObjectKey);
    return {
      stream,
      mimeType: dorm.logoMimeType || 'image/png',
    };
  }

  async deleteLogo(dormitoryId: string): Promise<{ success: boolean }> {
    const dorm = await this.prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { id: true, logoObjectKey: true },
    });

    if (!dorm) {
      throw new AppError('ไม่พบข้อมูลหอพัก', 404, 'DORMITORY_NOT_FOUND');
    }

    if (dorm.logoObjectKey && this.provider.delete) {
      await this.provider.delete(dorm.logoObjectKey).catch(() => {});
    }

    await this.prisma.dormitory.update({
      where: { id: dormitoryId },
      data: {
        logoObjectKey: null,
        logoMimeType: null,
        logoSha256: null,
        logoUpdatedAt: new Date(),
      },
    });

    logger.info({ dormitoryId }, '[DormitoryLogo] Deleted dormitory logo');

    return { success: true };
  }
}

export const dormitoryLogoService = new DormitoryLogoService();
