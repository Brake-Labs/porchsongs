import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { openPdf, closePdf, renderPage, cancelRender } from '@/lib/pdfViewer';
import { STORAGE_KEYS } from '@/api';
import { cn } from '@/lib/utils';
import Spinner from '@/components/ui/spinner';

/**
 * The performance sheet for a stored tab: a PDF rendered for playing from.
 *
 * The counterpart to PerformanceSheet, which does the same job for chart text.
 * Neither offers any way to edit, because a stored document has nothing to edit,
 * and a chart on this screen is being read from six feet away.
 *
 * Renders the pages you are looking at and no others. That is the rule the
 * original one-page-at-a-time version was protecting: rasterising twenty pages
 * of a scan at device pixel ratio is how a phone runs out of memory mid-tune.
 * Showing two or three across does not break it, because the count is capped and
 * bounded by the width available; scrolling the whole document would.
 */

/** The most pages that may be shown at once. */
const MAX_PER_VIEW = 4;

/** Gap between pages in a multi-page view, in CSS pixels. Matches `gap-2`. */
const PAGE_GAP_PX = 8;

/**
 * The width one page needs before another will fit beside it.
 *
 * A portrait page squeezed below this is not a page you can read fret numbers
 * off at arm's length, which is the whole job. So the picker offers only the
 * counts the screen can actually carry, and a phone is offered one.
 */
const MIN_PAGE_WIDTH_PX = 320;

function storedPerView(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = Number(window.localStorage.getItem(STORAGE_KEYS.DOCUMENT_PAGES));
    if (Number.isInteger(raw) && raw >= 1 && raw <= MAX_PER_VIEW) return raw;
  } catch {
    // A private window, or storage the browser refuses. One page is the default
    // everywhere else, so it is the right answer here too.
  }
  return 1;
}

interface DocumentSheetProps {
  /** The PDF bytes. Fetched by the caller, which owns the auth and the cache. */
  data: ArrayBuffer | null;
  /** Reports the page count once the document parses, so a parent can show it. */
  onPageCount?: (pages: number) => void;
  className?: string;
}

