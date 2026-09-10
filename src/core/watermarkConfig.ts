// Watermark model (spec §3) — the single config shape shared by the store,
// the preview overlay, and the pdf-lib exporter.

import { DEFAULT_FONT_ID } from './fonts';

export interface WatermarkConfig {
  text: string;
  fontId: string;
  /** 1–12, integer — horizontal repeats; controls watermark WIDTH. */
  columns: number;
  /** 1–40, integer — vertical repeats; controls how many diagonal rows. */
  rows: number;
  /** -90..90 degrees, 1° steps; 0 = horizontal, -90/90 = vertical. */
  angle: number;
  /** Hex color. */
  color: string;
  /** 0.05–1. */
  opacity: number;
  /** 0–0.6 — share of each tile left empty (breathing room). */
  gapRatio: number;
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  text: 'CONFIDENTIAL',
  fontId: DEFAULT_FONT_ID,
  columns: 4,
  rows: 8,
  angle: -45,
  color: '#B9B9C2',
  opacity: 0.45,
  gapRatio: 0.25,
};

export const CONFIG_LIMITS = {
  columns: { min: 1, max: 12, step: 1 },
  rows: { min: 1, max: 40, step: 1 },
  angle: { min: -90, max: 90, step: 1 },
  opacity: { min: 0.05, max: 1, step: 0.01 },
  gapRatio: { min: 0, max: 0.6, step: 0.01 },
} as const;

export const ANGLE_PRESETS = [
  { label: 'Diagonal ↗', value: 45 },
  { label: 'Diagonal ↘', value: -45 },
  { label: 'Horizontal', value: 0 },
  { label: 'Vertical', value: 90 },
] as const;
