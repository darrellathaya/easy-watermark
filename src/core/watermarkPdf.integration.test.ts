// @vitest-environment node
/// <reference types="node" />
//
// Runs the REAL export path (applyWatermark) end to end, to prove the
// tag/marker survives a round trip and that re-exporting replaces rather
// than stacks. Only the font fetch is stubbed; everything else is production
// code, including fontkit embedding and the content-stream surgery.
//
// Node environment, not jsdom: applyWatermark touches no DOM, and jsdom's
// ArrayBuffer is a different realm than Node's, which pdf-lib's type guards
// reject. Node types are referenced per-file rather than added to
// tsconfig.app.json, so browser code still can't reach for `process` or `fs`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { applyWatermark } from './watermarkPdf';
import { detectStampInBytes, WATERMARK_TAG } from './watermarkTag';
import { DEFAULT_WATERMARK_CONFIG } from './watermarkConfig';

beforeAll(() => {
  // fonts.ts fetches '/fonts/<file>.ttf'; serve it from public/ instead.
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);
    const bytes = readFileSync(join(process.cwd(), 'public', url.replace(/^\//, '')));
    return Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    } as Response);
  }) as typeof fetch;
});

async function makeSourcePdf(pages = 2): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([612, 792]).drawText(`ORIGINAL PAGE ${i + 1}`, { x: 40, y: 740, size: 14, font });
  }
  const saved = await doc.save();
  return saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Counts tagged spans across every page, as the stripper sees them. */
async function countTaggedSpans(bytes: ArrayBuffer): Promise<number> {
  const { PDFArray, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes.slice(0));
  let total = 0;
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    if (!contents) continue;
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const text = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
      total += (text.match(new RegExp(`/${WATERMARK_TAG}\\s+BMC`, 'g')) ?? []).length;
    }
  }
  return total;
}

describe('applyWatermark marker round trip', () => {
  it('writes a marker that reads back from its own output', async () => {
    const source = await makeSourcePdf();
    const config = { ...DEFAULT_WATERMARK_CONFIG, text: 'FIRST PASS' };

    const stamped = toArrayBuffer(await applyWatermark(source, config, 'source.pdf'));

    const detected = await detectStampInBytes(stamped);
    expect(detected.tagged).toBe(true);
    expect(detected.config?.text).toBe('FIRST PASS');
  });

  it('tags every page', async () => {
    const source = await makeSourcePdf(3);
    const stamped = toArrayBuffer(await applyWatermark(source, DEFAULT_WATERMARK_CONFIG, 'source.pdf'));
    expect(await countTaggedSpans(stamped)).toBe(3);
  });

  it('replaces its own watermark instead of stacking on re-export', async () => {
    const source = await makeSourcePdf();
    const first = toArrayBuffer(await applyWatermark(source, { ...DEFAULT_WATERMARK_CONFIG, text: 'FIRST' }, 'a.pdf'));
    expect(await countTaggedSpans(first)).toBe(2);

    const second = toArrayBuffer(await applyWatermark(first, { ...DEFAULT_WATERMARK_CONFIG, text: 'SECOND' }, 'a.pdf'));

    // Still one span per page: the first watermark was removed, not stacked.
    expect(await countTaggedSpans(second)).toBe(2);
    expect((await detectStampInBytes(second)).config?.text).toBe('SECOND');
  });

  it('finds nothing in a file this app never stamped', async () => {
    expect(await detectStampInBytes(await makeSourcePdf())).toEqual({ tagged: false, config: null });
  });
});
