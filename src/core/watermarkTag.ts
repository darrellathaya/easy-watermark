// Makes this app's own watermarks findable and removable again, so a file it
// stamped can have its watermark *replaced* rather than stacked with another.
//
// Two marks go into every export:
//
//  1. Each page's watermark operators are wrapped in a marked-content
//     sequence, `/EasyWatermark BMC ... EMC`, which bounds exactly the
//     operators this app added and nothing else.
//  2. The document catalog carries the WatermarkConfig as JSON, so a later
//     load can tell the file was stamped here and recover the settings.
//
// Neither mark changes how the page renders: marked content is transparent to
// a viewer, and an unknown catalog key is ignored.
//
// Scope: this only recognizes watermarks *this app* applied. Another tool's
// watermark may be vector outlines, an image, or an annotation rather than
// tagged text, and is left alone.

import { PDFDocument as PDFDocumentClass, PDFHexString, PDFName, PDFString, type PDFDocument } from 'pdf-lib';
import { readPageContent, writePageContent } from './pdfContentStream';
import { DEFAULT_WATERMARK_CONFIG, type WatermarkConfig } from './watermarkConfig';

/** Marked-content tag bounding the operators this app draws. */
export const WATERMARK_TAG = 'EasyWatermark';

/** What a file carries from a previous stamp by this app. */
export interface StampDetection {
  /**
   * Tagged operator spans are present in the page content, so a re-export can
   * remove them. This, not the catalog marker, is what makes a watermark
   * replaceable.
   */
  tagged: boolean;
  /**
   * The config recorded at stamp time, when the catalog marker survived. Null
   * means the watermark is still replaceable but its original settings are
   * unknown (another tool may have dropped the unrecognized catalog key).
   */
  config: WatermarkConfig | null;
}
/** Catalog key holding the stamped WatermarkConfig as JSON. */
const CATALOG_KEY = PDFName.of('EasyWatermark');
const MARKER_VERSION = 1;

/** Records the config used, so a later load can offer to reuse or replace it. */
export function writeWatermarkMarker(pdfDoc: PDFDocument, config: WatermarkConfig): void {
  const payload = JSON.stringify({ v: MARKER_VERSION, config });
  // Hex, not a literal string: the watermark text is user input and could
  // hold parentheses or backslashes that a literal string would have to escape.
  pdfDoc.catalog.set(CATALOG_KEY, PDFHexString.fromText(payload));
}

/**
 * The WatermarkConfig this app previously stamped into `pdfDoc`, or null if it
 * wasn't stamped here. Unknown keys fall back to the defaults, so a marker
 * written by an older version still loads.
 */
export function readWatermarkMarker(pdfDoc: PDFDocument): WatermarkConfig | null {
  const raw = pdfDoc.catalog.get(CATALOG_KEY);
  if (!(raw instanceof PDFHexString) && !(raw instanceof PDFString)) return null;

  try {
    const parsed = JSON.parse(raw.decodeText()) as { v?: number; config?: Partial<WatermarkConfig> };
    if (!parsed.config) return null;
    return { ...DEFAULT_WATERMARK_CONFIG, ...parsed.config };
  } catch {
    return null;
  }
}

/**
 * Removes every `/EasyWatermark BMC ... EMC` span from `content`, matching
 * nesting so an inner marked-content sequence can't end the span early.
 */
function removeTaggedSpans(content: string): { content: string; removed: number } {
  const opener = new RegExp(`/${WATERMARK_TAG}\\s+BMC`, 'g');
  const spans: Array<[number, number]> = [];

  for (let match = opener.exec(content); match !== null; match = opener.exec(content)) {
    const start = match.index;
    const marks = /\b(BMC|BDC|EMC)\b/g;
    marks.lastIndex = start + match[0].length;

    let depth = 1;
    let end = -1;
    for (let mark = marks.exec(content); mark !== null; mark = marks.exec(content)) {
      depth += mark[1] === 'EMC' ? -1 : 1;
      if (depth === 0) {
        end = mark.index + mark[1].length;
        break;
      }
    }

    // An unterminated span means the stream isn't shaped the way this app
    // writes it; leave it rather than truncating the page.
    if (end < 0) continue;
    spans.push([start, end]);
    opener.lastIndex = end;
  }

  // Back to front, so earlier offsets stay valid.
  let out = content;
  for (let i = spans.length - 1; i >= 0; i--) {
    out = out.slice(0, spans[i][0]) + out.slice(spans[i][1]);
  }
  return { content: out, removed: spans.length };
}

/** Whether any page carries a tagged span, i.e. a watermark we can remove. */
export function hasTaggedSpans(pdfDoc: PDFDocument): boolean {
  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const content = readPageContent(pdfDoc, i);
    if (content !== null && removeTaggedSpans(content).removed > 0) return true;
  }
  return false;
}

/**
 * What a previous stamp left in this document: removable spans, and the
 * config if the catalog marker survived.
 */
export function detectStamp(pdfDoc: PDFDocument): StampDetection {
  return { tagged: hasTaggedSpans(pdfDoc), config: readWatermarkMarker(pdfDoc) };
}

/**
 * Strips the watermark this app previously stamped, leaving the rest of each
 * page untouched, and returns how many spans were removed.
 *
 * Keyed on the marked-content tag alone, not on the catalog marker: the
 * marker is an unrecognized catalog key that other PDF tooling may drop, and
 * losing it must not strand a watermark that is plainly still tagged in the
 * content. A false positive would need some unrelated file to contain the
 * literal `/EasyWatermark BMC` *and* a balanced EMC after it; an unbalanced
 * span is left alone rather than cut.
 *
 * Must be called before anything draws on the pages: it replaces each page's
 * Contents outright, which would discard drawing already queued by pdf-lib.
 */
export function stripStampedWatermark(pdfDoc: PDFDocument): number {
  let removed = 0;
  const pages = pdfDoc.getPages();

  for (let i = 0; i < pages.length; i++) {
    const content = readPageContent(pdfDoc, i);
    if (content === null) continue;

    const result = removeTaggedSpans(content);
    if (result.removed === 0) continue;

    writePageContent(pdfDoc, i, result.content);
    removed += result.removed;
  }

  return removed;
}

export { removeTaggedSpans as removeTaggedSpansForTests };

/**
 * Probes raw PDF bytes at load time for a previous stamp by this app. Returns
 * a nothing-found result for anything it can't read, including encrypted
 * files, since a failed probe is not an error worth surfacing.
 */
export async function detectStampInBytes(bytes: ArrayBuffer): Promise<StampDetection> {
  try {
    const pdfDoc = await PDFDocumentClass.load(bytes.slice(0), { ignoreEncryption: false });
    return detectStamp(pdfDoc);
  } catch {
    return { tagged: false, config: null };
  }
}
