import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, beginMarkedContent, endMarkedContent } from 'pdf-lib';
import {
  detectStamp,
  readWatermarkMarker,
  removeTaggedSpans,
  stripStampedWatermark,
  WATERMARK_TAG,
  writeWatermarkMarker,
} from './watermarkTag';
import { DEFAULT_WATERMARK_CONFIG } from './watermarkConfig';

const BODY = 'BT /F1 12 Tf 1 0 0 1 20 700 Tm <48656C6C6F> Tj ET\n';
const span = (inner = 'q 1 0 0 1 0 0 cm <414243> Tj Q ') => `/${WATERMARK_TAG} BMC ${inner}EMC`;

describe('removeTaggedSpans', () => {
  it('leaves content without the tag untouched', () => {
    const result = removeTaggedSpans(BODY);
    expect(result.removed).toBe(0);
    expect(result.content).toBe(BODY);
  });

  it('removes one tagged span and keeps the surrounding content byte for byte', () => {
    const result = removeTaggedSpans(`${BODY}${span()}`);
    expect(result.removed).toBe(1);
    expect(result.content).toBe(BODY);
  });

  it('removes several spans, as left by repeated exports', () => {
    const result = removeTaggedSpans(`${span()}\n${BODY}${span()}`);
    expect(result.removed).toBe(2);
    expect(result.content).toBe(`\n${BODY}`);
  });

  it('matches nesting, so an inner marked-content sequence cannot end the span early', () => {
    const nested = span('q /Tx BDC <414243> Tj EMC Q ');
    const result = removeTaggedSpans(`${BODY}${nested}\n${BODY}`);
    expect(result.removed).toBe(1);
    expect(result.content).toBe(`${BODY}\n${BODY}`);
  });

  it('treats operators as whole tokens, so a letter-adjacent EMC is not one', () => {
    // "EMCBT" is a single (invalid) token, not EMC followed by BT, so the
    // span reads as unterminated and is left alone rather than mis-cut. Real
    // content streams always separate operators, so this is a guard, not a
    // case that occurs: the point is that it fails safe.
    const fused = `${span('q <414243> Tj Q ').slice(0, -3)}EMCBT ET`;
    expect(removeTaggedSpans(fused).removed).toBe(0);
  });

  it('leaves another tool’s marked content alone', () => {
    const other = '/OtherTool BMC <414243> Tj EMC';
    const result = removeTaggedSpans(`${other}\n${BODY}`);
    expect(result.removed).toBe(0);
    expect(result.content).toBe(`${other}\n${BODY}`);
  });

  it('leaves an unterminated span rather than truncating the page', () => {
    const broken = `${BODY}/${WATERMARK_TAG} BMC q <414243> Tj Q`;
    const result = removeTaggedSpans(broken);
    expect(result.removed).toBe(0);
    expect(result.content).toBe(broken);
  });
});

describe('watermark marker round trip', () => {
  it('writes a config into the catalog and reads it back after a save/load', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const config = { ...DEFAULT_WATERMARK_CONFIG, text: 'A (tricky) \\ text', angle: 30 };
    writeWatermarkMarker(doc, config);

    const reloaded = await PDFDocument.load(await doc.save());
    expect(readWatermarkMarker(reloaded)).toEqual(config);
  });

  it('reports no marker for a document this app never stamped', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const reloaded = await PDFDocument.load(await doc.save());
    expect(readWatermarkMarker(reloaded)).toBeNull();
  });
});

describe('stripStampedWatermark', () => {
  /** A one-page doc with body text plus a tagged watermark, saved and reloaded. */
  async function stampedDoc(markerConfig = DEFAULT_WATERMARK_CONFIG) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 300]);
    page.drawText('BODY', { x: 10, y: 280, size: 10, font });
    page.pushOperators(beginMarkedContent(WATERMARK_TAG));
    page.drawText('WATERMARK', { x: 10, y: 150, size: 20, font });
    page.pushOperators(endMarkedContent());
    writeWatermarkMarker(doc, markerConfig);
    return PDFDocument.load(await doc.save());
  }

  it('removes the tagged span from a stamped document', async () => {
    expect(stripStampedWatermark(await stampedDoc())).toBe(1);
  });

  /** Tagged span in the content, but no catalog marker: a tool dropped it. */
  async function taggedButUnmarked() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 300]);
    page.drawText('BODY', { x: 10, y: 280, size: 10, font });
    page.pushOperators(beginMarkedContent(WATERMARK_TAG));
    page.drawText('WATERMARK', { x: 10, y: 150, size: 20, font });
    page.pushOperators(endMarkedContent());
    return PDFDocument.load(await doc.save());
  }

  it('still strips when the catalog marker was dropped, since the tag is the handle', async () => {
    // The marker is an unrecognized catalog key another tool may discard;
    // losing it must not strand a watermark that is plainly still tagged.
    expect(stripStampedWatermark(await taggedButUnmarked())).toBe(1);
  });

  it('leaves a document with neither tag nor marker completely alone', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 300]).drawText('BODY ONLY', { x: 10, y: 280, size: 10, font });
    const reloaded = await PDFDocument.load(await doc.save());

    expect(stripStampedWatermark(reloaded)).toBe(0);
  });

  it('reports a dropped marker as replaceable but with unknown settings', async () => {
    expect(detectStamp(await taggedButUnmarked())).toEqual({ tagged: true, config: null });
  });

  it('reports both tag and config when everything survived', async () => {
    const detected = detectStamp(await stampedDoc({ ...DEFAULT_WATERMARK_CONFIG, text: 'KEPT' }));
    expect(detected.tagged).toBe(true);
    expect(detected.config?.text).toBe('KEPT');
  });

  it('is idempotent: a second strip finds nothing left to remove', async () => {
    const doc = await stampedDoc();
    expect(stripStampedWatermark(doc)).toBe(1);
    expect(stripStampedWatermark(doc)).toBe(0);
  });
});
