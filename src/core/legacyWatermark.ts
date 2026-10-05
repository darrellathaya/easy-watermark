// Finds and removes watermarks applied by versions of this app that predate
// the marked-content tag (see watermarkTag.ts), so an already-watermarked
// file can still have its watermark replaced rather than doubled.
//
// Those exports left no tag, so they're identified by shape instead. Every
// tile this app drew is its own `q ... Q` block that:
//
//   * sets a graphics state (`/GS-… gs`) for the watermark's opacity, which
//     pdf-lib emits for every opacity, 1 included, and which plain page text
//     drawn without an opacity never has;
//   * contains exactly one text-showing operator; and
//   * shows the *same* string, at the same size and colour, as every other
//     tile on the page.
//
// The string itself is never interpreted: a subsetted font encodes glyph ids
// rather than characters, so the bytes are compared tile to tile instead of
// being decoded. That also means the old watermark's text can't be recovered,
// only removed.
//
// This is a heuristic. It is deliberately gated on a per-file opt-in, because
// a document that genuinely repeats one semi-transparent string many times
// would look the same from here.

import type { PDFDocument } from 'pdf-lib';
import { allSaveBlocks, readPageContent, scanOperators, writePageContent } from './pdfContentStream';
import { findTaggedSpans } from './watermarkTag';

/**
 * How many identical tiles a page needs before the group is called a
 * watermark. The app's default grid is 4 x 8, so real watermarks clear this
 * easily; the cost is that a very sparse grid (under 4 tiles on a page) isn't
 * recognized.
 */
export const MIN_TILES_PER_PAGE = 4;

export interface LegacyScan {
  /** Total candidate tiles across the document. */
  blocks: number;
  /** How many pages carry them. */
  pages: number;
}

interface BlockSignature {
  key: string;
  span: [number, number];
}

/** A tile's identity, or null if the block isn't shaped like a watermark tile. */
function blockSignature(content: string, span: [number, number]): string | null {
  const block = content.slice(span[0], span[1]);

  // Exactly one text-showing operator, so this is a single run of text and
  // not a paragraph or a table cell group.
  let showCount = 0;
  let saves = 0;
  for (const token of scanOperators(block)) {
    if (token.op === 'Tj' || token.op === 'TJ') showCount++;
    if (token.op === 'q') saves++;
  }
  if (showCount !== 1) return null;
  // A leaf block: its own `q` and no nested ones. This is what rejects the
  // wrapper pdf-lib puts around pre-existing page content, which contains
  // every tile rather than being one.
  if (saves !== 1) return null;

  // The opacity graphics state: the main thing separating a watermark tile
  // from ordinary page text.
  if (!/\/[^\s/[\]<>(){}%]+\s+gs\b/.test(block)) return null;

  const shown = /<([0-9A-Fa-f\s]*)>\s*Tj/.exec(block);
  const text = shown?.[1]?.replace(/\s+/g, '');
  if (!text) return null;

  const size = /\/[^\s/[\]<>(){}%]+\s+([\d.]+)\s+Tf/.exec(block)?.[1] ?? '';
  const color = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(block)?.slice(1, 4).join(',') ?? '';

  return `${text}|${size}|${color}`;
}

/**
 * Spans of every tile belonging to a repeated-tile group on this page.
 *
 * Tiles inside a tagged span are skipped: those are a *current* watermark,
 * which watermarkTag.ts removes exactly, and they have the same shape as the
 * legacy ones this looks for.
 */
export function findLegacyBlocks(content: string): Array<[number, number]> {
  const groups = new Map<string, BlockSignature[]>();
  const tagged = findTaggedSpans(content);
  const isTagged = (pos: number) => tagged.some(([start, end]) => pos >= start && pos < end);

  for (const span of allSaveBlocks(content)) {
    if (isTagged(span[0])) continue;
    const key = blockSignature(content, span);
    if (key === null) continue;
    const existing = groups.get(key);
    if (existing) existing.push({ key, span });
    else groups.set(key, [{ key, span }]);
  }

  const spans: Array<[number, number]> = [];
  for (const group of groups.values()) {
    if (group.length >= MIN_TILES_PER_PAGE) spans.push(...group.map((b) => b.span));
  }
  // Back to front, so a caller splicing them keeps earlier offsets valid.
  return spans.sort((a, b) => b[0] - a[0]);
}

export function removeLegacyBlocks(content: string): { content: string; removed: number } {
  const spans = findLegacyBlocks(content);
  let out = content;
  for (const [start, end] of spans) out = out.slice(0, start) + out.slice(end);
  return { content: out, removed: spans.length };
}

/** What an untagged watermark from an older version looks like here, if any. */
export function scanLegacyWatermark(pdfDoc: PDFDocument): LegacyScan | null {
  let blocks = 0;
  let pages = 0;

  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const content = readPageContent(pdfDoc, i);
    if (content === null) continue;
    const found = findLegacyBlocks(content).length;
    if (found > 0) {
      blocks += found;
      pages++;
    }
  }

  return blocks > 0 ? { blocks, pages } : null;
}

/**
 * Removes untagged watermark tiles and returns how many were removed. Must
 * run before anything draws on the pages, since it rewrites page contents.
 */
export function stripLegacyWatermark(pdfDoc: PDFDocument): number {
  let removed = 0;

  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const content = readPageContent(pdfDoc, i);
    if (content === null) continue;
    const result = removeLegacyBlocks(content);
    if (result.removed === 0) continue;
    writePageContent(pdfDoc, i, result.content);
    removed += result.removed;
  }

  return removed;
}

