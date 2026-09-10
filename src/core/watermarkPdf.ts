// pdf-lib export path (spec §6).

import { PDFDocument, EncryptedPDFError as PdfLibEncryptedPDFError, degrees, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { computeWatermarkLayout, type FontMetrics } from './layout';
import { loadFontBytes, getFontDef } from './fonts';
import type { WatermarkConfig } from './watermarkConfig';

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
 * mutates `bytes` — always works from a copy so re-export is repeatable.
 */
export async function applyWatermark(bytes: ArrayBuffer, cfg: WatermarkConfig, fileName?: string): Promise<Uint8Array> {
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

  pdfDoc.registerFontkit(fontkit);
  const font = await embedConfiguredFont(pdfDoc, cfg.fontId);

  const unitWidth = font.widthOfTextAtSize(cfg.text, 100) / 100;
  const capHeight = font.heightAtSize(1);
  const metrics: FontMetrics = { unitWidth, capHeight };

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
      metrics,
    });

    const drawAngleDeg = cfg.angle + rotation;

    for (const tile of tiles) {
      const { x, y } = visualToContentPoint(tile.x, tile.y, contentW, contentH, rotation);
      page.drawText(cfg.text, {
        x,
        y,
        size: fontSize,
        font,
        color,
        opacity: cfg.opacity,
        rotate: degrees(drawAngleDeg),
      });
    }
  }

  return pdfDoc.save();
}

/** Triggers a browser download of the given bytes via an object URL, then revokes it. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/pdf' });
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