export default function DocumentSheet({ data, onPageCount, className }: DocumentSheetProps) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  // Renders are async and a fast tap can start a second before the first
  // finishes. Only the newest may paint, or pages arrive out of order.
  const renderToken = useRef(0);
  // pdf.js refuses to run two renders against one canvas, so the previous ones
  // are cancelled and awaited rather than merely ignored. A discarded-but-running
  // render still owns its canvas. One entry per visible page.
  const renderTasks = useRef<(RenderTask | null)[]>([]);

  const [pageCount, setPageCount] = useState(0);
  // The first page of the visible run. With one page across this is the page.
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [perView, setPerView] = useState(storedPerView);
  // Starts at one and widens only once the container has been measured. Starting
  // at the cap meant a phone rendered the picker for a frame and then took it
  // away again, which is a worse flicker than a wide screen briefly showing one
  // page before it settles.
  const [maxFit, setMaxFit] = useState(1);
  // Shown briefly after a gesture turns a page. With the page filling the
  // screen, the number in the bar is the only thing that says where you are, and
  // on a stand your eyes are not on the bar.
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  // What is actually on screen: never more than the screen can carry, and never
  // more than the document has left. A two-page document does not get four
  // slots, three of them blank.
  const spread = useMemo(() => {
    const wanted = Math.min(perView, maxFit, pageCount || 1);
    const pages: number[] = [];
    for (let i = 0; i < wanted && page + i <= (pageCount || 1); i += 1) pages.push(page + i);
    return pages;
  }, [perView, maxFit, page, pageCount]);

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
    const container = containerRef.current;
    if (!pdf || !container || spread.length === 0) return;

    const token = ++renderToken.current;
    const pending = renderTasks.current;
    renderTasks.current = [];
    await Promise.all(pending.map((task) => cancelRender(task)));
    if (token !== renderToken.current) return;

    // Subtracting the padding keeps a fitted page from triggering a scrollbar
    // that then narrows the container, which oscillates. The gaps come off too,
    // or the last page in a row is the one that overflows.
    // Drop refs for slots the spread no longer has, so a narrower view does not
    // hold the previous one's canvases alive.
    canvasRefs.current.length = spread.length;

    const gaps = PAGE_GAP_PX * (spread.length - 1);
    const box = {
      width: Math.max(120, (container.clientWidth - 16 - gaps) / spread.length),
      height: Math.max(120, container.clientHeight - 16),
    };

    try {
      const tasks = await Promise.all(
        spread.map((pageNumber, index) => {
          const canvas = canvasRefs.current[index];
          if (!canvas) return null;
          return renderPage(pdf, pageNumber, canvas, box, zoom);
        }),
      );
      if (token !== renderToken.current) {
        await Promise.all(tasks.map((task) => cancelRender(task)));
        return;
      }
      renderTasks.current = tasks;
      await Promise.all(tasks.map((task) => task?.promise));
      if (token === renderToken.current) renderTasks.current = [];
    } catch (err) {
      if (token !== renderToken.current) return;
      setError((err as Error)?.message ?? 'Could not render this page.');
      setStatus('error');
    }
  }, [spread, zoom]);

  // Stop any render still running when the sheet goes away, so it does not
  // settle against a canvas React has already detached.
  useEffect(
    () => () => {
      renderToken.current++;
      void Promise.all(renderTasks.current.map((task) => cancelRender(task)));
      renderTasks.current = [];
    },
    [],
  );

  useEffect(() => {
    if (status === 'ready') void draw();
  }, [status, draw]);

  // Re-render on resize: rotating a tablet on a stand changes the fitted width,
  // and a canvas rasterised for the old one is visibly soft. The same measurement
  // decides how many pages will fit, so a rotation can change the count as well
  // as the size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || status !== 'ready') return;
    let frame = 0;
    const measure = () => {
      const usable = container.clientWidth - 16;
      setMaxFit(Math.max(1, Math.min(MAX_PER_VIEW, Math.floor(usable / MIN_PAGE_WIDTH_PX))));
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        measure();
        void draw();
      });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [status, draw]);

  const step = spread.length || 1;

  /**
   * Move by whole spreads, and land on a run that is actually full.
   *
   * Paging forward by the step is what makes two-up read like a book rather than
   * a window sliding one page at a time over the same content. Clamping the last
   * run back from the end keeps the final turn from showing one page next to a
   * gap where the previous one already was.
   *
   * The target is clamped rather than rejected. `page - step` is 0 whenever that
   * clamp has already pulled the run back onto its own step (three pages two-up
   * lands on 2, four-up on seven lands on 4), and treating 0 as no target left
   * Previous enabled and inert with no way back to the first page.
   */
  const goTo = useCallback(
    (next: number) =>
      setPage(() => {
        const total = pageCount || 1;
        const last = Math.max(1, total - step + 1);
        return Math.min(last, Math.max(1, next));
      }),
    [pageCount, step],
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

  const choosePerView = useCallback((next: number) => {
    setPerView(next);
    try {
      window.localStorage.setItem(STORAGE_KEYS.DOCUMENT_PAGES, String(next));
    } catch {
      // Not worth failing a page turn over.
    }
  }, []);

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

      if (dx < 0 && start.atEnd && page + step <= pageCount) {
        goTo(page + step);
        showFlash();
      } else if (dx > 0 && start.atStart && page > 1) {
        goTo(page - step);
        showFlash();
      }
    },
    [goTo, page, pageCount, showFlash, step],
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
        goTo(page + step);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goTo(page - step);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [status, page, goTo, step]);

  /** "3" for one page, "3-5" for a run of them. */
  const shown =
    spread.length > 1 ? `${spread[0]}-${spread[spread.length - 1]}` : String(spread[0] ?? page);

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
        className="flex-1 min-h-0 overflow-auto flex justify-center items-start gap-2 p-2 relative"
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
            {shown} / {pageCount}
          </div>
        )}
        {status === 'loading' ? (
          <div className="flex items-center gap-3 text-muted-foreground self-center">
            <Spinner />
            <span className="text-sm">Loading tab...</span>
          </div>
        ) : (
          spread.map((pageNumber, index) => (
            <canvas
              // Keyed by slot, not by page number. Keying by the page remounts
              // every canvas on every turn, and a fitted portrait page at device
              // pixel ratio is around 20MB of backing store: paging through a
              // long scan detaches hundreds of megabytes waiting on GC, which on
              // iOS Safari hits a hard canvas-memory ceiling and blanks the page
              // mid-tune. That is the failure this file's header exists to
              // prevent. The cost is that a page which survives a turn in a
              // spread repaints instead of keeping its pixels, which is a frame.
              key={index}
              ref={(el) => {
                canvasRefs.current[index] = el;
              }}
              className="shadow-sm bg-white h-fit"
              aria-label={`Page ${pageNumber}`}
            />
          ))
        )}
      </div>

      {status === 'ready' && pageCount > 0 && (
        <div className="shrink-0 flex items-center justify-center gap-2 py-1 flex-wrap">
          {/* 44px targets throughout: these are hit while holding an instrument. */}
          <button
            type="button"
            onClick={() => goTo(page - step)}
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
            {shown} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => goTo(page + step)}
            disabled={page + step > pageCount}
            className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-panel hover:text-foreground disabled:opacity-40 cursor-pointer"
            aria-label="Next page"
          >
            &rarr;
          </button>

          {/* Offered only when the screen can carry a second page. Below that the
              picker would be three disabled buttons explaining themselves. */}
          {maxFit > 1 && pageCount > 1 && (
            <>
              <div className="w-px h-6 bg-border mx-1" aria-hidden="true" />
              <div
                className="inline-flex rounded-md border border-border overflow-hidden"
                role="group"
                aria-label="Pages at a time"
                data-testid="pages-per-view"
              >
                {Array.from({ length: Math.min(maxFit, MAX_PER_VIEW) }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => choosePerView(n)}
                    // Against what is actually shown, not what was stored. A
                    // remembered 4 on a screen that fits 2 otherwise renders a
                    // picker with nothing selected while showing two pages.
                    aria-pressed={Math.min(perView, maxFit) === n}
                    className={cn(
                      'min-w-[2.25rem] min-h-[2.75rem] inline-flex items-center justify-center text-xs tabular-nums cursor-pointer border-r border-border last:border-r-0',
                      perView === n
                        ? 'bg-primary text-white'
                        : 'text-muted-foreground hover:bg-panel hover:text-foreground',
                    )}
                    aria-label={n === 1 ? 'One page at a time' : `${n} pages at a time`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}

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
