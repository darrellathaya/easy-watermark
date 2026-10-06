// Measures a bundled font's metrics via canvas, in the same
// { unitWidth, capHeight } shape layout.ts expects (spec §3.1), so the
// preview overlay uses the exact same math as the pdf-lib exporter.

import type { FontMetrics } from './layout';

const REFERENCE_SIZE = 100;

export function measureFontMetrics(ctx: CanvasRenderingContext2D, cssFontFamily: string, text: string): FontMetrics {
  const font = `${REFERENCE_SIZE}px "${cssFontFamily}"`;
  ctx.font = font;

  // Height comes from the font, not from any one string, so one measurement
  // covers every line.
  const m = ctx.measureText(text || ' ');
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? REFERENCE_SIZE * 0.8;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? REFERENCE_SIZE * 0.2;
  const capHeight = (ascent + descent) / REFERENCE_SIZE;

  return {
    // Re-asserts the font each call: layout.ts measures candidate lines while
    // breaking text, and the caller may have changed ctx.font in between.
    measure: (line: string) => {
      ctx.font = font;
      return ctx.measureText(line).width / REFERENCE_SIZE;
    },
    capHeight,
  };
}
