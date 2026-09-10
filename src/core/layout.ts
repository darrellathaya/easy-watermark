// Pure tiling math for the repeating watermark grid (spec §3.1).
//
// This is the single source of truth for where each watermark instance is
// drawn and at what font size. Both the pdf-lib exporter (watermarkPdf.ts)
// and the canvas preview overlay (WatermarkOverlay.tsx) call this function so
// they can never drift apart.

/** Font metrics measured at font size 1, so callers only measure once. */
export interface FontMetrics {
  /** Width of the watermark text at font size 1 (i.e. widthOfTextAtSize(text, 100) / 100). */
  unitWidth: number;
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
  metrics: FontMetrics;
}

export interface WatermarkTile {
  /** Draw-anchor x in PDF page space (baseline-left of the rotated glyph run), origin bottom-left. */
  x: number;
  /** Draw-anchor y in PDF page space. */
  y: number;
}

export interface LayoutResult {
  fontSize: number;
  tiles: WatermarkTile[];
  angleRad: number;
}

const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Computes the tiled watermark grid for one page: font size plus a draw
 * anchor point per tile, in the same PDF-point coordinate space as the
 * page (origin bottom-left, y up). See spec §3.1 for the derivation.
 */
export function computeWatermarkLayout(input: LayoutInput): LayoutResult {
  const { pageWidth: W, pageHeight: H, angleDeg, columns, rows, gapRatio, metrics } = input;

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

  // widthAtSize is linear in size, so unitWidth (width at size 1) is enough
  // to solve for the font size that fills the tile width minus the gap.
  const unitW = metrics.unitWidth;
  const rawFontSize = unitW > 0 ? (tileW * (1 - gapRatio)) / unitW : MAX_FONT_SIZE;
  const fontSize = clamp(rawFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);

  const tw = unitW * fontSize;
  const th = metrics.capHeight * fontSize * 0.35;

  const tiles: WatermarkTile[] = [];
  for (let i = 0; i < safeColumns; i++) {
    for (let j = 0; j < safeRows; j++) {
      // Tile center in the rotated frame, centered on the page center.
      const u = (i + 0.5) * tileW - coverW / 2;
      const v = (j + 0.5) * tileH - coverH / 2;

      // Rotate back into page space, origin at page center.
      const x = W / 2 + u * cos - v * sin;
      const y = H / 2 + u * sin + v * cos;

      // Offset from "centered at (x, y)" to pdf-lib's baseline-left anchor
      // for the rotated glyph run.
      const drawX = x - (tw / 2) * cos + (th / 2) * sin;
      const drawY = y - (tw / 2) * sin - (th / 2) * cos;

      tiles.push({ x: drawX, y: drawY });
    }
  }

  return { fontSize, tiles, angleRad };
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
