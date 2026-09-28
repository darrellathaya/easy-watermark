import { describe, expect, it } from 'vitest';
import { computeCoverBox, computeWatermarkLayout, type FontMetrics } from './layout';

// A degenerate metric (zero width/height) collapses the baseline-anchor
// offset to zero, so the returned tile point equals the raw tile *center*,
// useful for asserting on tile geometry independent of text metrics.
const ZERO_METRICS: FontMetrics = { unitWidth: 0, capHeight: 0 };

// A realistic-ish metric for tests that care about font size behavior.
const TEXT_METRICS: FontMetrics = { unitWidth: 0.6, capHeight: 0.7 };

describe('computeWatermarkLayout', () => {
  it('places a single tile at the exact page center for columns=1, rows=1, angle=0', () => {
    const W = 612;
    const H = 792;
    const result = computeWatermarkLayout({
      pageWidth: W,
      pageHeight: H,
      text: 'X',
      angleDeg: 0,
      columns: 1,
      rows: 1,
      gapRatio: 0.25,
      metrics: ZERO_METRICS,
    });

    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0].x).toBeCloseTo(W / 2, 6);
    expect(result.tiles[0].y).toBeCloseTo(H / 2, 6);
  });

  it.each([
    [1, 1],
    [4, 8],
    [12, 40],
    [3, 5],
  ])('produces columns * rows tiles (columns=%i, rows=%i)', (columns, rows) => {
    const result = computeWatermarkLayout({
      pageWidth: 612,
      pageHeight: 792,
      text: 'CONFIDENTIAL',
      angleDeg: -45,
      columns,
      rows,
      gapRatio: 0.25,
      metrics: TEXT_METRICS,
    });
    expect(result.tiles).toHaveLength(columns * rows);
  });

  it.each([45, -45])('at angle=%i on a square page, coverW ≈ coverH ≈ W·√2 and every tile center is inside the rotated cover box', (angleDeg) => {
    const W = 500;
    const H = 500;
    const { coverW, coverH } = computeCoverBox(W, H, angleDeg);

    expect(coverW).toBeCloseTo(W * Math.SQRT2, 6);
    expect(coverH).toBeCloseTo(H * Math.SQRT2, 6);

    const result = computeWatermarkLayout({
      pageWidth: W,
      pageHeight: H,
      text: 'X',
      angleDeg,
      columns: 4,
      rows: 8,
      gapRatio: 0.25,
      metrics: ZERO_METRICS, // tiles[].{x,y} == raw tile centers
    });

    const angleRad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    for (const tile of result.tiles) {
      // Undo the page-center translation and rotation to recover (u, v) in
      // the rotated cover-box frame, then check it's inside the box.
      const dx = tile.x - W / 2;
      const dy = tile.y - H / 2;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;

      expect(Math.abs(u)).toBeLessThanOrEqual(coverW / 2 + 1e-6);
      expect(Math.abs(v)).toBeLessThanOrEqual(coverH / 2 + 1e-6);
    }
  });

  it('scales fontSize inversely with columns (double columns → roughly half the size)', () => {
    const base = { pageWidth: 612, pageHeight: 792, text: 'CONFIDENTIAL', angleDeg: -45, rows: 8, gapRatio: 0.25, metrics: TEXT_METRICS };

    const at4 = computeWatermarkLayout({ ...base, columns: 4 });
    const at8 = computeWatermarkLayout({ ...base, columns: 8 });

    expect(at8.fontSize).toBeCloseTo(at4.fontSize / 2, 3);
  });

  it('angle=90 yields the same tile count and a cover box with W and H swapped', () => {
    const W = 612;
    const H = 792;

    const at0 = computeCoverBox(W, H, 0);
    const at90 = computeCoverBox(W, H, 90);

    expect(at90.coverW).toBeCloseTo(at0.coverH, 6);
    expect(at90.coverH).toBeCloseTo(at0.coverW, 6);

    const layout0 = computeWatermarkLayout({ pageWidth: W, pageHeight: H, text: 'X', angleDeg: 0, columns: 4, rows: 8, gapRatio: 0.25, metrics: TEXT_METRICS });
    const layout90 = computeWatermarkLayout({ pageWidth: W, pageHeight: H, text: 'X', angleDeg: 90, columns: 4, rows: 8, gapRatio: 0.25, metrics: TEXT_METRICS });

    expect(layout90.tiles).toHaveLength(layout0.tiles.length);
  });

  it('uses an explicit fontSize verbatim, ignoring columns, rows and gap', () => {
    const base = { pageWidth: 612, pageHeight: 792, text: 'CONFIDENTIAL', angleDeg: -45, metrics: TEXT_METRICS, fontSize: 37 };

    expect(computeWatermarkLayout({ ...base, columns: 4, rows: 8, gapRatio: 0.25 }).fontSize).toBe(37);
    expect(computeWatermarkLayout({ ...base, columns: 12, rows: 40, gapRatio: 0 }).fontSize).toBe(37);
    expect(computeWatermarkLayout({ ...base, columns: 1, rows: 1, gapRatio: 0.6 }).fontSize).toBe(37);
  });

  it('falls back to the auto fit when fontSize is omitted or non-positive', () => {
    const base = { pageWidth: 612, pageHeight: 792, text: 'CONFIDENTIAL', angleDeg: -45, columns: 4, rows: 8, gapRatio: 0.25, metrics: TEXT_METRICS };

    const auto = computeWatermarkLayout(base);
    expect(computeWatermarkLayout({ ...base, fontSize: 0 }).fontSize).toBeCloseTo(auto.fontSize, 6);
    expect(computeWatermarkLayout({ ...base, fontSize: -10 }).fontSize).toBeCloseTo(auto.fontSize, 6);
    expect(auto.fontSize).not.toBe(37);
  });

  it('leaves tile positions untouched when only fontSize changes', () => {
    const base = { pageWidth: 612, pageHeight: 792, text: 'X', angleDeg: -45, columns: 3, rows: 4, gapRatio: 0.25, metrics: ZERO_METRICS };

    const small = computeWatermarkLayout({ ...base, fontSize: 10 });
    const large = computeWatermarkLayout({ ...base, fontSize: 200 });

    // ZERO_METRICS collapses the baseline offset, so these are raw tile centers.
    expect(small.tiles).toEqual(large.tiles);
  });

  it('clamps an explicit fontSize into [4, 400] too', () => {
    const base = { pageWidth: 612, pageHeight: 792, text: 'X', angleDeg: 0, columns: 4, rows: 8, gapRatio: 0.25, metrics: TEXT_METRICS };

    expect(computeWatermarkLayout({ ...base, fontSize: 1 }).fontSize).toBe(4);
    expect(computeWatermarkLayout({ ...base, fontSize: 10000 }).fontSize).toBe(400);
  });

  it('clamps fontSize into [4, 400]', () => {
    const tiny = computeWatermarkLayout({
      pageWidth: 10,
      pageHeight: 10,
      text: 'X',
      angleDeg: 0,
      columns: 12,
      rows: 40,
      gapRatio: 0.25,
      metrics: TEXT_METRICS,
    });
    expect(tiny.fontSize).toBeGreaterThanOrEqual(4);

    const huge = computeWatermarkLayout({
      pageWidth: 100000,
      pageHeight: 100000,
      text: 'X',
      angleDeg: 0,
      columns: 1,
      rows: 1,
      gapRatio: 0.25,
      metrics: TEXT_METRICS,
    });
    expect(huge.fontSize).toBeLessThanOrEqual(400);
  });
});
