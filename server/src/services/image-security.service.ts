import sharp from 'sharp';
import crypto from 'crypto';
import { AppError } from '../types/index.js';

export interface SecuredImageResult {
  buffer: Buffer;
  mimeType: 'image/webp';
  extension: '.webp';
  sha256: string;
  byteSize: number;
  width: number;
  height: number;
}

export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_SOURCE_DIMENSION = 4096; // 4096 px max width/height
export const MAX_INPUT_PIXELS = 16_777_216; // 16 Megapixels (limitInputPixels)
export const TARGET_MAX_DIMENSION = 1920; // 1920 px output constraint

/**
 * Server-Side Image Security Boundary (Sharp Pipeline)
 * The client browser is untrusted.
 * 1. Limits raw input memory size (≤ 5MB).
 * 2. Decodes raster with Sharp with hard decompression pixel ceiling (limitInputPixels).
 * 3. Enforces supported raster formats: JPEG, PNG, WebP (Rejects PDF, SVG, HTML, Scripts, Corrupt images).
 * 4. Verifies max width & height dimensions (≤ 4096px).
 * 5. Auto-rotates orientation based on EXIF before dropping metadata.
 * 6. Downscales cleanly within 1920x1920 without enlargement.
 * 7. Strips all EXIF, GPS, camera metadata, comments, and color profiles.
 * 8. Re-encodes cleanly to server-selected WebP.
 * 9. Computes SHA-256 digest of the regenerated output binary.
 */
export async function processAndSecureTenantIdCardImage(rawBuffer: Buffer): Promise<SecuredImageResult> {
  if (!rawBuffer || rawBuffer.length === 0) {
    throw new AppError('Image file buffer is missing or empty', 400, 'INVALID_IMAGE_INPUT');
  }

  if (rawBuffer.length > MAX_IMAGE_FILE_SIZE) {
    throw new AppError(`Image file size exceeds maximum limit of 5 MB (${rawBuffer.length} bytes)`, 400, 'FILE_TOO_LARGE');
  }

  // Pre-check magic bytes against non-image vectors (e.g. PDF, HTML, XML, SVG, EXE)
  const header = rawBuffer.subarray(0, 16).toString('ascii');
  if (
    header.startsWith('%PDF') ||
    header.toLowerCase().includes('<svg') ||
    header.toLowerCase().includes('<?xml') ||
    header.toLowerCase().includes('<html') ||
    header.startsWith('MZ') ||
    header.startsWith('\x7fELF')
  ) {
    throw new AppError('Unsupported or invalid image format. Only JPEG, PNG, and WebP are allowed.', 400, 'INVALID_IMAGE_FORMAT');
  }

  let image: sharp.Sharp;
  let metadata: sharp.Metadata;

  try {
    image = sharp(rawBuffer, {
      failOnError: true,
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    });
    metadata = await image.metadata();
  } catch (err: any) {
    if (err?.message?.includes('Input image exceeds pixel limit') || err?.message?.includes('pixel limit')) {
      throw new AppError('Image pixel count exceeds maximum allowable limit (Decompression Bomb Protection)', 400, 'PIXEL_LIMIT_EXCEEDED');
    }
    throw new AppError('Failed to decode image. Corrupted or invalid format.', 400, 'INVALID_IMAGE_FORMAT');
  }

  const format = metadata.format;
  if (!format || !['jpeg', 'png', 'webp'].includes(format)) {
    throw new AppError(`Unsupported image format: ${format || 'unknown'}. Only JPEG, PNG, and WebP are allowed.`, 400, 'INVALID_IMAGE_FORMAT');
  }

  const { width, height } = metadata;
  if (!width || !height || width < 1 || height < 1) {
    throw new AppError('Invalid image dimensions', 400, 'INVALID_IMAGE_DIMENSIONS');
  }

  if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) {
    throw new AppError(`Image dimensions (${width}x${height}) exceed maximum allowed ${MAX_SOURCE_DIMENSION}x${MAX_SOURCE_DIMENSION}`, 400, 'DIMENSIONS_EXCEEDED');
  }

  if (width * height > MAX_INPUT_PIXELS) {
    throw new AppError(`Total image pixels (${width * height}) exceed maximum allowed limit of ${MAX_INPUT_PIXELS}`, 400, 'PIXEL_LIMIT_EXCEEDED');
  }

  // Re-encode & Strip all EXIF / GPS / metadata into clean WebP
  let processedBuffer: Buffer;
  try {
    processedBuffer = await sharp(rawBuffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOnError: true,
    })
      .rotate() // Auto-orient based on EXIF before stripping
      .resize(TARGET_MAX_DIMENSION, TARGET_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85, effort: 4 })
      .toBuffer();
  } catch (err: any) {
    throw new AppError(`Image processing and re-encoding failed: ${err.message}`, 500, 'IMAGE_PROCESSING_FAILED');
  }

  const sha256 = crypto.createHash('sha256').update(processedBuffer).digest('hex');
  const outputMetadata = await sharp(processedBuffer).metadata();

  return {
    buffer: processedBuffer,
    mimeType: 'image/webp',
    extension: '.webp',
    sha256,
    byteSize: processedBuffer.length,
    width: outputMetadata.width || width,
    height: outputMetadata.height || height,
  };
}
