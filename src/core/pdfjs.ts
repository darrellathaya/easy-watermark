// pdf.js preview loader (spec §5 preview pane).
//
// The worker MUST be resolved via a `?url` import, never a hardcoded path or
// CDN, so it survives the production build (spec §9.3).

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export class PasswordProtectedError extends Error {
  constructor(fileName?: string) {
    super(`This PDF${fileName ? ` (${fileName})` : ''} is password-protected and was skipped.`);
    this.name = 'PasswordProtectedError';
  }
}

export type { PDFDocumentProxy, PDFPageProxy, RenderTask };

export async function loadPdfJsDocument(bytes: ArrayBuffer, fileName?: string): Promise<PDFDocumentProxy> {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
    return await loadingTask.promise;
  } catch (err) {
    if (err instanceof pdfjsLib.PasswordException) {
      throw new PasswordProtectedError(fileName);
    }
    throw err;
  }
}

export function isRenderingCancelledException(err: unknown): boolean {
  return err instanceof pdfjsLib.RenderingCancelledException;
}

/**
 * Starts rendering one page onto `canvas` at a device-pixel-ratio-correct
 * scale for the given CSS width. Returns the underlying pdf.js RenderTask
 * (so a caller can `.cancel()` it if superseded by a newer render on the
 * same canvas — pdf.js throws if two renders overlap on one canvas) plus a
 * `result` promise resolving to the page's *visual* (post-rotation) size in
 * PDF points — the same box the exporter tiles against.
 */
export function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): { task: RenderTask; result: Promise<{ visualWidth: number; visualHeight: number; cssHeight: number }> } {
  const baseViewport = page.getViewport({ scale: 1 });
  const cssScale = cssWidth / baseViewport.width;
  const cssHeight = baseViewport.height * cssScale;

  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: cssScale * dpr });

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const task = page.render({ canvas, viewport });
  const result = task.promise.then(() => ({
    visualWidth: baseViewport.width,
    visualHeight: baseViewport.height,
    cssHeight,
  }));

  return { task, result };
}
