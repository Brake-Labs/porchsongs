import { useState, useEffect, useRef, useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf, closePdf, renderPage } from '@/lib/pdfViewer';
import { cn } from '@/lib/utils';
import Spinner from '@/components/ui/spinner';

/**
 * The performance sheet for a stored tab: a PDF rendered for playing from.
 *
 * The counterpart to PerformanceSheet, which does the same job for chart text.
 * Neither offers any way to edit, because a stored document has nothing to edit,
 * and a chart on this screen is being read from six feet away.
 *
 * Pages render one at a time to a canvas rather than all of them into a scroller.
 * A tab is read a page at a time on a music stand, and rasterising twenty pages
 * of a scan at device pixel ratio is how a phone runs out of memory mid-tune.
 */

interface DocumentSheetProps {
  /** The PDF bytes. Fetched by the caller, which owns the auth and the cache. */
  data: ArrayBuffer | null;
  /** Reports the page count once the document parses, so a parent can show it. */
  onPageCount?: (pages: number) => void;
  className?: string;
}

export default function DocumentSheet({ data, onPageCount, className }: DocumentSheetProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  // Renders are async and a fast tap can start a second before the first
  // finishes. Only the newest may paint, or pages arrive out of order.
  const renderToken = useRef(0);

  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  // Parse the document once per set of bytes.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setStatus('loading');
    openPdf(data)
      .then((pdf) => {
        if (cancelled) {
          void closePdf(pdf);
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setPage(1);
        setStatus('ready');
        onPageCount?.(pdf.numPages);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError((err as Error)?.message ?? 'Could not open this file.');
        setStatus('error');
      });
    return () => {
      cancelled = true;
      if (pdfRef.current) void closePdf(pdfRef.current);
      pdfRef.current = null;
    };
  }, [data, onPageCount]);

  const draw = useCallback(async () => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdf || !canvas || !container) return;

    const token = ++renderToken.current;
    // Fit to the container, then apply zoom. Subtracting the padding keeps a
    // fitted page from triggering a horizontal scrollbar that then narrows the
    // container, which oscillates.
    const width = Math.max(120, container.clientWidth - 16) * zoom;
    try {
      await renderPage(pdf, page, canvas, width);
      if (token !== renderToken.current) return;
    } catch (err) {
      if (token !== renderToken.current) return;
      setError((err as Error)?.message ?? 'Could not render this page.');
      setStatus('error');
    }
  }, [page, zoom]);

  useEffect(() => {
    if (status === 'ready') void draw();
  }, [status, draw]);

  // Re-render on resize: rotating a tablet on a stand changes the fitted width,
  // and a canvas rasterised for the old one is visibly soft.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || status !== 'ready') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void draw());
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [status, draw]);

  const goTo = useCallback(
    (next: number) => setPage((p) => Math.min(pageCount || 1, Math.max(1, next || p))),
    [pageCount],
  );

  // Arrow keys and space, for a foot pedal or a bluetooth page turner. Both
  // present as a keyboard, which is why this is bound at the document rather
  // than on a focused element nobody will have tapped.
  useEffect(() => {
    if (status !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        goTo(page + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goTo(page - 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [status, page, goTo]);

  if (status === 'error') {
    return (
      <div
        className={cn('flex flex-col items-center justify-center gap-2 text-center', className)}
      >
        <h2 className="font-display text-xl text-foreground">Could not open this file</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto flex justify-center p-2"
        data-testid="document-scroll"
      >
        {status === 'loading' ? (
          <div className="flex items-center gap-3 text-muted-foreground self-center">
            <Spinner />
            <span className="text-sm">Loading tab...</span>
          </div>
        ) : (
          <canvas ref={canvasRef} className="shadow-sm bg-white h-fit" aria-label={`Page ${page}`} />
        )}
      </div>

      {status === 'ready' && pageCount > 0 && (
        <div className="shrink-0 flex items-center justify-center gap-2 py-1">
          {/* 44px targets throughout: these are hit while holding an instrument. */}
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page <= 1}
            className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-panel hover:text-foreground disabled:opacity-40 cursor-pointer"
            aria-label="Previous page"
          >
            &larr;
          </button>
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap px-1">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={page >= pageCount}
            className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-panel hover:text-foreground disabled:opacity-40 cursor-pointer"
            aria-label="Next page"
          >
            &rarr;
          </button>
          <div className="w-px h-6 bg-border mx-1" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
            disabled={zoom <= 0.5}
            className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md border border-border text-sm text-muted-foreground hover:bg-panel hover:text-foreground disabled:opacity-40 cursor-pointer"
            aria-label="Zoom out"
          >
            &minus;
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="min-h-[2.75rem] px-2 inline-flex items-center justify-center rounded-md border border-border text-xs text-muted-foreground hover:bg-panel hover:text-foreground cursor-pointer whitespace-nowrap"
            aria-label={`Zoom: ${Math.round(zoom * 100)} percent. Reset to fit width`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
            disabled={zoom >= 4}
            className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md border border-border text-sm text-muted-foreground hover:bg-panel hover:text-foreground disabled:opacity-40 cursor-pointer"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
