// Measures a bundled font's metrics via canvas, in the same
// { unitWidth, capHeight } shape layout.ts expects (spec §3.1), so the
// preview overlay uses the exact same math as the pdf-lib exporter.

import type { FontMetrics } from './layout';

const REFERENCE_SIZE = 100;

export function measureFontMetrics(ctx: CanvasRenderingContext2D, cssFontFamily: string, text: string): FontMetrics {
  ctx.font = `${REFERENCE_SIZE}px "${cssFontFamily}"`;
  const m = ctx.measureText(text || ' ');

  const unitWidth = m.width / REFERENCE_SIZE;

  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? REFERENCE_SIZE * 0.8;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? REFERENCE_SIZE * 0.2;
  const capHeight = (ascent + descent) / REFERENCE_SIZE;

  return { unitWidth, capHeight };
}
