// One interface the preview renders through, so the scrolling page column,
// the page counter and the watermark overlay don't need to know whether
// they're showing a PDF or a single image.

import { renderPageToCanvas, type PDFDocumentProxy } from './pdfjs';

export interface PreviewRenderHandle {
  cancel(): void;
}

export interface PreviewPageDims {
  /** The page/image size in its own space: PDF points, or image pixels. */
  visualWidth: number;
  visualHeight: number;
}

export interface PreviewSource {
  readonly pageCount: number;
  /** Size of one page, for reserving scroll height before it renders. */
  getPageSize(page: number): Promise<PreviewPageDims>;
  /**
   * Starts drawing `page` onto `canvas` at `cssWidth`. The handle (if any)
   * cancels an in-flight render, which pdf.js requires before a second
   * render touches the same canvas.
   */
  render(
    page: number,
    canvas: HTMLCanvasElement,
    cssWidth: number,
  ): { handle: PreviewRenderHandle | null; result: Promise<PreviewPageDims & { cssHeight: number }> };
}

export function pdfPreviewSource(doc: PDFDocumentProxy): PreviewSource {
  return {
    pageCount: doc.numPages,
    async getPageSize(page) {
      const viewport = (await doc.getPage(page)).getViewport({ scale: 1 });
      return { visualWidth: viewport.width, visualHeight: viewport.height };
    },
    render(page, canvas, cssWidth) {
      // pdf.js hands back its RenderTask only after the page dict resolves,
      // so the handle proxies whatever task exists by the time cancel() runs.
      let task: PreviewRenderHandle | null = null;
      let cancelled = false;

      const result = doc.getPage(page).then((pdfPage) => {
        if (cancelled) throw new PreviewRenderCancelled();
        const started = renderPageToCanvas(pdfPage, canvas, cssWidth);
        task = started.task;
        if (cancelled) started.task.cancel();
        return started.result;
      });

      return {
        handle: {
          cancel() {
            cancelled = true;
            task?.cancel();
          },
        },
        result,
      };
    },
  };
}

export function imagePreviewSource(bitmap: ImageBitmap): PreviewSource {
  const dims = { visualWidth: bitmap.width, visualHeight: bitmap.height };
  return {
    pageCount: 1,
    getPageSize: () => Promise.resolve(dims),
    render(_page, canvas, cssWidth) {
      const cssHeight = bitmap.width > 0 ? (bitmap.height / bitmap.width) * cssWidth : 0;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.drawImage(bitmap, 0, 0, cssWidth, cssHeight);
      }

      // Synchronous, so there is nothing to cancel.
      return { handle: null, result: Promise.resolve({ ...dims, cssHeight }) };
    },
  };
}

/** Marks a render abandoned before pdf.js had a task of its own to cancel. */
export class PreviewRenderCancelled extends Error {
  constructor() {
    super('Preview render cancelled');
    this.name = 'PreviewRenderCancelled';
  }
}

export function isPreviewRenderCancelled(err: unknown): boolean {
  return err instanceof PreviewRenderCancelled;
}
