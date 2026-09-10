// Per-file pdf.js document cache, keyed by FileEntry id, so switching
// between already-loaded files in the preview doesn't re-parse the PDF.

import { loadPdfJsDocument, type PDFDocumentProxy } from './pdfjs';

const cache = new Map<string, Promise<PDFDocumentProxy>>();

export function getOrLoadDocument(id: string, bytes: ArrayBuffer, fileName?: string): Promise<PDFDocumentProxy> {
  const cached = cache.get(id);
  if (cached) return cached;
  const promise = loadPdfJsDocument(bytes, fileName);
  promise.catch(() => cache.delete(id));
  cache.set(id, promise);
  return promise;
}

export function evictDocument(id: string): void {
  cache.delete(id);
}
