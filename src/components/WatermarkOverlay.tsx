import { useEffect, useRef } from 'react';
import { useWatermarkStore } from '../state/store';
import { drawWatermarkSync } from '../core/canvasWatermark';
import { loadFontFace } from '../core/fonts';

interface WatermarkOverlayProps {
  /** Page's visual (post-rotation) size in PDF points; the same box the exporter tiles against. */
  visualWidth: number;
  visualHeight: number;
  /** On-screen size in CSS pixels, matching the base page canvas. */
  cssWidth: number;
  cssHeight: number;
}

/**
 * Absolutely-positioned canvas drawn on top of the rendered page or image,
 * through the same canvasWatermark.ts draw call the image exporter uses (and
 * the same layout.ts math the PDF exporter uses), which is what keeps
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

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      drawWatermarkSync(ctx, config, { visualWidth, visualHeight, cssWidth, cssHeight });
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
