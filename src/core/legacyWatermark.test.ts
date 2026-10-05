// @vitest-environment node
/// <reference types="node" />
//
// Builds PDFs shaped exactly like this app's PRE-tagging exports (drawText
// per tile, rotated, with opacity, and no marked content) and checks the
// heuristic finds the watermark and nothing else.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { findLegacyBlocks, MIN_TILES_PER_PAGE, scanLegacyWatermark, stripLegacyWatermark } from './legacyWatermark';
import { readPageContent, scanOperators } from './pdfContentStream';
import { applyWatermark } from './watermarkPdf';
import { detectStampInBytes } from './watermarkTag';
import { DEFAULT_WATERMARK_CONFIG } from './watermarkConfig';

beforeAll(() => {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);
    const bytes = readFileSync(join(process.cwd(), 'public', url.replace(/^\//, '')));
    return Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    } as Response);
  }) as typeof fetch;
});

/** A PDF shaped like an old export: body text plus `tiles` watermark tiles. */
async function legacyStylePdf({ tiles = 8, pages = 1, bodyLines = 3, opacity = 0.45 } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([400, 500]);
    for (let b = 0; b < bodyLines; b++) {
      page.drawText(`Body line ${b} on page ${p}`, { x: 30, y: 460 - b * 20, size: 12, font });
    }
    for (let t = 0; t < tiles; t++) {
      page.drawText('CONFIDENTIAL', {
        x: 30 + (t % 2) * 150,
        y: 60 + Math.floor(t / 2) * 90,
        size: 24,
        font,
        color: rgb(0.72, 0.72, 0.76),
        opacity,
        rotate: degrees(-45),
      });
    }
  }
  return doc.save();
}

function countShownText(content: string): number {
  let n = 0;
  for (const token of scanOperators(content)) if (token.op === 'Tj' || token.op === 'TJ') n++;
  return n;
}

describe('legacy watermark detection', () => {
  it('finds every watermark tile and leaves body text alone', async () => {
    const doc = await PDFDocument.load(await legacyStylePdf({ tiles: 8, bodyLines: 3 }));
    const content = readPageContent(doc, 0)!;

    expect(countShownText(content)).toBe(11); // 3 body + 8 tiles
    expect(findLegacyBlocks(content)).toHaveLength(8);
  });

  it('reports tile and page counts across a multi-page document', async () => {
    const doc = await PDFDocument.load(await legacyStylePdf({ tiles: 6, pages: 3 }));
    expect(scanLegacyWatermark(doc)).toEqual({ blocks: 18, pages: 3 });
  });

  it('detects a fully opaque watermark too, since the opacity state is still emitted', async () => {
    const doc = await PDFDocument.load(await legacyStylePdf({ tiles: 6, opacity: 1 }));
    expect(scanLegacyWatermark(doc)?.blocks).toBe(6);
  });

  it('removes only the tiles, keeping every body line', async () => {
    const doc = await PDFDocument.load(await legacyStylePdf({ tiles: 8, bodyLines: 3 }));
    expect(stripLegacyWatermark(doc)).toBe(8);

    const after = readPageContent(doc, 0)!;
    expect(countShownText(after)).toBe(3);
    expect(scanLegacyWatermark(doc)).toBeNull();
  });

  it('ignores a document with no watermark at all', async () => {
    const doc = await PDFDocument.load(await legacyStylePdf({ tiles: 0, bodyLines: 5 }));
    expect(scanLegacyWatermark(doc)).toBeNull();
  });

  it('ignores repeated text that is not semi-transparent, such as table cells', async () => {
    // Same string many times, same size and colour, but drawn without an
    // opacity, so pdf-lib emits no graphics state: not a watermark.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 500]);
    for (let i = 0; i < 12; i++) {
      page.drawText('N/A', { x: 40 + (i % 3) * 80, y: 400 - Math.floor(i / 3) * 30, size: 12, font });
    }
    const reloaded = await PDFDocument.load(await doc.save());
    expect(scanLegacyWatermark(reloaded)).toBeNull();
  });

  it('ignores a grid below the repetition threshold', async () => {
    const doc = await PDFDocument.load(await legacyStylePdf({ tiles: MIN_TILES_PER_PAGE - 1 }));
    expect(scanLegacyWatermark(doc)).toBeNull();
  });
});

describe('replacing a legacy watermark through the real export path', () => {
  it('strips the old watermark and applies a new tagged one when opted in', async () => {
    const legacyBytes = await legacyStylePdf({ tiles: 8, bodyLines: 3, pages: 2 });
    const source = legacyBytes.buffer.slice(
      legacyBytes.byteOffset,
      legacyBytes.byteOffset + legacyBytes.byteLength,
    ) as ArrayBuffer;

    // Before: no tag, but a detectable legacy watermark.
    expect((await detectStampInBytes(source)).tagged).toBe(false);
    expect(await (async () => scanLegacyWatermark(await PDFDocument.load(source.slice(0))))()).toEqual({
      blocks: 16,
      pages: 2,
    });

    const out = await applyWatermark(source, { ...DEFAULT_WATERMARK_CONFIG, text: 'NEW ONE' }, 'old.pdf', {
      stripLegacy: true,
    });
    const result = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;

    // After: tagged (so future exports replace it exactly), and the old
    // untagged tiles are gone rather than layered under the new ones.
    const detected = await detectStampInBytes(result);
    expect(detected.tagged).toBe(true);
    expect(detected.config?.text).toBe('NEW ONE');

    const reloaded = await PDFDocument.load(result.slice(0));
    expect(scanLegacyWatermark(reloaded)).toBeNull();

    // Body text survived on both pages.
    for (let i = 0; i < 2; i++) {
      expect(countShownText(readPageContent(reloaded, i)!)).toBeGreaterThanOrEqual(3);
    }
  });

  it('leaves the old watermark in place when not opted in', async () => {
    const legacyBytes = await legacyStylePdf({ tiles: 8 });
    const source = legacyBytes.buffer.slice(
      legacyBytes.byteOffset,
      legacyBytes.byteOffset + legacyBytes.byteLength,
    ) as ArrayBuffer;

    const out = await applyWatermark(source, DEFAULT_WATERMARK_CONFIG, 'old.pdf');
    const result = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;

    // The heuristic is opt-in: without it the old 8 tiles are still there,
    // and the scan counts only those, not the new tagged ones.
    expect(scanLegacyWatermark(await PDFDocument.load(result.slice(0)))).toEqual({ blocks: 8, pages: 1 });
  });
});
