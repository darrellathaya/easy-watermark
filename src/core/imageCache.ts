// Per-file decoded-image cache, keyed by FileEntry id, mirroring docCache so
// re-selecting an already-loaded image in the preview doesn't decode it again.

import { decodeImage } from './imageWatermark';

const cache = new Map<string, Promise<ImageBitmap>>();

export function getOrDecodeImage(id: string, bytes: ArrayBuffer, mimeType: string, fileName?: string): Promise<ImageBitmap> {
  const cached = cache.get(id);
  if (cached) return cached;
  const promise = decodeImage(bytes, mimeType, fileName);
  promise.catch(() => cache.delete(id));
  cache.set(id, promise);
  return promise;
}

export function evictImage(id: string): void {
  cache.delete(id);
}
