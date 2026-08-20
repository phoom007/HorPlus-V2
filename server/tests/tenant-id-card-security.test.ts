import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import {
  processAndSecureTenantIdCardImage,
  MAX_IMAGE_FILE_SIZE,
  MAX_SOURCE_DIMENSION,
} from '../src/services/image-security.service.js';
import { LocalStorageProvider } from '../src/services/local-storage.service.js';

describe('Commit B: Tenant ID Card Security, Re-encoding & Storage Tests', () => {
  let sampleValidJpeg: Buffer;
  let sampleValidPng: Buffer;

  beforeEach(async () => {
    // Generate valid test images dynamically with Sharp
    sampleValidJpeg = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    sampleValidPng = await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 4,
        background: { r: 100, g: 150, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  describe('1. Image Security & Re-encoding Pipeline', () => {
    it('successfully processes valid JPEG into WebP and calculates sha256', async () => {
      const result = await processAndSecureTenantIdCardImage(sampleValidJpeg);

      expect(result.mimeType).toBe('image/webp');
      expect(result.extension).toBe('.webp');
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.byteSize).toBeGreaterThan(0);
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);

      // Verify output is actually valid WebP
      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.format).toBe('webp');
    });

    it('successfully converts PNG to WebP and strips metadata', async () => {
      const result = await processAndSecureTenantIdCardImage(sampleValidPng);

      expect(result.mimeType).toBe('image/webp');
      expect(result.width).toBe(300);
      expect(result.height).toBe(200);

      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
    });

    it('downscales large images exceeding 1920px to fit inside 1920x1920', async () => {
      const largeImage = await sharp({
        create: {
          width: 3000,
          height: 2000,
          channels: 3,
          background: { r: 50, g: 50, b: 50 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await processAndSecureTenantIdCardImage(largeImage);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1280);
    });

    it('strictly rejects non-image PDF vectors with 400 INVALID_IMAGE_FORMAT', async () => {
      const fakePdf = Buffer.from('%PDF-1.4\n%Fake PDF malicious payload\n');
      await expect(processAndSecureTenantIdCardImage(fakePdf)).rejects.toThrow(
        'Unsupported or invalid image format'
      );
    });

    it('strictly rejects SVG / HTML script injection vectors with 400 INVALID_IMAGE_FORMAT', async () => {
      const fakeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      await expect(processAndSecureTenantIdCardImage(fakeSvg)).rejects.toThrow(
        'Unsupported or invalid image format'
      );

      const fakeHtml = Buffer.from('<html><body><script>alert(1)</script></body></html>');
      await expect(processAndSecureTenantIdCardImage(fakeHtml)).rejects.toThrow(
        'Unsupported or invalid image format'
      );
    });

    it('strictly rejects files exceeding MAX_IMAGE_FILE_SIZE (5 MB)', async () => {
      const oversizeBuffer = Buffer.alloc(MAX_IMAGE_FILE_SIZE + 1024, 0xff);
      await expect(processAndSecureTenantIdCardImage(oversizeBuffer)).rejects.toThrow(
        'Image file size exceeds maximum limit of 5 MB'
      );
    });

    it('strictly rejects corrupt buffer', async () => {
      const corruptBuffer = Buffer.from('NOT_AN_IMAGE_CORRUPT_BYTES_DATA_HEADER');
      await expect(processAndSecureTenantIdCardImage(corruptBuffer)).rejects.toThrow(
        'Failed to decode image'
      );
    });
  });

  describe('2. Local Storage Provider Safety & Isolation', () => {
    const storage = new LocalStorageProvider();

    it('validates safe object key and rejects path traversal attempts', () => {
      expect(() => storage.resolveSafePath('../../etc/passwd')).toThrow('PATH_TRAVERSAL_DETECTED');
      expect(() => storage.resolveSafePath('tenants/..%2f..%2fsecret.key')).toThrow('PATH_TRAVERSAL_DETECTED');
      expect(() => storage.resolveSafePath('tenants/\0evil.webp')).toThrow('INVALID_OBJECT_KEY');
    });

    it('accepts canonical tenant object key', () => {
      const safePath = storage.resolveSafePath('tenants/dorm-1/doc-123.webp');
      expect(safePath).toContain('doc-123.webp');
    });
  });
});
