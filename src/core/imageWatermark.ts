// Image watermarking (spec §10 stretch goal): PNG/JPEG/WebP in, PNG out.
//
// Output is always PNG: it's lossless, so re-exporting doesn't compound JPEG
// artifacts, and it preserves an alpha channel the source may have had.

import { drawWatermark } from './canvasWatermark';
import type { WatermarkConfig } from './watermarkConfig';

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

/** Thrown when the browser can't decode a file that claimed to be an image. */
export class ImageDecodeError extends Error {
  constructor(fileName?: string) {
    super(`This image${fileName ? ` (${fileName})` : ''} could not be decoded and was skipped.`);
    this.name = 'ImageDecodeError';
  }
}

export function isImageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    (IMAGE_MIME_TYPES as readonly string[]).includes(file.type) ||
    IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
}

/** Best-effort MIME type for a picked file, since `File.type` can be empty. */
export function imageMimeType(file: File): string {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export async function decodeImage(bytes: ArrayBuffer, mimeType: string, fileName?: string): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(new Blob([bytes.slice(0)], { type: mimeType }));
  } catch {
    throw new ImageDecodeError(fileName);
  }
}

/**
 * Watermarks an image at its native resolution and returns PNG bytes. Never
 * mutates `bytes`, so re-export is repeatable.
 */
export async function applyImageWatermark(
  bytes: ArrayBuffer,
  mimeType: string,
  cfg: WatermarkConfig,
  fileName?: string,
): Promise<Uint8Array> {
  const bitmap = await decodeImage(bytes, mimeType, fileName);

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context to watermark this image.');

  ctx.drawImage(bitmap, 0, 0);
  // Output pixels are the subject's own space here, so scale is 1:1.
  await drawWatermark(ctx, cfg, {
    visualWidth: bitmap.width,
    visualHeight: bitmap.height,
    cssWidth: bitmap.width,
    cssHeight: bitmap.height,
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the watermarked image as a PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}
