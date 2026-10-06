// @vitest-environment node
/// <reference types="node" />
//
// Builds PDFs carrying each watermark form other producers use, and checks
// each strategy finds its own and leaves everything else alone.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFOperator, PDFOperatorNames, StandardFonts, degrees, rgb } from 'pdf-lib';

/**
 * Emits a raw marked-content operator, standing in for another producer's
 * output. pdf-lib's own helper takes only a tag, and its operand type doesn't
 * admit the inline property dictionary a watermark artifact carries, so the
 * args are cast through.
 */
function markedContent(name: PDFOperatorNames, args: unknown[]): PDFOperator {
  return PDFOperator.of(name, args as Parameters<typeof PDFOperator.of>[1]);
}
import { MIN_REPEATS_PER_PAGE, removeWatermarks, scanWatermarks, type WatermarkKind } from './removeWatermark';
import { readPageContent, scanOperators } from './pdfContentStream';
import { applyWatermark, stripWatermarksOnly } from './watermarkPdf';
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

/** Reloads a document so everything is parsed the way a real file would be. */
async function roundTrip(doc: PDFDocument): Promise<PDFDocument> {
  return PDFDocument.load(await doc.save());
}

async function docWithBody(pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([400, 500]);
    for (let b = 0; b < 3; b++) {
      page.drawText(`Body line ${b} page ${p}`, { x: 30, y: 460 - b * 20, size: 12, font });
    }
  }
  return { doc, font };
}

function countShown(content: string): number {
  let n = 0;
  for (const token of scanOperators(content)) {
    if (token.op === 'Tj' || token.op === 'TJ') n++;
  }
  return n;
}

function finding(findings: ReturnType<typeof scanWatermarks>, kind: WatermarkKind) {
  return findings.find((f) => f.kind === kind);
}

describe('watermark annotations', () => {
  async function withAnnotations(subtypes: string[]) {
    const { doc } = await docWithBody();
    const page = doc.getPages()[0];
    const annots = subtypes.map((subtype) =>
      doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: subtype, Rect: [10, 10, 390, 490], F: 4 }),
      ),
    );
    page.node.set(PDFName.of('Annots'), doc.context.obj(annots));
    return roundTrip(doc);
  }

  it('finds /Watermark and /Stamp annotations', async () => {
    const found = finding(scanWatermarks(await withAnnotations(['Watermark', 'Stamp'])), 'annotation');
    expect(found?.count).toBe(2);
    expect(found?.declared).toBe(true);
  });

  it('ignores ordinary annotations such as links', async () => {
    expect(scanWatermarks(await withAnnotations(['Link', 'Popup']))).toHaveLength(0);
  });

  it('removes only the watermark annotations', async () => {
    const doc = await withAnnotations(['Link', 'Watermark', 'Stamp']);
    expect(removeWatermarks(doc, ['annotation'])).toBe(2);

    const annots = doc.getPages()[0].node.Annots();
    expect(annots?.size()).toBe(1);
    expect(scanWatermarks(doc)).toHaveLength(0);
  });
});

