import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Box, Button, Center, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconFileUpload } from '@tabler/icons-react';
import { useWatermarkStore } from '../state/store';
import { useFileIngest } from '../state/useFileIngest';
import { getOrLoadDocument } from '../core/docCache';
import { isRenderingCancelledException, renderPageToCanvas, type RenderTask } from '../core/pdfjs';
import { WatermarkOverlay } from './WatermarkOverlay';

const RENDER_DEBOUNCE_MS = 120;

interface PageDims {
  visualWidth: number;
  visualHeight: number;
  cssWidth: number;
  cssHeight: number;
}

export function PreviewPane() {
  const files = useWatermarkStore((s) => s.files);
  const selectedId = useWatermarkStore((s) => s.selectedId);
  const selected = files.find((f) => f.id === selectedId) ?? null;
  const ingestFiles = useFileIngest();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks the in-flight pdf.js RenderTask so a superseding render (from a
  // rapid resize or page/file change) can cancel it first — pdf.js throws
  // if two render() calls overlap on the same canvas, which would otherwise
  // leave the base page canvas blank (spec §5, §11: preview must stay correct).
  const renderTaskRef = useRef<RenderTask | null>(null);
  // A state-backed (not ref-object) container node: the element mounts and
  // unmounts as `selected`'s status changes, so a plain useRef wouldn't
  // reliably re-trigger the observer effect below.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const [pageNumberByFile, setPageNumberByFile] = useState<Record<string, number>>({});
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageDims, setPageDims] = useState<PageDims | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const pageNumber = selected ? (pageNumberByFile[selected.id] ?? 1) : 1;
  const pageCount = selected?.pageCount ?? 1;

  // Track available width, debounced (spec §5: debounce the pdf.js page render).
  useEffect(() => {
    if (!containerEl) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      clearTimeout(timeout);
      timeout = setTimeout(() => setContainerWidth(width), RENDER_DEBOUNCE_MS);
    });
    observer.observe(containerEl);
    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [containerEl]);

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);

    if (!selected || selected.status !== 'ready' || containerWidth <= 0 || !canvasRef.current) {
      return;
    }

    const cssWidth = Math.min(containerWidth - 32, 900);

    // Cancel any still-running render on this canvas before starting a new
    // one — required, not just an optimization (see renderTaskRef above).
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;

    getOrLoadDocument(selected.id, selected.bytes, selected.name)
      .then((doc) => doc.getPage(pageNumber))
      .then((page) => {
        if (cancelled || !canvasRef.current) return null;
        const { task, result } = renderPageToCanvas(page, canvasRef.current, cssWidth);
        renderTaskRef.current = task;
        return result;
      })
      .then((dims) => {
        if (cancelled || !dims) return;
        setPageDims({ visualWidth: dims.visualWidth, visualHeight: dims.visualHeight, cssWidth, cssHeight: dims.cssHeight });
      })
      .catch((err) => {
        if (cancelled || isRenderingCancelledException(err)) return;
        setRenderError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [selected, pageNumber, containerWidth]);

  // Cancel any in-flight render when the preview pane itself unmounts.
  useEffect(() => () => renderTaskRef.current?.cancel(), []);

  if (!selected) {
    return (
      <Center h="100%">
        <Stack align="center" gap="sm">
          <IconFileUpload size={64} stroke={1} opacity={0.5} />
          <Text c="dimmed">Drop in a PDF to get started</Text>
          <Button variant="light" onClick={() => inputRef.current?.click()}>
            Upload PDF
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) ingestFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </Stack>
      </Center>
    );
  }

  if (selected.status === 'encrypted' || selected.status === 'error') {
    return (
      <Center h="100%" p="xl">
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Can't preview this file">
          {selected.errorMessage ?? 'This file could not be loaded.'}
        </Alert>
      </Center>
    );
  }

  return (
    <Stack h="100%" gap="sm" p="md">
      <Group justify="center" gap="xs">
        <ActionIcon
          variant="subtle"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumberByFile((m) => ({ ...m, [selected.id]: pageNumber - 1 }))}
        >
          <IconChevronLeft size={18} />
        </ActionIcon>
        <Text size="sm">
          {pageNumber} / {pageCount}
        </Text>
        <ActionIcon
          variant="subtle"
          disabled={pageNumber >= pageCount}
          onClick={() => setPageNumberByFile((m) => ({ ...m, [selected.id]: pageNumber + 1 }))}
        >
          <IconChevronRight size={18} />
        </ActionIcon>
      </Group>

      {/*
        Plain flex box, not Mantine's <Center>: centering with align-items
        "center" clips unreachable content when the page is taller than the
        viewport (a classic flexbox-centering-with-overflow trap — the
        overflow above the fold becomes unscrollable). "safe center" falls
        back to start-alignment instead of clipping once content overflows.
      */}
      <Box
        flex={1}
        style={{ overflow: 'auto', display: 'flex', justifyContent: 'safe center', alignItems: 'safe center' }}
        ref={setContainerEl}
      >
        {renderError ? (
          <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Render error">
            {renderError}
          </Alert>
        ) : (
          <Box style={{ position: 'relative', lineHeight: 0, boxShadow: '0 4px 24px rgba(0,0,0,0.4)', flexShrink: 0 }}>
            <canvas ref={canvasRef} />
            {pageDims && (
              <WatermarkOverlay
                visualWidth={pageDims.visualWidth}
                visualHeight={pageDims.visualHeight}
                cssWidth={pageDims.cssWidth}
                cssHeight={pageDims.cssHeight}
              />
            )}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
