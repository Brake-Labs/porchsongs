import { useState, useEffect, useRef, useCallback } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { openPdf, closePdf, renderPage, cancelRender } from '@/lib/pdfViewer';
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
  // pdf.js refuses to run two renders against one canvas, so the previous one is
  // cancelled and awaited rather than merely ignored. A discarded-but-running
  // render still owns the canvas.
  const renderTask = useRef<RenderTask | null>(null);

  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  // Shown briefly after a gesture turns a page. With the page filling the
  // screen, the number in the bar is the only thing that says where you are, and
  // on a stand your eyes are not on the bar.
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
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
    const pending = renderTask.current;
    renderTask.current = null;
    await cancelRender(pending);
    if (token !== renderToken.current) return;

    // Subtracting the padding keeps a fitted page from triggering a scrollbar
    // that then narrows the container, which oscillates.
    const box = {
      width: Math.max(120, container.clientWidth - 16),
      height: Math.max(120, container.clientHeight - 16),
    };
    try {
      const task = await renderPage(pdf, page, canvas, box, zoom);
      if (token !== renderToken.current) {
        await cancelRender(task);
        return;
      }
      renderTask.current = task;
      await task.promise;
      if (token === renderToken.current) renderTask.current = null;
    } catch (err) {
      if (token !== renderToken.current) return;
      setError((err as Error)?.message ?? 'Could not render this page.');
      setStatus('error');
    }
  }, [page, zoom]);

  // Stop any render still running when the sheet goes away, so it does not
  // settle against a canvas React has already detached.
  useEffect(
    () => () => {
      renderToken.current++;
      void cancelRender(renderTask.current);
      renderTask.current = null;
    },
    [],
  );

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

  const showFlash = useCallback(() => {
    setFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1100);
  }, []);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  /**
   * Swipe sideways to turn a page, and double tap to zoom.
   *
   * The buttons stay. They are the only thing that works with a mouse, and
   * somebody who has learned where they are should not have them move. This is
   * about the hand that is holding an instrument: a swipe anywhere across the
   * page is a target the size of the screen, and the buttons are 44px at the
   * bottom edge, which is the far corner of a phone on a stand.
   *
   * The guard is what makes it usable when zoomed in. A zoomed page is wider
   * than the viewport and has to pan, so a swipe cannot always mean "turn". It
   * turns only when there is no more page to pan towards in that direction,
   * which is the same rule a photo gallery uses and the reason panning to the
   * edge and continuing feels like one gesture rather than two.
   */
  const touch = useRef<{ x: number; y: number; t: number; atStart: boolean; atEnd: boolean } | null>(
    null,
  );
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      // A second finger means a pinch, which is the browser's business.
      touch.current = null;
      return;
    }
    const el = containerRef.current;
    const slack = el ? el.scrollWidth - el.clientWidth : 0;
    const t = e.touches[0]!;
    touch.current = {
      x: t.clientX,
      y: t.clientY,
      t: Date.now(),
      // A 1px tolerance: scrollLeft is fractional on a zoomed page and an exact
      // comparison never quite reaches the end.
      atStart: !el || el.scrollLeft <= 1,
      atEnd: !el || slack <= 1 || el.scrollLeft >= slack - 1,
    };
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touch.current;
      touch.current = null;
      const end = e.changedTouches[0];
      if (!start || !end) return;

      const dx = end.clientX - start.x;
      const dy = end.clientY - start.y;
      const dt = Date.now() - start.t;

      // A tap, not a swipe. Two of them in quick succession toggles zoom, which
      // beats hunting for a 44px minus button while holding a pick.
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 400) {
        const prev = lastTap.current;
        const now = Date.now();
        if (
          prev &&
          now - prev.t < 320 &&
          Math.abs(end.clientX - prev.x) < 40 &&
          Math.abs(end.clientY - prev.y) < 40
        ) {
          lastTap.current = null;
          setZoom((z) => (z > 1.01 ? 1 : 2));
          return;
        }
        lastTap.current = { t: now, x: end.clientX, y: end.clientY };
        return;
      }

      // Dominantly horizontal, far enough to be deliberate, quick enough to be a
      // flick rather than a slow drag that was meant to pan.
      if (dt > 700 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

      if (dx < 0 && start.atEnd && page < pageCount) {
        goTo(page + 1);
        showFlash();
      } else if (dx > 0 && start.atStart && page > 1) {
        goTo(page - 1);
        showFlash();
      }
    },
    [goTo, page, pageCount, showFlash],
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
        className="flex-1 min-h-0 overflow-auto flex justify-center p-2 relative"
        data-testid="document-scroll"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {flash && pageCount > 0 && (
          <div
            // Deliberately not announced: `aria-label` on the canvas already
            // changes with the page, so a screen reader has been told. This is
            // for the eye that just glanced down mid-tune.
            aria-hidden="true"
            className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground/80 px-3 py-1 text-xs font-semibold tabular-nums text-background"
          >
            {page} / {pageCount}
          </div>
        )}
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
          <span
            className="text-xs text-muted-foreground tabular-nums whitespace-nowrap px-1"
            title="Swipe across the page to turn it. Double tap to zoom."
          >
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
            aria-label={`Zoom: ${Math.round(zoom * 100)} percent. Reset to fit the page`}
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
