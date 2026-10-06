// Pure tiling math for the repeating watermark grid (spec §3.1).
//
// This is the single source of truth for where each watermark instance is
// drawn and at what font size. Both the pdf-lib exporter (watermarkPdf.ts)
// and the canvas preview overlay (WatermarkOverlay.tsx) call this function so
// they can never drift apart.

/**
 * How a caller measures its font, at font size 1.
 *
 * This is a *function*, not a precomputed width, because the line breaking
 * below has to measure candidate lines. Both renderers hand over their own
 * measurer (canvas `measureText`, pdf-lib `widthOfTextAtSize`), so wrapping
 * happens once, here, and the preview can't break differently than the export.
 */
export interface FontMetrics {
  /** Width of `text` at font size 1 (i.e. widthOfTextAtSize(text, 100) / 100). */
  measure: (text: string) => number;
  /** A representative glyph height at font size 1 (e.g. heightAtSize(1)), used for baseline centering. */
  capHeight: number;
}

export interface LayoutInput {
  /** Page width in PDF points, as the *visual* (post-rotation) page box. */
  pageWidth: number;
  /** Page height in PDF points, as the *visual* (post-rotation) page box. */
  pageHeight: number;
  /** Watermark text (used only via its pre-measured metrics; kept for callers/debugging). */
  text: string;
  /** Direction in degrees, -90..90, 0 = horizontal. */
  angleDeg: number;
  /** Horizontal repeat count, >= 1. */
  columns: number;
  /** Vertical repeat count, >= 1. */
  rows: number;
  /** Fraction (0-0.6) of each tile left as empty breathing room. */
  gapRatio: number;
  /**
   * Most lines the text may be broken onto. 1 never wraps, which is how this
   * behaved before wrapping existed. Ignored when the text has manual line
   * breaks, which are always honoured exactly.
   */
  maxLines?: number;
  /**
   * Explicit font size in PDF points. Omitted (or <= 0) means auto: the size
   * is fitted to the tile width, which is the historic behavior and what
   * makes `columns` read as "watermark width". A given size is still clamped
   * to FONT_SIZE_RANGE, and it makes `gapRatio` inert, since nothing is being
   * fitted for the gap to leave room in.
   */
  fontSize?: number;
  metrics: FontMetrics;
}

export interface WatermarkTile {
  /** Draw-anchor x in PDF page space (baseline-left of the rotated glyph run), origin bottom-left. */
  x: number;
  /** Draw-anchor y in PDF page space. */
  y: number;
  /**
   * The one line to draw at this anchor. A wrapped watermark yields one tile
   * per line per grid cell, so every renderer stays a flat loop over
   * ready-to-draw anchors and never lays out lines itself.
   */
  text: string;
}

export interface LayoutResult {
  fontSize: number;
  tiles: WatermarkTile[];
  angleRad: number;
  /** The lines the text was broken onto, in order. */
  lines: string[];
}

/** Hard bounds on the rendered font size, auto-fitted or explicit. */
export const FONT_SIZE_RANGE = { min: 4, max: 400 } as const;

/** Baseline-to-baseline distance as a multiple of the font size. */
export const LINE_HEIGHT_RATIO = 1.2;

/**
 * Below this size, in points, a single line is treated as not fitting and
 * wrapping is tried instead.
 *
 * Deliberately above FONT_SIZE_RANGE.min: that floor is a hard clamp, so text
 * can sit just above it and be technically "fitting" while far too small to
 * read, which is the case long watermarks actually hit. It stays well below
 * what ordinary column counts produce, so layouts that already looked right
 * keep their single line.
 */
export const WRAP_BELOW_PT = 8;

/**
 * Splits text on its manual line breaks. Trailing blank lines are dropped,
 * since a stray newline would shift the block for no visible glyph; leading
 * and interior blanks are kept, because those are deliberate spacing.
 */
export function splitManualLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines;
}

/**
 * Greedily breaks `text` onto at most `count` lines at word boundaries,
 * aiming for even line widths by filling each line to a share of the total.
 * Returns fewer lines when the text can't be split that far: one long word is
 * never broken mid-word.
 */
function wrapIntoLines(text: string, count: number, measure: (text: string) => number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (count <= 1 || words.length <= 1) return [words.join(' ') || text];

  const target = measure(text) / count;
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    // Start a new line once this one has had its share, while still leaving
    // enough lines for the remaining words.
    if (current && measure(candidate) > target && lines.length < count - 1) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines;
}

/** The widest line's width at font size 1. */
function widestLine(lines: string[], measure: (text: string) => number): number {
  return lines.reduce((widest, line) => Math.max(widest, measure(line)), 0);
}

/**
 * Chooses the line breaking to use: the *fewest* lines that let the text
 * render at a usable size, so every layout that already worked keeps breaking
 * exactly as it did and only the ones that didn't change.
 *
 * "Usable" means the auto-fitted size isn't pushed below the minimum, or, at
 * an explicit size, that the line fits the width available. When nothing fits
 * even at `maxLines`, the breaking with the narrowest longest line wins,
 * which is the closest to fitting rather than simply the most lines.
 */
