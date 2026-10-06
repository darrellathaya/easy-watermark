// pdf-lib export path (spec §6).

import {
  PDFDocument,
  EncryptedPDFError as PdfLibEncryptedPDFError,
  beginMarkedContent,
  degrees,
  endMarkedContent,
  rgb,
  type PDFFont,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { computeWatermarkLayout, type FontMetrics } from './layout';
import { loadFontBytes, getFontDef } from './fonts';
import { stripStampedWatermark, WATERMARK_TAG, writeWatermarkMarker } from './watermarkTag';
import { removeWatermarks, type WatermarkKind } from './removeWatermark';

export interface ApplyWatermarkOptions {
  /**
   * Also remove watermarks this app didn't apply, by strategy. Opt-in per
   * file, since the inferred strategies are heuristics.
   */
  remove?: readonly WatermarkKind[];
}
import { resolvedFontSize, type WatermarkConfig } from './watermarkConfig';

/** Thrown when a PDF is password/encryption-protected; the UI surfaces this and skips the file. */
export class EncryptedPdfError extends Error {
  constructor(fileName?: string) {
    super(`This PDF${fileName ? ` (${fileName})` : ''} is password-protected and was skipped.`);
    this.name = 'EncryptedPdfError';
  }
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return { r, g, b };
}

/** Normalizes a page's /Rotate value to one of 0, 90, 180, 270. */
function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const norm = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return norm as 0 | 90 | 180 | 270;
}

/**
 * Maps a point computed in *visual* page space (what the viewer displays,
 * after /Rotate is applied) back into the page's raw content coordinate
 * space, which is what PDFPage#drawText expects. See spec §6.
 */
function visualToContentPoint(X: number, Y: number, contentW: number, contentH: number, rotation: 0 | 90 | 180 | 270): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return { x: X, y: Y };
    case 90:
      return { x: contentW - Y, y: X };
    case 180:
      return { x: contentW - X, y: contentH - Y };
    case 270:
      return { x: Y, y: contentH - X };
  }
}

async function embedConfiguredFont(pdfDoc: PDFDocument, fontId: string): Promise<PDFFont> {
  const bytes = await loadFontBytes(fontId);
  // pdf-lib mutates/consumes the buffer it's handed; give it a private copy
  // so re-exporting the same document (or embedding into another one) with
  // the cached bytes stays repeatable.
  return pdfDoc.embedFont(bytes.slice(0), { subset: true });
}

/**
 * Watermarks every page of a PDF and returns the new document bytes. Never
 * mutates `bytes`; always works from a copy so re-export is repeatable.
 */
export async function applyWatermark(
  bytes: ArrayBuffer,
  cfg: WatermarkConfig,
  fileName?: string,
  options: ApplyWatermarkOptions = {},
): Promise<Uint8Array> {
  const copy = bytes.slice(0);

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(copy, { ignoreEncryption: false });
  } catch (err) {
    if (err instanceof PdfLibEncryptedPDFError) {
      throw new EncryptedPdfError(fileName);
    }
    throw err;
  }

  // Replace rather than stack: if this app stamped the file before, remove
  // that watermark first. Must happen before anything draws on the pages
  // (both strippers rewrite each page's Contents outright).
  stripStampedWatermark(pdfDoc);
  if (options.remove?.length) removeWatermarks(pdfDoc, options.remove);

  pdfDoc.registerFontkit(fontkit);
  const font = await embedConfiguredFont(pdfDoc, cfg.fontId);

  const metrics: FontMetrics = {
    measure: (line) => font.widthOfTextAtSize(line, 100) / 100,
    capHeight: font.heightAtSize(1),
  };

  const { r, g, b } = hexToRgb01(cfg.color);
  const color = rgb(r, g, b);

  for (const page of pdfDoc.getPages()) {
    const { width: contentW, height: contentH } = page.getSize();
    const rotation = normalizeRotation(page.getRotation().angle);
    const isSideways = rotation === 90 || rotation === 270;
    const visualW = isSideways ? contentH : contentW;
    const visualH = isSideways ? contentW : contentH;

    const { fontSize, tiles } = computeWatermarkLayout({
      pageWidth: visualW,
      pageHeight: visualH,
      text: cfg.text,
      angleDeg: cfg.angle,
      columns: cfg.columns,
      rows: cfg.rows,
      gapRatio: cfg.gapRatio,
      maxLines: cfg.maxLines,
      fontSize: resolvedFontSize(cfg),
      metrics,
    });

    const drawAngleDeg = cfg.angle + rotation;

    // Bound this app's operators so a later export can find and remove
    // exactly them, and nothing of the original page.
    page.pushOperators(beginMarkedContent(WATERMARK_TAG));

    for (const tile of tiles) {
      const { x, y } = visualToContentPoint(tile.x, tile.y, contentW, contentH, rotation);
      // One line per tile, so pdf-lib never does its own newline handling
      // (which the canvas preview has no equivalent for).
      page.drawText(tile.text, {
        x,
        y,
        size: fontSize,
        font,
        color,
        opacity: cfg.opacity,
        rotate: degrees(drawAngleDeg),
      });
    }

    page.pushOperators(endMarkedContent());
  }

  writeWatermarkMarker(pdfDoc, cfg);

  return pdfDoc.save();
}

/**
 * The long edge of a page built around an image, in PDF points: A4's long
 * edge. Treating pixels as points would make a phone photo a 42-inch page,
 * so the page is scaled to the image's aspect ratio instead. The embedded
 * PNG keeps its full resolution either way, so nothing is resampled.
 */
const IMAGE_PAGE_LONG_EDGE_PT = 842;

/**
 * Wraps already-watermarked PNG bytes in a single-page PDF whose page matches
 * the image's aspect ratio exactly, so the image fills it edge to edge with
 * no letterboxing and no margins.
 */
export async function wrapImageInPdf(pngBytes: Uint8Array, pixelWidth: number, pixelHeight: number): Promise<Uint8Array> {
  if (pixelWidth <= 0 || pixelHeight <= 0) {
    throw new Error('Cannot build a PDF page from an image with no dimensions.');
  }

  const pdfDoc = await PDFDocument.create();
  // pdf-lib may consume the buffer it's handed; give it a private copy so the
  // caller's bytes stay reusable.
  const image = await pdfDoc.embedPng(pngBytes.slice());

  const longEdge = Math.max(pixelWidth, pixelHeight);
  const scale = IMAGE_PAGE_LONG_EDGE_PT / longEdge;
  const pageWidth = pixelWidth * scale;
  const pageHeight = pixelHeight * scale;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

  return pdfDoc.save();
}

/**
 * Removes watermarks without applying a new one: this app's own tagged
 * watermark always, plus the selected general strategies. Returns the new
 * document bytes and how many items were removed.
 */
export async function stripWatermarksOnly(
  bytes: ArrayBuffer,
  kinds: readonly WatermarkKind[],
  fileName?: string,
): Promise<{ bytes: Uint8Array; removed: number }> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: false });
  } catch (err) {
    if (err instanceof PdfLibEncryptedPDFError) throw new EncryptedPdfError(fileName);
    throw err;
  }

  let removed = stripStampedWatermark(pdfDoc);
  if (kinds.length) removed += removeWatermarks(pdfDoc, kinds);

  return { bytes: await pdfDoc.save(), removed };
}

/** Triggers a browser download of the given bytes via an object URL, then revokes it. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType = 'application/pdf'): void {
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { getFontDef };
