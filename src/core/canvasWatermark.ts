// The canvas half of the watermark renderer (spec §11).
//
// Extracted so the live preview overlay and the image exporter draw through
// the exact same code, the way watermarkPdf.ts and the overlay already share
// layout.ts. A second hand-rolled draw loop is how preview and output drift.

import { computeWatermarkLayout } from './layout';
import { measureFontMetrics } from './canvasMetrics';
import { cssFamilyName, loadFontFace } from './fonts';
import { resolvedFontSize, type WatermarkConfig } from './watermarkConfig';

export interface WatermarkSurface {
  /**
   * The subject's own coordinate space: PDF points for a page, pixels for an
   * image. Tiling is computed against this, so the result is resolution
   * independent in auto font-size mode.
   */
  visualWidth: number;
  visualHeight: number;
  /** The drawing surface in CSS pixels (preview) or output pixels (export). */
  cssWidth: number;
  cssHeight: number;
}

/**
 * Draws the tiled watermark onto an already-prepared context. The caller owns
 * the transform (so a preview can pre-scale by devicePixelRatio) and owns
 * clearing, so this can paint over image content that must survive.
 *
 * The font must already be registered; call `drawWatermark` if unsure.
 */
export function drawWatermarkSync(
  ctx: CanvasRenderingContext2D,
  config: WatermarkConfig,
  surface: WatermarkSurface,
): void {
  const { visualWidth, visualHeight, cssWidth, cssHeight } = surface;
  if (visualWidth <= 0 || visualHeight <= 0 || cssWidth <= 0 || cssHeight <= 0) return;

  ctx.save();

  const family = cssFamilyName(config.fontId);
  const metrics = measureFontMetrics(ctx, family, config.text);
  const { fontSize, tiles, angleRad } = computeWatermarkLayout({
    pageWidth: visualWidth,
    pageHeight: visualHeight,
    text: config.text,
    angleDeg: config.angle,
    columns: config.columns,
    rows: config.rows,
    gapRatio: config.gapRatio,
    maxLines: config.maxLines,
    fontSize: resolvedFontSize(config),
    metrics,
  });

  // Subject space -> surface pixels. Uniform, since the surface always
  // matches the subject's aspect ratio.
  const scale = cssWidth / visualWidth;

  ctx.font = `${fontSize * scale}px "${family}"`;
  ctx.fillStyle = config.color;
  ctx.globalAlpha = config.opacity;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  for (const tile of tiles) {
    // layout.ts works in PDF space (y-up, origin bottom-left); canvas is
    // y-down from the top-left, and the rotation direction flips with it.
    const xPx = tile.x * scale;
    const yPx = cssHeight - tile.y * scale;
    ctx.save();
    ctx.translate(xPx, yPx);
    ctx.rotate(-angleRad);
    ctx.fillText(tile.text, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

/** `drawWatermarkSync`, after making sure the configured font is loaded. */
export async function drawWatermark(
  ctx: CanvasRenderingContext2D,
  config: WatermarkConfig,
  surface: WatermarkSurface,
): Promise<void> {
  await loadFontFace(config.fontId);
  drawWatermarkSync(ctx, config, surface);
}
