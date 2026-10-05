// One load-time probe for everything a PDF might already carry from this
// app, so ingest parses the file once rather than once per question.

import { PDFDocument } from 'pdf-lib';
import { scanLegacyWatermark, type LegacyScan } from './legacyWatermark';
import { detectStamp, type StampDetection } from './watermarkTag';

export interface WatermarkProbe {
  /** A tagged watermark, which a re-export replaces exactly. */
  stamp: StampDetection;
  /**
   * An untagged watermark from an older version, found by shape. Only looked
   * for when there's no tagged one: a tagged file needs no guessing.
   */
  legacy: LegacyScan | null;
}

const NOTHING: WatermarkProbe = { stamp: { tagged: false, config: null }, legacy: null };

/**
 * Probes raw PDF bytes for a previous watermark by this app. Returns a
 * nothing-found result for anything it can't read, including encrypted files,
 * since a failed probe is not an error worth surfacing.
 */
export async function probeWatermarks(bytes: ArrayBuffer): Promise<WatermarkProbe> {
  try {
    const pdfDoc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: false });
    const stamp = detectStamp(pdfDoc);
    return { stamp, legacy: stamp.tagged ? null : scanLegacyWatermark(pdfDoc) };
  } catch {
    return NOTHING;
  }
}
