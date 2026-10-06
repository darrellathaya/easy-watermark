// General watermark removal: finds and strips watermarks this app did not
// apply, by the forms other producers actually use.
//
// Four strategies, in descending confidence:
//
//  1. `annotation`    - /Watermark or /Stamp annotations. These are a PDF
//                       feature meant for exactly this, so removing one is
//                       unambiguous: drop it from the page's /Annots.
//  2. `artifact`      - marked content the file itself labels as a watermark:
//                       `/Artifact <</Subtype /Watermark>> BDC ... EMC` from
//                       the spec, or `/OC` content on an optional-content
//                       group whose name says watermark. Also self-declared,
//                       so also unambiguous.
//  3. `repeatedText`  - the same text run drawn many times on a page with a
//                       watermark's traits (semi-transparent, rotated, or
//                       light-coloured). A heuristic.
//  4. `repeatedImage` - the same image drawn many times, semi-transparent or
//                       rotated. A heuristic.
//
// Out of reach, and not attempted: text converted to vector outlines, and
// watermarks burned into a scanned page image. Both are indistinguishable
// from the page itself without image analysis.
//
// Shown text is never decoded. A subsetted font stores glyph ids rather than
// characters, so runs are compared to each other byte for byte instead.

import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument } from 'pdf-lib';
import {
  allSaveBlocks,
  findMarkedContentSpans,
  readPageContent,
  removeSpans,
  scanOperators,
  writePageContent,
} from './pdfContentStream';
import { findTaggedSpans } from './watermarkTag';

export type WatermarkKind = 'annotation' | 'artifact' | 'repeatedText' | 'repeatedImage';

export interface WatermarkFinding {
  kind: WatermarkKind;
  /** Items found: annotations, marked-content sequences, or repeated tiles. */
  count: number;
  /** How many pages carry them. */
  pages: number;
  /** Whether the file declares this as a watermark, rather than it being inferred. */
  declared: boolean;
  /** One short line for the UI. */
  detail: string;
}

/** Repeats needed on one page before a group counts as a watermark. */
export const MIN_REPEATS_PER_PAGE = 4;

/** Annotation subtypes that exist to carry stamps and watermarks. */
const WATERMARK_ANNOTATIONS = new Set(['Watermark', 'Stamp']);

/** Optional-content group names that name themselves a watermark. */
const WATERMARK_LAYER_NAME = /watermark|draft|confidential/i;

/** A fill this light is decoration over text, not body copy. */
const LIGHT_FILL_THRESHOLD = 0.6;

// ---------------------------------------------------------------- annotations

