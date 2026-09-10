import { useEffect, useRef } from 'react';
import { useWatermarkStore } from '../state/store';
import { computeWatermarkLayout } from '../core/layout';
import { measureFontMetrics } from '../core/canvasMetrics';
import { cssFamilyName, loadFontFace } from '../core/fonts';

interface WatermarkOverlayProps {
  /** Page's visual (post-rotation) size in PDF points — same box the exporter tiles against. */
  visualWidth: number;
  visualHeight: number;
  /** On-screen size in CSS pixels, matching the base page canvas. */
  cssWidth: number;
  cssHeight: number;
}

/**
 * Absolutely-positioned canvas drawn on top of the rendered page, using the
 * exact same layout.ts output the exporter uses — this is what keeps
 * preview and export visually identical (spec §11).
 */
export function WatermarkOverlay({ visualWidth, visualHeight, cssWidth, cssHeight }: WatermarkOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const config = useWatermarkStore((s) => s.config);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || visualWidth <= 0 || visualHeight <= 0 || cssWidth <= 0 || cssHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    loadFontFace(config.fontId).then(() => {
      if (cancelled) return;
      const family = cssFamilyName(config.fontId);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const metrics = measureFontMetrics(ctx, family, config.text);
      const { fontSize, tiles, angleRad } = computeWatermarkLayout({
        pageWidth: visualWidth,
        pageHeight: visualHeight,
        text: config.text,
        angleDeg: config.angle,
        columns: config.columns,
        rows: config.rows,
        gapRatio: config.gapRatio,
        metrics,
      });

      // PDF points -> CSS pixels. Uniform since the canvas matches the page's aspect ratio.
      const scale = cssWidth / visualWidth;

      ctx.font = `${fontSize * scale}px "${family}"`;
      ctx.fillStyle = config.color;
      ctx.globalAlpha = config.opacity;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      for (const tile of tiles) {
        // PDF space is y-up with origin bottom-left; canvas is y-down with
        // origin top-left, and rotation direction flips accordingly.
        const xPx = tile.x * scale;
        const yPx = cssHeight - tile.y * scale;
        ctx.save();
        ctx.translate(xPx, yPx);
        ctx.rotate(-angleRad);
        ctx.fillText(config.text, 0, 0);
        ctx.restore();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visualWidth, visualHeight, cssWidth, cssHeight, config]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    />
  );
}
