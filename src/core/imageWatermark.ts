// Image watermarking (spec §10 stretch goal): PNG/JPEG/WebP in, PNG or a
// single-page PDF out.
//
// The raster output is always PNG, never JPEG: it's lossless, so re-exporting
// doesn't compound artifacts, and it preserves an alpha channel the source
// may have had. The PDF output embeds that same PNG, so both formats carry
// pixel-identical content.

import { drawWatermark } from './canvasWatermark';
import { wrapImageInPdf } from './watermarkPdf';
import type { WatermarkConfig } from './watermarkConfig';

/** The formats an image can be exported as. */
export type ImageExportFormat = 'png' | 'pdf';

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

interface WatermarkedImage {
  /** PNG bytes of the watermarked image, at the source's native resolution. */
  pngBytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * Watermarks an image at its native resolution and encodes it as PNG. Never
 * mutates `bytes`, so re-export is repeatable.
 */
async function watermarkImage(
  bytes: ArrayBuffer,
  mimeType: string,
  cfg: WatermarkConfig,
  fileName?: string,
): Promise<WatermarkedImage> {
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

  return {
    pngBytes: new Uint8Array(await blob.arrayBuffer()),
    pixelWidth: bitmap.width,
    pixelHeight: bitmap.height,
  };
}

/** Watermarks an image and returns PNG bytes. */
export async function applyImageWatermark(
  bytes: ArrayBuffer,
  mimeType: string,
  cfg: WatermarkConfig,
  fileName?: string,
): Promise<Uint8Array> {
  return (await watermarkImage(bytes, mimeType, cfg, fileName)).pngBytes;
}

/**
 * Watermarks an image and returns it as a single-page PDF, with the full
 * watermarked PNG embedded (no resampling, so no detail is lost).
 */
export async function applyImageWatermarkAsPdf(
  bytes: ArrayBuffer,
  mimeType: string,
  cfg: WatermarkConfig,
  fileName?: string,
): Promise<Uint8Array> {
  const { pngBytes, pixelWidth, pixelHeight } = await watermarkImage(bytes, mimeType, cfg, fileName);
  return wrapImageInPdf(pngBytes, pixelWidth, pixelHeight);
}

/** Bytes, extension and MIME type for one image export format. */
export async function exportImage(
  format: ImageExportFormat,
  bytes: ArrayBuffer,
  mimeType: string,
  cfg: WatermarkConfig,
  fileName?: string,
): Promise<{ bytes: Uint8Array; extension: string; mimeType: string }> {
  if (format === 'pdf') {
    return {
      bytes: await applyImageWatermarkAsPdf(bytes, mimeType, cfg, fileName),
      extension: 'pdf',
      mimeType: 'application/pdf',
    };
  }
  return {
    bytes: await applyImageWatermark(bytes, mimeType, cfg, fileName),
    extension: 'png',
    mimeType: 'image/png',
  };
}