describe('self-declared watermark marked content', () => {
  async function withArtifact() {
    const { doc, font } = await docWithBody();
    const page = doc.getPages()[0];
    page.pushOperators(
      markedContent(PDFOperatorNames.BeginMarkedContentSequence, [
        PDFName.of('Artifact'),
        doc.context.obj({ Subtype: 'Watermark' }),
      ]),
    );
    page.drawText('CONFIDENTIAL', { x: 40, y: 200, size: 30, font, color: rgb(0.8, 0.8, 0.8) });
    page.pushOperators(markedContent(PDFOperatorNames.EndMarkedContent, []));
    return roundTrip(doc);
  }

  it('finds an /Artifact <</Subtype /Watermark>> region', async () => {
    const found = finding(scanWatermarks(await withArtifact()), 'artifact');
    expect(found?.count).toBe(1);
    expect(found?.declared).toBe(true);
  });

  it('removes the region and keeps the body text', async () => {
    const doc = await withArtifact();
    const before = countShown(readPageContent(doc, 0)!);
    expect(removeWatermarks(doc, ['artifact'])).toBe(1);

    const after = countShown(readPageContent(doc, 0)!);
    expect(before - after).toBe(1);
    expect(after).toBe(3);
  });

  it('finds optional content on a layer named like a watermark', async () => {
    const { doc, font } = await docWithBody();
    const page = doc.getPages()[0];
    const ocg = doc.context.register(doc.context.obj({ Type: 'OCG', Name: 'Watermark' }));
    page.node.Resources()!.set(PDFName.of('Properties'), doc.context.obj({ MC0: ocg }));
    page.pushOperators(
      markedContent(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of('MC0')]),
    );
    page.drawText('DRAFT', { x: 40, y: 200, size: 30, font });
    page.pushOperators(markedContent(PDFOperatorNames.EndMarkedContent, []));

    const reloaded = await roundTrip(doc);
    expect(finding(scanWatermarks(reloaded), 'artifact')?.count).toBe(1);
  });
});

