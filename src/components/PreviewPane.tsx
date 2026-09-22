import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Box, Button, Center, Group, Loader, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconFileUpload } from '@tabler/icons-react';
import { useWatermarkStore } from '../state/store';
import { useFileIngest } from '../state/useFileIngest';
import { getOrLoadDocument } from '../core/docCache';
import type { PDFDocumentProxy } from '../core/pdfjs';
import { PdfPageView } from './PdfPageView';

const RENDER_DEBOUNCE_MS = 120;
/** Vertical gap between pages, also the scroll-to-page top inset. */
const PAGE_GAP_PX = 16;
/** Safety net: stop honouring a scroll-to-page target if it is never reached. */
const SCROLL_SETTLE_MS = 1200;

interface PageSize {
  visualWidth: number;
  visualHeight: number;
}

interface LoadedDoc {
  fileId: string;
  doc: PDFDocumentProxy;
}

export function PreviewPane() {
  const files = useWatermarkStore((s) => s.files);
  const selectedId = useWatermarkStore((s) => s.selectedId);
  const selected = files.find((f) => f.id === selectedId) ?? null;
  const ingestFiles = useFileIngest();

  const inputRef = useRef<HTMLInputElement>(null);
  // A state-backed (not ref-object) container node: the element mounts and
  // unmounts as `selected`'s status changes, so a plain useRef wouldn't
  // reliably re-trigger the observer effects below.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const [loaded, setLoaded] = useState<LoadedDoc | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [pageNumberByFile, setPageNumberByFile] = useState<Record<string, number>>({});
  const [containerWidth, setContainerWidth] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  const pageEls = useRef(new Map<number, HTMLDivElement>());
  // The page a scroll-to-page request is heading for. While it is set, the
  // centre observer only reports that page, so the counter doesn't flicker
  // through every page a smooth scroll passes over.
  const scrollTargetRef = useRef<number | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Read inside observer callbacks and one-shot effects, which must not be
  // rebuilt every time the current page changes.
  const selectedIdRef = useRef<string | null>(null);
  const pageNumberByFileRef = useRef(pageNumberByFile);

  const fileId = selected?.id ?? null;
  const fileStatus = selected?.status ?? null;
  const fileName = selected?.name;
  const fileBytes = selected?.bytes;

  // Declared first so these mirrors are current before any effect below runs.
  useEffect(() => {
    selectedIdRef.current = fileId;
    pageNumberByFileRef.current = pageNumberByFile;
  }, [fileId, pageNumberByFile]);

  const doc = loaded && loaded.fileId === fileId ? loaded.doc : null;
  const pageCount = doc?.numPages ?? selected?.pageCount ?? 1;
  const pageNumber = Math.min(fileId ? (pageNumberByFile[fileId] ?? 1) : 1, pageCount);
  const cssWidth = Math.max(Math.min(containerWidth - 32, 900), 0);

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

  // Load (or reuse) the pdf.js document for the selected file.
  useEffect(() => {
    setRenderError(null);
    if (!fileId || fileStatus !== 'ready' || !fileBytes) return;

    let cancelled = false;
    getOrLoadDocument(fileId, fileBytes, fileName)
      .then((d) => {
        if (!cancelled) setLoaded({ fileId, doc: d });
      })
      .catch((err) => {
        if (!cancelled) setRenderError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [fileId, fileStatus, fileBytes, fileName]);

  // Measure every page up front so the placeholders — and therefore the
  // scroll height — are right from the first frame, even in documents that
  // mix page sizes and orientations. Batched, because a page-at-a-time
  // setState would re-render the whole column once per page.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setPageSizes({});

    (async () => {
      let batch: Record<number, PageSize> = {};
      const flush = () => {
        if (Object.keys(batch).length === 0) return;
        const pending = batch;
        batch = {};
        setPageSizes((prev) => ({ ...prev, ...pending }));
      };

      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        try {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1 });
          batch[n] = { visualWidth: viewport.width, visualHeight: viewport.height };
        } catch {
          // A single unreadable page shouldn't stop the rest from sizing;
          // it falls back to the first page's aspect ratio below.
        }
        if (n % 8 === 0) flush();
      }
      if (!cancelled) flush();
    })();

    return () => {
      cancelled = true;
    };
  }, [doc]);

  const registerPageEl = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(page, el);
    else pageEls.current.delete(page);
  }, []);

  const handleMeasured = useCallback((page: number, dims: PageSize) => {
    setPageSizes((prev) => {
      const current = prev[page];
      if (current && current.visualWidth === dims.visualWidth && current.visualHeight === dims.visualHeight) {
        return prev;
      }
      return { ...prev, [page]: dims };
    });
  }, []);

  const handleRenderError = useCallback((message: string) => setRenderError(message), []);

  const setCurrentPage = useCallback((page: number) => {
    const id = selectedIdRef.current;
    if (!id) return;
    setPageNumberByFile((m) => (m[id] === page ? m : { ...m, [id]: page }));
  }, []);

  const clearScrollTarget = useCallback(() => {
    scrollTargetRef.current = null;
    clearTimeout(scrollTimeoutRef.current);
  }, []);

  const goToPage = useCallback(
    (page: number, behavior: ScrollBehavior = 'smooth') => {
      const target = Math.min(Math.max(page, 1), pageCount);
      const root = containerEl;
      const el = pageEls.current.get(target);
      setCurrentPage(target);
      if (!root || !el) return;

      scrollTargetRef.current = target;
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        scrollTargetRef.current = null;
      }, SCROLL_SETTLE_MS);

      root.scrollTo({ top: Math.max(el.offsetTop - PAGE_GAP_PX, 0), behavior });
    },
    [containerEl, pageCount, setCurrentPage],
  );

  // Scroll spy: the negative half-height margins shrink the observer root to
  // a single horizontal line across the middle of the viewport, so the page
  // intersecting it is the one the user is looking at.
  useEffect(() => {
    if (!containerEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (!Number.isFinite(page)) continue;
          if (scrollTargetRef.current !== null) {
            // Mid-jump: only the arrival counts.
            if (page !== scrollTargetRef.current) continue;
            clearScrollTarget();
          }
          setCurrentPage(page);
        }
      },
      { root: containerEl, rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    for (const el of pageEls.current.values()) observer.observe(el);
    return () => observer.disconnect();
    // Re-observe whenever the page list identity changes (new document, or
    // pages mounting for the first time).
  }, [containerEl, doc, pageCount, setCurrentPage, clearScrollTarget]);

  // A scroll the user drives themselves wins over a pending jump target.
  useEffect(() => {
    if (!containerEl) return;
    const onUserScroll = () => clearScrollTarget();
    containerEl.addEventListener('wheel', onUserScroll, { passive: true });
    containerEl.addEventListener('touchmove', onUserScroll, { passive: true });
    containerEl.addEventListener('pointerdown', onUserScroll, { passive: true });
    return () => {
      containerEl.removeEventListener('wheel', onUserScroll);
      containerEl.removeEventListener('touchmove', onUserScroll);
      containerEl.removeEventListener('pointerdown', onUserScroll);
    };
  }, [containerEl, clearScrollTarget]);

  // Pin the counter at the ends of the scroll range. The centre line can
  // come to rest over the *second*-to-last page when the last one is short,
  // so hitting the bottom is what confirms arrival at the final page.
  useEffect(() => {
    const root = containerEl;
    if (!root) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const scrollable = root.scrollHeight - root.clientHeight;
        if (scrollable <= 4) return;
        const edgePage = root.scrollTop >= scrollable - 2 ? pageCount : root.scrollTop <= 2 ? 1 : null;
        if (edgePage === null) return;
        if (scrollTargetRef.current !== null) {
          if (scrollTargetRef.current !== edgePage) return;
          clearScrollTarget();
        }
        setCurrentPage(edgePage);
      });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener('scroll', onScroll);
    };
  }, [containerEl, pageCount, setCurrentPage, clearScrollTarget]);

  // Restore the page this file was last left on, once per document (the list
  // always mounts at scroll top). This runs after the page wrappers have
  // registered themselves and before the centre observer's first callback,
  // so the restored page isn't immediately overwritten with page 1.
  const restoredForRef = useRef<PDFDocumentProxy | null>(null);
  useEffect(() => {
    if (!doc || !containerEl || cssWidth <= 0 || restoredForRef.current === doc) return;
    restoredForRef.current = doc;
    goToPage(pageNumberByFileRef.current[selectedIdRef.current ?? ''] ?? 1, 'auto');
  }, [doc, containerEl, cssWidth, goToPage]);

  useEffect(() => () => clearTimeout(scrollTimeoutRef.current), []);

  // Fall back to the first measured page's aspect ratio for pages that
  // haven't been measured yet, so placeholders are close to the mark.
  const fallbackAspect = useMemo(() => {
    const first = pageSizes[1] ?? Object.values(pageSizes)[0];
    return first && first.visualWidth > 0 ? first.visualHeight / first.visualWidth : 297 / 210;
  }, [pageSizes]);

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
        <ActionIcon variant="subtle" disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)} aria-label="Previous page">
          <IconChevronLeft size={18} />
        </ActionIcon>
        <Text size="sm">
          {pageNumber} / {pageCount}
        </Text>
        <ActionIcon
          variant="subtle"
          disabled={pageNumber >= pageCount}
          onClick={() => goToPage(pageNumber + 1)}
          aria-label="Next page"
        >
          <IconChevronRight size={18} />
        </ActionIcon>
      </Group>

      {/*
        The scroll container. `position: relative` makes it the offsetParent
        of each page wrapper, so scroll-to-page is a plain offsetTop lookup.
        Pages are laid out in a plain column with "safe center" alignment:
        centering with plain "center" clips unreachable content when a page
        is wider than the viewport (the classic flexbox-centering-with-
        overflow trap).
      */}
      <Box
        flex={1}
        ref={setContainerEl}
        style={{
          position: 'relative',
          overflow: 'auto',
          overscrollBehavior: 'contain',
        }}
      >
        {renderError ? (
          <Center h="100%">
            <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Render error">
              {renderError}
            </Alert>
          </Center>
        ) : !doc || cssWidth <= 0 ? (
          <Center h="100%">
            <Loader size="sm" />
          </Center>
        ) : (
          <Box
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'safe center',
              gap: PAGE_GAP_PX,
              paddingBlock: PAGE_GAP_PX,
              minWidth: 'min-content',
            }}
          >
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
              const size = pageSizes[page];
              const aspect = size && size.visualWidth > 0 ? size.visualHeight / size.visualWidth : fallbackAspect;
              return (
                <PdfPageView
                  key={page}
                  doc={doc}
                  pageNumber={page}
                  cssWidth={cssWidth}
                  placeholderHeight={cssWidth * aspect}
                  scrollRoot={containerEl}
                  onMeasured={handleMeasured}
                  onElement={registerPageEl}
                  onRenderError={handleRenderError}
                />
              );
            })}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
