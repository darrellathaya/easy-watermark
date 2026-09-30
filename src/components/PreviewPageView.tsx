import { useEffect, useRef, useState } from 'react';
import { Box } from '@mantine/core';
import { isRenderingCancelledException } from '../core/pdfjs';
import { isPreviewRenderCancelled, type PreviewRenderHandle, type PreviewSource } from '../core/previewSource';
import { WatermarkOverlay } from './WatermarkOverlay';

/**
 * How far outside the scroll viewport a page starts rendering, and beyond
 * which it releases its canvas again. Generous enough that a normal scroll
 * never reveals a blank placeholder, tight enough that a long document
 * never holds more than a handful of full-page bitmaps in memory (each one
 * is cssWidth * cssHeight * dpr^2 * 4 bytes).
 */
const PRELOAD_MARGIN_PX = 900;

interface RenderedDims {
  visualWidth: number;
  visualHeight: number;
  cssWidth: number;
  cssHeight: number;
}

interface PreviewPageViewProps {
  source: PreviewSource;
  pageNumber: number;
  /** On-screen width in CSS pixels; shared by every page so the column stays flush. */
  cssWidth: number;
  /** Height to reserve before this page has rendered, so the scrollbar doesn't jump. */
  placeholderHeight: number;
  /** The scrolling element, used as the IntersectionObserver root. */
  scrollRoot: HTMLElement | null;
  onMeasured: (pageNumber: number, dims: { visualWidth: number; visualHeight: number }) => void;
  onElement: (pageNumber: number, el: HTMLDivElement | null) => void;
  onRenderError: (message: string) => void;
}

/**
 * One page of the continuous-scroll preview: the rendered subject (a PDF page
 * or an image) plus the watermark overlay, drawn only while near the viewport.
 */
export function PreviewPageView({
  source,
  pageNumber,
  cssWidth,
  placeholderHeight,
  scrollRoot,
  onMeasured,
  onElement,
  onRenderError,
}: PreviewPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Tracks the in-flight render so a superseding one (from a resize, or from
  // scrolling back into view) can cancel it first: pdf.js throws if two
  // render() calls overlap on the same canvas, which would otherwise leave
  // this page blank.
  const renderHandleRef = useRef<PreviewRenderHandle | null>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const [isNear, setIsNear] = useState(false);
  const [rendered, setRendered] = useState<RenderedDims | null>(null);

  // Hand the wrapper node to the parent, which owns scroll-to-page and the
  // "which page is at the viewport centre" observer.
  useEffect(() => {
    onElement(pageNumber, wrapperEl);
    return () => onElement(pageNumber, null);
  }, [wrapperEl, pageNumber, onElement]);

  useEffect(() => {
    if (!wrapperEl || !scrollRoot) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setIsNear(entry.isIntersecting);
      },
      { root: scrollRoot, rootMargin: `${PRELOAD_MARGIN_PX}px 0px` },
    );
    observer.observe(wrapperEl);
    return () => observer.disconnect();
  }, [wrapperEl, scrollRoot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderHandleRef.current?.cancel();
    renderHandleRef.current = null;

    if (!isNear || cssWidth <= 0) {
      // Release the backing store of an off-screen page; a zero-sized canvas
      // keeps the element (and its ref) stable for the next render.
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = '0px';
      canvas.style.height = '0px';
      setRendered(null);
      return;
    }

    let cancelled = false;
    const { handle, result } = source.render(pageNumber, canvas, cssWidth);
    renderHandleRef.current = handle;

    result
      .then((dims) => {
        if (cancelled) return;
        setRendered({
          visualWidth: dims.visualWidth,
          visualHeight: dims.visualHeight,
          cssWidth,
          cssHeight: dims.cssHeight,
        });
        onMeasured(pageNumber, { visualWidth: dims.visualWidth, visualHeight: dims.visualHeight });
      })
      .catch((err) => {
        if (cancelled || isPreviewRenderCancelled(err) || isRenderingCancelledException(err)) return;
        onRenderError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [source, pageNumber, cssWidth, isNear, onMeasured, onRenderError]);

  // Cancel any in-flight render when this page leaves the list.
  useEffect(() => () => renderHandleRef.current?.cancel(), []);

  const height = rendered?.cssHeight ?? placeholderHeight;

  return (
    <Box
      ref={setWrapperEl}
      data-page-number={pageNumber}
      style={{
        position: 'relative',
        width: cssWidth,
        height,
        flexShrink: 0,
        lineHeight: 0,
        background: 'var(--mantine-color-dark-5)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0 }} />
      {rendered && (
        <WatermarkOverlay
          visualWidth={rendered.visualWidth}
          visualHeight={rendered.visualHeight}
          cssWidth={rendered.cssWidth}
          cssHeight={rendered.cssHeight}
        />
      )}
    </Box>
  );
}