function annotationIndexes(pdfDoc: PDFDocument, pageIndex: number): number[] {
  const annots = pdfDoc.getPages()[pageIndex].node.Annots();
  if (!(annots instanceof PDFArray)) return [];

  const found: number[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const entry = annots.get(i);
    const dict = entry instanceof PDFRef ? pdfDoc.context.lookup(entry) : entry;
    if (!(dict instanceof PDFDict)) continue;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (subtype instanceof PDFName && WATERMARK_ANNOTATIONS.has(subtype.asString().replace(/^\//, ''))) {
      found.push(i);
    }
  }
  return found;
}

// ------------------------------------------------------------------ artifacts

/** Property names on a page that point at a watermark-ish optional-content group. */
function watermarkLayerNames(pdfDoc: PDFDocument, pageIndex: number): Set<string> {
  const names = new Set<string>();
  const resources = pdfDoc.getPages()[pageIndex].node.Resources();
  const properties = resources?.get(PDFName.of('Properties'));
  const dict = properties instanceof PDFRef ? pdfDoc.context.lookup(properties) : properties;
  if (!(dict instanceof PDFDict)) return names;

  for (const [key, value] of dict.entries()) {
    const ocg = value instanceof PDFRef ? pdfDoc.context.lookup(value) : value;
    if (!(ocg instanceof PDFDict)) continue;
    const label = ocg.get(PDFName.of('Name'));
    if (label && WATERMARK_LAYER_NAME.test(String(label))) {
      names.add(key.asString().replace(/^\//, ''));
    }
  }
  return names;
}

/**
 * Maps each XObject resource name on a page to a stable id for the object it
 * refers to. Resource names are per-call and arbitrary (pdf-lib randomizes
 * them), so two tiles drawing the same image name it differently; the
 * underlying reference is what actually identifies it.
 */
function pageXObjectIds(pdfDoc: PDFDocument, pageIndex: number): Map<string, string> {
  const ids = new Map<string, string>();
  const resources = pdfDoc.getPages()[pageIndex].node.Resources();
  const xobjects = resources?.get(PDFName.of('XObject'));
  const dict = xobjects instanceof PDFRef ? pdfDoc.context.lookup(xobjects) : xobjects;
  if (!(dict instanceof PDFDict)) return ids;

  for (const [key, value] of dict.entries()) {
    ids.set(key.asString().replace(/^\//, ''), String(value));
  }
  return ids;
}

function artifactSpans(pdfDoc: PDFDocument, pageIndex: number, content: string): Array<[number, number]> {
  const layers = watermarkLayerNames(pdfDoc, pageIndex);

  return findMarkedContentSpans(content, (operands) => {
    // The spec's own watermark artifact.
    if (/\/Artifact\b/.test(operands) && /\/Subtype\s*\/Watermark\b/.test(operands)) return true;
    // Optional content on a layer that calls itself a watermark.
    const oc = /\/OC\s*\/([^\s/[\]<>(){}%]+)/.exec(operands);
    return oc !== null && layers.has(oc[1]);
  });
}

// ------------------------------------------------------- repeated text/images

interface Candidate {
  span: [number, number];
  key: string;
  kind: 'repeatedText' | 'repeatedImage';
  traits: { translucent: boolean; rotated: boolean; light: boolean };
}

/** Watermark-ish traits of one block, read before the key is normalized. */
function blockTraits(block: string) {
  const translucent = /\/[^\s/[\]<>(){}%]+\s+gs\b/.test(block);

  let rotated = false;
  for (const m of block.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(?:Tm|cm)\b/g)) {
    // b and c of the matrix: non-zero means the run is skewed or rotated.
    if (Math.abs(Number(m[2])) > 1e-6 || Math.abs(Number(m[3])) > 1e-6) rotated = true;
  }

  let light = false;
  const rgb = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+rg\b/.exec(block);
  const gray = /(?:^|[^\d.])(-?[\d.]+)\s+g\b/.exec(block);
  if (rgb) light = [rgb[1], rgb[2], rgb[3]].every((c) => Number(c) >= LIGHT_FILL_THRESHOLD);
  else if (gray) light = Number(gray[1]) >= LIGHT_FILL_THRESHOLD;

  return { translucent, rotated, light };
}

/**
 * Collapses the parts of a block that differ between tiles (position, and the
 * per-call resource names pdf-lib randomizes) so that two tiles of the same
 * watermark normalize to the same string and nothing else does.
 */
function normalizeBlock(block: string, xobjectIds: Map<string, string>): string {
  return block
    .replace(/(?:-?[\d.]+\s+){5}-?[\d.]+\s+(Tm|cm)\b/g, '$1')
    .replace(/-?[\d.]+\s+-?[\d.]+\s+(Td|TD)\b/g, '$1')
    .replace(/\/[^\s/[\]<>(){}%]+(\s+gs\b)/g, 'GS$1')
    .replace(/\/[^\s/[\]<>(){}%]+(\s+[\d.]+\s+Tf\b)/g, 'FONT$1')
    // Keep *which* image this is, by reference rather than resource name.
    .replace(/\/([^\s/[\]<>(){}%]+)(\s+Do\b)/g, (_, name: string, tail: string) => `IMG(${xobjectIds.get(name) ?? name})${tail}`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Leaf `q ... Q` blocks that draw exactly one text run or one image. */
function leafCandidates(
  content: string,
  skip: Array<[number, number]>,
  xobjectIds: Map<string, string>,
): Candidate[] {
  const inSkipped = (pos: number) => skip.some(([start, end]) => pos >= start && pos < end);
  const candidates: Candidate[] = [];

  for (const span of allSaveBlocks(content)) {
    if (inSkipped(span[0])) continue;
    const block = content.slice(span[0], span[1]);

    let saves = 0;
    let shows = 0;
    let draws = 0;
    for (const token of scanOperators(block)) {
      if (token.op === 'q') saves++;
      else if (token.op === 'Tj' || token.op === 'TJ' || token.op === "'" || token.op === '"') shows++;
      else if (token.op === 'Do') draws++;
    }

    // A leaf block: its own save, nothing nested. This rejects the wrapper
    // pdf-lib puts around pre-existing page content.
    if (saves !== 1) continue;

    let kind: Candidate['kind'];
    if (shows === 1 && draws === 0) kind = 'repeatedText';
    else if (draws === 1 && shows === 0) kind = 'repeatedImage';
    else continue;

    candidates.push({
      span,
      key: `${kind}:${normalizeBlock(block, xobjectIds)}`,
      kind,
      traits: blockTraits(block),
    });
  }

  return candidates;
}

interface RepeatGroup {
  kind: Candidate['kind'];
  spans: Array<[number, number]>;
}

/** Groups of identical blocks big enough, and watermark-like enough, to strip. */
function repeatedGroups(
  content: string,
  skip: Array<[number, number]>,
  xobjectIds: Map<string, string>,
): RepeatGroup[] {
  const byKey = new Map<string, Candidate[]>();
  for (const candidate of leafCandidates(content, skip, xobjectIds)) {
    const existing = byKey.get(candidate.key);
    if (existing) existing.push(candidate);
    else byKey.set(candidate.key, [candidate]);
  }

  const groups: RepeatGroup[] = [];
  for (const members of byKey.values()) {
    if (members.length < MIN_REPEATS_PER_PAGE) continue;

    const { translucent, rotated, light } = members[0].traits;
    // Repetition alone is not a watermark: a table of identical cells repeats
    // too. It also has to look like one.
    const looksLikeWatermark =
      members[0].kind === 'repeatedText' ? translucent || rotated || light : translucent || rotated;
    if (!looksLikeWatermark) continue;

    groups.push({ kind: members[0].kind, spans: members.map((m) => m.span) });
  }
  return groups;
}

// ------------------------------------------------------------------ scan/strip

interface Tally {
  count: number;
  pages: Set<number>;
}

function tally(map: Map<WatermarkKind, Tally>, kind: WatermarkKind, count: number, pageIndex: number): void {
  if (count <= 0) return;
  const existing = map.get(kind) ?? { count: 0, pages: new Set<number>() };
  existing.count += count;
  existing.pages.add(pageIndex);
  map.set(kind, existing);
}

const DETAIL: Record<WatermarkKind, (count: number, pages: number) => string> = {
  annotation: (c, p) => `${c} watermark/stamp annotation${c === 1 ? '' : 's'} on ${p} page${p === 1 ? '' : 's'}`,
  artifact: (c, p) => `${c} region${c === 1 ? '' : 's'} the file labels as a watermark, on ${p} page${p === 1 ? '' : 's'}`,
  repeatedText: (c, p) => `${c} repeated text tile${c === 1 ? '' : 's'} across ${p} page${p === 1 ? '' : 's'}`,
  repeatedImage: (c, p) => `${c} repeated image tile${c === 1 ? '' : 's'} across ${p} page${p === 1 ? '' : 's'}`,
};

const DECLARED: Record<WatermarkKind, boolean> = {
  annotation: true,
  artifact: true,
  repeatedText: false,
  repeatedImage: false,
};

/** Everything removable this document appears to carry, by strategy. */
export function scanWatermarks(pdfDoc: PDFDocument): WatermarkFinding[] {
  const tallies = new Map<WatermarkKind, Tally>();
  const pageCount = pdfDoc.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    tally(tallies, 'annotation', annotationIndexes(pdfDoc, i).length, i);

    const content = readPageContent(pdfDoc, i);
    if (content === null) continue;

    // This app's own tagged watermark is removed exactly elsewhere, so it is
    // never counted or touched by the heuristics here.
    const ours = findTaggedSpans(content);
    const artifacts = artifactSpans(pdfDoc, i, content);
    tally(tallies, 'artifact', artifacts.length, i);

    for (const group of repeatedGroups(content, [...ours, ...artifacts], pageXObjectIds(pdfDoc, i))) {
      tally(tallies, group.kind, group.spans.length, i);
    }
  }

  const order: WatermarkKind[] = ['annotation', 'artifact', 'repeatedText', 'repeatedImage'];
  return order
    .filter((kind) => tallies.has(kind))
    .map((kind) => {
      const { count, pages } = tallies.get(kind)!;
      return {
        kind,
        count,
        pages: pages.size,
        declared: DECLARED[kind],
        detail: DETAIL[kind](count, pages.size),
      };
    });
}

/**
 * Removes the selected kinds and returns how many items went. Must run before
 * anything draws on the pages, since it rewrites page contents.
 */
export function removeWatermarks(pdfDoc: PDFDocument, kinds: readonly WatermarkKind[]): number {
  const wanted = new Set(kinds);
  if (wanted.size === 0) return 0;

  let removed = 0;
  const pageCount = pdfDoc.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    if (wanted.has('annotation')) {
      const annots = pdfDoc.getPages()[i].node.Annots();
      const indexes = annotationIndexes(pdfDoc, i);
      if (annots instanceof PDFArray) {
        // Descending, so each removal leaves the remaining indexes valid.
        for (const index of [...indexes].sort((a, b) => b - a)) annots.remove(index);
        removed += indexes.length;
      }
    }

    const content = readPageContent(pdfDoc, i);
    if (content === null) continue;

    const ours = findTaggedSpans(content);
    const artifacts = artifactSpans(pdfDoc, i, content);

    const spans: Array<[number, number]> = [];
    if (wanted.has('artifact')) spans.push(...artifacts);
    for (const group of repeatedGroups(content, [...ours, ...artifacts], pageXObjectIds(pdfDoc, i))) {
      if (wanted.has(group.kind)) spans.push(...group.spans);
    }
    if (spans.length === 0) continue;

    const result = removeSpans(content, spans);
    writePageContent(pdfDoc, i, result.content);
    removed += result.removed;
  }

  return removed;
}
