import { useState, useEffect, useRef } from 'react';
import {
  solvePerformanceLayout,
  splitContentForColumns,
  packColumnsToHeight,
  maxColumnsForContent,
  longestLineLength,
  LINE_HEIGHT_RATIO,
  type SolveResult,
} from '@/lib/performanceLayout';

let cachedCharWidthRatio: number | null = null;

/**
 * Measure the character-width-to-font-size ratio for the monospace font.
 * Creates a hidden span at a known font size and measures its width.
 * Result is cached since the ratio is constant for a given font.
 */
function getCharWidthRatio(): number {
  if (cachedCharWidthRatio !== null) return cachedCharWidthRatio;

  const span = document.createElement('span');
  span.style.fontFamily = 'var(--font-mono)';
  span.style.fontSize = '100px';
  span.style.position = 'absolute';
  span.style.visibility = 'hidden';
  span.style.whiteSpace = 'pre';
  span.textContent = 'MMMMMMMMMM'; // 10 chars
  document.body.appendChild(span);
  const ratio = span.offsetWidth / 10 / 100; // width per char / font size
  document.body.removeChild(span);

  cachedCharWidthRatio = ratio;
  return ratio;
}

export interface PerformanceLayout {
  /** Column chunks to render, or null for a single column. */
  columns: string[] | null;
  /** Resolved column count (1 means single column). */
  numCols: number;
  /** Auto-computed font size in px, or undefined before first measurement. */
  fontSize: number | undefined;
  /** Whether the chart fits on screen without vertical scrolling. */
  fitsOnScreen: boolean;
}

const INITIAL: PerformanceLayout = { columns: null, numCols: 1, fontSize: undefined, fitsOnScreen: false };

/**
 * Resolve the full performance-view layout (column count + font size) from the
 * container's measured size. Recomputes on container resize, text change, or a
 * change in the column preference, so the font always matches the real layout.
 */
export default function usePerformanceLayout(
  containerRef: React.RefObject<HTMLElement | null>,
  text: string,
  columnsPref: number | 'auto',
  fontSizeOverride: number | null = null,
): PerformanceLayout {
  const [layout, setLayout] = useState<PerformanceLayout>(INITIAL);
  const prefRef = useRef(columnsPref);
  prefRef.current = columnsPref;
  const overrideRef = useRef(fontSizeOverride);
  overrideRef.current = fontSizeOverride;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const container = containerRef.current;
      if (!container) return;

      const longestLineLen = longestLineLength(text);
      if (longestLineLen === 0) return;

      // A hidden container measures 0x0, and that is not a measurement. The
      // chord panel hides the chart at phone width, and solving against nothing
      // answers with the minimum font, which then flashes on screen as the panel
      // closes and leaves the size stepper anchored to 10px if it is tapped
      // first. Keep the last real answer until there is a real box again.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;

      const totalLines = text.split('\n').length;
      const result: SolveResult = solvePerformanceLayout({
        containerWidth: container.clientWidth,
        containerHeight: container.clientHeight,
        charRatio: getCharWidthRatio(),
        longestLineLen,
        totalLines,
        maxColsContent: maxColumnsForContent(text),
        columnsPref: prefRef.current,
      });

      let columns: string[] | null = null;
      if (result.numCols > 1) {
        // Use the font actually rendered (manual override wins over the auto
        // size) to decide whether the song overflows the screen at this layout.
        const effectiveFont = overrideRef.current ?? result.fontSize;
        const linesPerViewport = Math.max(
          1,
          Math.floor(container.clientHeight / (effectiveFont * LINE_HEIGHT_RATIO)),
        );
        const balancedColLines = Math.ceil(totalLines / result.numCols);

        columns =
          balancedColLines <= linesPerViewport
            ? // Whole song fits: balanced columns read best.
              splitContentForColumns(text, result.numCols)
            : // Overflows: fill each column to the viewport so only the last
              // column scrolls, instead of every column spilling below the fold.
              (packColumnsToHeight(text, result.numCols, linesPerViewport) ??
              splitContentForColumns(text, result.numCols));
      }
      const numCols = columns ? result.numCols : 1;

      setLayout({
        columns,
        numCols,
        fontSize: Math.round(result.fontSize * 10) / 10,
        fitsOnScreen: result.fitsOnScreen,
      });
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, text, columnsPref, fontSizeOverride]);

  return layout;
}