describe('repeated text and image tiles', () => {
  async function withTiles({ tiles = 8, opacity = 0.4, rotate = -45, color = rgb(0.72, 0.72, 0.76) } = {}) {
    const { doc, font } = await docWithBody();
    const page = doc.getPages()[0];
    for (let t = 0; t < tiles; t++) {
      page.drawText('CONFIDENTIAL', {
        x: 30 + (t % 2) * 150,
        y: 60 + Math.floor(t / 2) * 90,
        size: 24,
        font,
        color,
        opacity,
        rotate: degrees(rotate),
      });
    }
    return roundTrip(doc);
  }

  it('finds a tiled text watermark and reports it as inferred, not declared', async () => {
    const found = finding(scanWatermarks(await withTiles({ tiles: 8 })), 'repeatedText');
    expect(found?.count).toBe(8);
    expect(found?.declared).toBe(false);
  });

  it('finds an opaque but rotated watermark', async () => {
    expect(finding(scanWatermarks(await withTiles({ opacity: 1, rotate: -45 })), 'repeatedText')?.count).toBe(8);
  });

  it('finds an upright light-grey watermark', async () => {
    expect(finding(scanWatermarks(await withTiles({ opacity: 1, rotate: 0 })), 'repeatedText')?.count).toBe(8);
  });

  it('removes the tiles and keeps every body line', async () => {
    const doc = await withTiles({ tiles: 8 });
    expect(removeWatermarks(doc, ['repeatedText'])).toBe(8);
    expect(countShown(readPageContent(doc, 0)!)).toBe(3);
    expect(scanWatermarks(doc)).toHaveLength(0);
  });

  it('ignores repeated opaque black text, such as table cells', async () => {
    const { doc, font } = await docWithBody();
    const page = doc.getPages()[0];
    for (let i = 0; i < 12; i++) {
      page.drawText('N/A', { x: 40 + (i % 3) * 80, y: 400 - Math.floor(i / 3) * 30, size: 12, font });
    }
    expect(scanWatermarks(await roundTrip(doc))).toHaveLength(0);
  });

  it('ignores a grid below the repetition threshold', async () => {
    expect(scanWatermarks(await withTiles({ tiles: MIN_REPEATS_PER_PAGE - 1 }))).toHaveLength(0);
  });

  it('finds a tiled image watermark', async () => {
    const { doc } = await docWithBody();
    const page = doc.getPages()[0];
    // A 1x1 PNG, drawn repeatedly and semi-transparently.
    const png = await doc.embedPng(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    for (let t = 0; t < 6; t++) {
      page.drawImage(png, { x: 40, y: 50 + t * 60, width: 80, height: 40, opacity: 0.3 });
    }
    const reloaded = await roundTrip(doc);
    expect(finding(scanWatermarks(reloaded), 'repeatedImage')?.count).toBe(6);
  });
});

describe('interaction with this app’s own watermark', () => {
  it('does not report or touch a watermark this app tagged', async () => {
    const { doc } = await docWithBody();
    const saved = await doc.save();
    const source = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

    const stamped = await applyWatermark(source, DEFAULT_WATERMARK_CONFIG, 'a.pdf');
    const reloaded = await PDFDocument.load(stamped.slice().buffer);

    // Tagged content is handled exactly by watermarkTag.ts, so the general
    // heuristics must stay out of it.
    expect(scanWatermarks(reloaded)).toHaveLength(0);
    expect(removeWatermarks(reloaded, ['repeatedText', 'artifact', 'annotation'])).toBe(0);
  });
});

describe('replacing a foreign watermark through the real export path', () => {
  /** A PDF watermarked by something other than this app, over two pages. */
  async function foreignWatermarked() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let p = 0; p < 2; p++) {
      const page = doc.addPage([400, 500]);
      for (let b = 0; b < 3; b++) {
        page.drawText(`Body line ${b} page ${p}`, { x: 30, y: 460 - b * 20, size: 12, font });
      }
      for (let t = 0; t < 8; t++) {
        page.drawText('CONFIDENTIAL', {
          x: 30 + (t % 2) * 150,
          y: 60 + Math.floor(t / 2) * 90,
          size: 24,
          font,
          color: rgb(0.72, 0.72, 0.76),
          opacity: 0.4,
          rotate: degrees(-45),
        });
      }
    }
    const saved = await doc.save();
    return saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
  }

  it('strips the foreign watermark and applies a tagged one of our own', async () => {
    const source = await foreignWatermarked();
    expect((await detectStampInBytes(source)).tagged).toBe(false);

    const out = await applyWatermark(source, { ...DEFAULT_WATERMARK_CONFIG, text: 'OURS' }, 'in.pdf', {
      remove: ['repeatedText'],
    });
    const result = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;

    const detected = await detectStampInBytes(result);
    expect(detected.tagged).toBe(true);
    expect(detected.config?.text).toBe('OURS');

    // The foreign tiles are gone rather than layered under ours. This also
    // guards the nesting case: pdf-lib wraps pre-existing page content in an
    // outer q/Q when it appends, so the old tiles sit one level down.
    const reloaded = await PDFDocument.load(result.slice(0));
    expect(scanWatermarks(reloaded)).toHaveLength(0);
    for (let i = 0; i < 2; i++) {
      expect(countShown(readPageContent(reloaded, i)!)).toBeGreaterThanOrEqual(3);
    }
  });

  it('leaves the foreign watermark alone when it was not selected', async () => {
    const out = await applyWatermark(await foreignWatermarked(), DEFAULT_WATERMARK_CONFIG, 'in.pdf');
    const result = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;

    // Removal is opt-in, so the original 16 tiles are still counted, and the
    // tagged watermark we just added is not.
    const found = finding(scanWatermarks(await PDFDocument.load(result.slice(0))), 'repeatedText');
    expect(found?.count).toBe(16);
  });
});

describe('removing without applying a new watermark', () => {
  it('cleans the file and adds nothing', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 500]);
    page.drawText('Keep me', { x: 30, y: 460, size: 12, font });
    for (let t = 0; t < 6; t++) {
      page.drawText('SAMPLE', { x: 40, y: 60 + t * 60, size: 24, font, opacity: 0.3, rotate: degrees(-45) });
    }
    const saved = await doc.save();
    const source = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

    const { bytes, removed } = await stripWatermarksOnly(source, ['repeatedText'], 'in.pdf');
    expect(removed).toBe(6);

    const reloaded = await PDFDocument.load(bytes.slice().buffer);
    expect(scanWatermarks(reloaded)).toHaveLength(0);
    // One body line left, and no watermark of ours was stamped.
    expect(countShown(readPageContent(reloaded, 0)!)).toBe(1);
    expect((await detectStampInBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)).tagged).toBe(false);
  });

  it('reports nothing removed when no strategy is selected', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const saved = await doc.save();
    const source = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

    expect((await stripWatermarksOnly(source, [], 'in.pdf')).removed).toBe(0);
  });
});
