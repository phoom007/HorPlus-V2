/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility function to convert an uploaded image File to compressed WebP data URL.
 * Automatically resizes image if max dimension exceeds maxDimension, and converts to image/webp format.
 */
export async function convertImageToWebP(
  file: File,
  quality: number = 0.82,
  maxDimension: number = 1920
): Promise<string> {
  return new Promise((resolve, reject) => {
    // If already webp data url or non-image, handle or load directly
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        try {
          const webpDataUrl = canvas.toDataURL('image/webp', quality);
          resolve(webpDataUrl);
        } catch (err) {
          // Fallback to original read if webp export fails
          resolve(e.target?.result as string);
        }
      };
      img.onerror = (err) => reject(err);
      img.src = e.target?.result as string;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export const UPLOAD_DROPZONE_TEXT =
  'ลากไฟล์รูปภาพมาวาง หรือ คลิกเพื่ออัปโหลด\nรองรับไฟล์ PNG, JPG, WEBP ขนาดสูงสุด 10MB';
