/**
 * Image conversion utilities using Sharp
 */

import sharp from 'sharp';
import type { SUPPORTED_FORMATS, SupportedFormat } from './types.js';

// =============================================================================
// Format Detection
// =============================================================================

/**
 * Detect image format from content type or filename
 */
export function detectFormat(contentType: string, filename: string): SupportedFormat | null {
  const contentTypeMap: Record<string, SupportedFormat> = {
    'image/tiff': 'tiff',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpg',
  };

  // Check content type
  if (contentTypeMap[contentType]) {
    return contentTypeMap[contentType];
  }

  // Check filename extension
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext) {
    const formats: typeof SUPPORTED_FORMATS = ['tiff', 'png', 'webp', 'avif', 'gif', 'jpeg', 'jpg'];
    if (formats.includes(ext as SupportedFormat)) {
      return ext as SupportedFormat;
    }
    // Handle .tif extension
    if (ext === 'tif') {
      return 'tiff';
    }
  }

  return null;
}

// =============================================================================
// Image Conversion
// =============================================================================

/**
 * Convert image to JPEG using Sharp
 *
 * For GIFs, extracts the first frame only
 * For other formats, converts directly to JPEG
 */
export async function convertToJpeg(
  imageBuffer: ArrayBuffer,
  quality: number,
  sourceFormat: SupportedFormat
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const inputBuffer = Buffer.from(imageBuffer);

  const pipeline = sharp(inputBuffer, {
    // For animated formats (GIF), only process first frame
    pages: sourceFormat === 'gif' ? 1 : undefined,
  });

  const { data, info } = await pipeline
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
  };
}