function chooseLines(
  text: string,
  maxLines: number,
  availableWidth: number,
  explicitFontSize: number | undefined,
  measure: (text: string) => number,
): string[] {
  const manual = splitManualLines(text);
  // Manual breaks are the author's intent; never re-flow them.
  if (manual.length > 1) return manual;

  const cap = Math.max(1, Math.floor(maxLines));
  let best: { lines: string[]; widest: number } | null = null;

  for (let count = 1; count <= cap; count++) {
    const lines = wrapIntoLines(text, count, measure);
    const widest = widestLine(lines, measure);

    const fits =
      explicitFontSize && explicitFontSize > 0
        ? explicitFontSize * widest <= availableWidth
        : widest <= 0 || availableWidth / widest >= WRAP_BELOW_PT;
    if (fits) return lines;

    if (!best || widest < best.widest) best = { lines, widest };
    // The text can't be split further, so more lines won't help.
    if (lines.length < count) break;
  }

  return best?.lines ?? [text];
}

const MIN_FONT_SIZE = FONT_SIZE_RANGE.min;
const MAX_FONT_SIZE = FONT_SIZE_RANGE.max;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Computes the tiled watermark grid for one page: font size plus a draw
 * anchor point per tile, in the same PDF-point coordinate space as the
 * page (origin bottom-left, y up). See spec §3.1 for the derivation.
 */
export function computeWatermarkLayout(input: LayoutInput): LayoutResult {
  const {
    pageWidth: W,
    pageHeight: H,
    text,
    angleDeg,
    columns,
    rows,
    gapRatio,
    maxLines = 1,
    fontSize: explicitFontSize,
    metrics,
  } = input;

  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // Page bounding box measured along (coverW) and perpendicular to (coverH) the text direction.
  const coverW = Math.abs(W * cos) + Math.abs(H * sin);
  const coverH = Math.abs(W * sin) + Math.abs(H * cos);

  const safeColumns = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  const tileW = coverW / safeColumns;
  const tileH = coverH / safeRows;

  const available = tileW * (1 - gapRatio);
  const lines = chooseLines(text, maxLines, available, explicitFontSize, metrics.measure);

  // widthAtSize is linear in size, so the widest line's width at size 1 is
  // enough to solve for the size that fills the tile width minus the gap.
  const unitW = widestLine(lines, metrics.measure);
  const autoFontSize = unitW > 0 ? available / unitW : MAX_FONT_SIZE;
  let rawFontSize = explicitFontSize && explicitFontSize > 0 ? explicitFontSize : autoFontSize;

  // A stack of lines also has to fit the tile's height. Applied only when
  // wrapping actually happened, so single-line layouts stay width-driven and
  // `columns` keeps meaning "watermark width".
  if (lines.length > 1) {
    const blockUnitHeight = (lines.length - 1) * LINE_HEIGHT_RATIO + Math.max(metrics.capHeight, 0);
    if (blockUnitHeight > 0) {
      rawFontSize = Math.min(rawFontSize, (tileH * (1 - gapRatio)) / blockUnitHeight);
    }
  }

  const fontSize = clamp(rawFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);

  const th = metrics.capHeight * fontSize * 0.35;
  const lineHeight = LINE_HEIGHT_RATIO * fontSize;
  // Each line is centered on its own width, so a ragged block stays centered
  // rather than flush-left.
  const lineWidths = lines.map((line) => metrics.measure(line) * fontSize);

  const tiles: WatermarkTile[] = [];
  for (let i = 0; i < safeColumns; i++) {
    for (let j = 0; j < safeRows; j++) {
      // Tile center in the rotated frame, centered on the page center.
      const u = (i + 0.5) * tileW - coverW / 2;
      const v = (j + 0.5) * tileH - coverH / 2;

      // Rotate back into page space, origin at page center.
      const x = W / 2 + u * cos - v * sin;
      const y = H / 2 + u * sin + v * cos;

      for (let k = 0; k < lines.length; k++) {
        // Offset from "block centered at (x, y)" to pdf-lib's baseline-left
        // anchor for this line's rotated glyph run: back along the text
        // direction by half the line's width, and across it to this line's
        // baseline. With one line this reduces to (-tw/2, -th/2), the
        // placement this grid has always used.
        const lu = -lineWidths[k] / 2;
        const lv = ((lines.length - 1) / 2 - k) * lineHeight - th / 2;

        tiles.push({
          x: x + lu * cos - lv * sin,
          y: y + lu * sin + lv * cos,
          text: lines[k],
        });
      }
    }
  }

  return { fontSize, tiles, angleRad, lines };
}

/** The tile-center cover box (before the draw-anchor offset), for tests and diagnostics. */
export function computeCoverBox(pageWidth: number, pageHeight: number, angleDeg: number): { coverW: number; coverH: number } {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    coverW: Math.abs(pageWidth * cos) + Math.abs(pageHeight * sin),
    coverH: Math.abs(pageWidth * sin) + Math.abs(pageHeight * cos),
  };
}
