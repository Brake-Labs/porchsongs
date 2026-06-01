import { useState, useEffect, useRef } from 'react';
import {
  solvePerformanceLayout,
  splitContentForColumns,
  maxColumnsForContent,
  longestLineLength,
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
): PerformanceLayout {
  const [layout, setLayout] = useState<PerformanceLayout>(INITIAL);
  const prefRef = useRef(columnsPref);
  prefRef.current = columnsPref;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const container = containerRef.current;
      if (!container) return;

      const longestLineLen = longestLineLength(text);
      if (longestLineLen === 0) return;

      const result: SolveResult = solvePerformanceLayout({
        containerWidth: container.clientWidth,
        containerHeight: container.clientHeight,
        charRatio: getCharWidthRatio(),
        longestLineLen,
        totalLines: text.split('\n').length,
        maxColsContent: maxColumnsForContent(text),
        columnsPref: prefRef.current,
      });

      const columns = result.numCols > 1 ? splitContentForColumns(text, result.numCols) : null;
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
  }, [containerRef, text, columnsPref]);

  return layout;
}
