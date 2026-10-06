// One load-time probe for everything a PDF might already carry from this
// app, so ingest parses the file once rather than once per question.

import { PDFDocument } from 'pdf-lib';
import { scanWatermarks, type WatermarkFinding } from './removeWatermark';
import { detectStamp, type StampDetection } from './watermarkTag';

export interface WatermarkProbe {
  /** A tagged watermark, which a re-export replaces exactly. */
  stamp: StampDetection;
  /**
   * Watermarks this app didn't apply, by strategy: annotations, regions the
   * file labels as watermarks, and repeated tiles. A tagged watermark of our
   * own is excluded, since it's removed exactly rather than guessed at.
   */
  findings: WatermarkFinding[];
}

const NOTHING: WatermarkProbe = { stamp: { tagged: false, config: null }, findings: [] };

/**
 * Probes raw PDF bytes for a previous watermark by this app. Returns a
 * nothing-found result for anything it can't read, including encrypted files,
 * since a failed probe is not an error worth surfacing.
 */
export async function probeWatermarks(bytes: ArrayBuffer): Promise<WatermarkProbe> {
  try {
    const pdfDoc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: false });
    return { stamp: detectStamp(pdfDoc), findings: scanWatermarks(pdfDoc) };
  } catch {
    return NOTHING;
  }
}
