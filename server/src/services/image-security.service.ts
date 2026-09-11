import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import crypto from 'crypto';
import { AppError } from '../types/index.js';

export interface SecuredDocumentResult {
  buffer: Buffer;
  mimeType: 'image/webp' | 'application/pdf';
  extension: '.webp' | '.pdf';
  sha256: string;
  byteSize: number;
  width?: number;
  height?: number;
  pageCount?: number;
}

export type SecuredImageResult = SecuredDocumentResult;

export const MAX_DOCUMENT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGE_FILE_SIZE = MAX_DOCUMENT_FILE_SIZE;
export const MAX_SOURCE_DIMENSION = 4096; // 4096 px max width/height
export const MAX_INPUT_PIXELS = 16_777_216; // 16 Megapixels (limitInputPixels)
export const TARGET_MAX_DIMENSION = 1920; // 1920 px output constraint
export const MAX_PDF_PAGE_COUNT = 10;

/**
 * Server-Side Document & Image Security Boundary
 * The client browser is untrusted.
 * 1. Limits raw input memory size (≤ 5MB).
 * 2. For PDF: verifies magic bytes (%PDF-), structural parsing with pdf-lib, page limit (≤10),
 *    rejects encrypted PDFs, and detects active content structures (JavaScript, Launch, EmbeddedFiles, XFA).
 * 3. For Images: decodes raster with Sharp with hard decompression ceiling (16MP),
 *    enforces JPEG/PNG/WebP, rejects non-image vectors, strips all EXIF/metadata,
 *    auto-rotates, downscales cleanly within 1920x1920, and re-encodes to WebP.
 * 4. Never executes embedded metadata or executable content.
 */
export async function processAndSecureTenantDocument(rawBuffer: Buffer): Promise<SecuredDocumentResult> {
  if (!rawBuffer || rawBuffer.length === 0) {
    throw new AppError('File buffer is missing or empty', 400, 'INVALID_FILE_INPUT');
  }

  if (rawBuffer.length > MAX_DOCUMENT_FILE_SIZE) {
    throw new AppError(`File size exceeds maximum limit of 5 MB (${rawBuffer.length} bytes)`, 400, 'FILE_TOO_LARGE');
  }

  // Check magic bytes for PDF
  const isPdf = rawBuffer.subarray(0, 5).toString('ascii') === '%PDF-';

  if (isPdf) {
    // 1. Detect active content patterns (JavaScript, Launch, EmbeddedFiles, XFA)
    const rawAscii = rawBuffer.toString('latin1');
    const disallowedPatterns = [
      /\/JavaScript\b/i,
      /\/JS\b/i,
      /\/Launch\b/i,
      /\/EmbeddedFiles\b/i,
      /\/XFA\b/i,
    ];
    for (const pattern of disallowedPatterns) {
      if (pattern.test(rawAscii)) {
        throw new AppError('PDF contains disallowed active content or scripts', 400, 'DISALLOWED_ACTIVE_CONTENT');
      }
    }

    // 2. Structural parsing with pdf-lib
    let pdfDoc: PDFDocument;
    let pageCount = 0;
    try {
      pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: false });
      if (pdfDoc.isEncrypted) {
        throw new AppError('Encrypted or password-protected PDF documents are not allowed', 400, 'ENCRYPTED_PDF_NOT_ALLOWED');
      }
      pageCount = pdfDoc.getPageCount();
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError('Failed to parse PDF document. File is corrupted or invalid.', 400, 'INVALID_PDF_DOCUMENT');
    }

    if (pageCount < 1) {
      throw new AppError('PDF document has no pages', 400, 'INVALID_PDF_DOCUMENT');
    }
    if (pageCount > MAX_PDF_PAGE_COUNT) {
      throw new AppError(`PDF document exceeds maximum allowable page count for ID verification (max ${MAX_PDF_PAGE_COUNT} pages)`, 400, 'PDF_PAGE_LIMIT_EXCEEDED');
    }

    // 3. Re-save sanitized PDF binary
    let cleanBuffer: Buffer;
    try {
      const cleanPdfBytes = await pdfDoc.save({ useObjectStreams: true });
      cleanBuffer = Buffer.from(cleanPdfBytes);
    } catch (err: any) {
      throw new AppError(`PDF sanitization failed: ${err.message}`, 500, 'PDF_PROCESSING_FAILED');
    }

    const sha256 = crypto.createHash('sha256').update(cleanBuffer).digest('hex');

    return {
      buffer: cleanBuffer,
      mimeType: 'application/pdf',
      extension: '.pdf',
      sha256,
      byteSize: cleanBuffer.length,
      pageCount,
    };
  }

  // Pre-check magic bytes against non-image vectors (e.g. HTML, XML, SVG, EXE, ELF, ZIP)
  const header = rawBuffer.subarray(0, 64).toString('ascii');
  if (
    header.toLowerCase().includes('<svg') ||
    header.toLowerCase().includes('<?xml') ||
    header.toLowerCase().includes('<html') ||
    header.startsWith('MZ') ||
    header.startsWith('\x7fELF') ||
    header.startsWith('PK\x03\x04')
  ) {
    throw new AppError('Unsupported or invalid file format. Only JPEG, PNG, WebP, and PDF are allowed.', 400, 'INVALID_DOCUMENT_FORMAT');
  }

  // Verify raster image magic bytes
  const isJpeg = rawBuffer.length >= 3 && rawBuffer[0] === 0xFF && rawBuffer[1] === 0xD8 && rawBuffer[2] === 0xFF;
  const isPng = rawBuffer.length >= 4 && rawBuffer[0] === 0x89 && rawBuffer[1] === 0x50 && rawBuffer[2] === 0x4E && rawBuffer[3] === 0x47;
  const isWebp = rawBuffer.length >= 12 &&
    rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    rawBuffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!isJpeg && !isPng && !isWebp) {
    throw new AppError('Unsupported or invalid image format. Only JPEG, PNG, WebP, and PDF are allowed.', 400, 'INVALID_IMAGE_FORMAT');
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

/**
 * Backward-compatible alias for existing callers.
 */
export async function processAndSecureTenantIdCardImage(rawBuffer: Buffer): Promise<SecuredDocumentResult> {
  return processAndSecureTenantDocument(rawBuffer);
}
