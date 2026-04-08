import { useState, useEffect, useRef } from 'react';

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 18;

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

function longestLineLength(text: string): number {
  let max = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      const len = i - start;
      if (len > max) max = len;
      start = i + 1;
    }
  }
  return max;
}

interface UseAutoFontSizeOptions {
  /** Extra pixels to subtract from the column width (e.g. for padding/borders in grid mode) */
  columnOverhead?: number;
}

/**
 * Dynamically compute the largest monospace font size where the longest line
 * fits within the container without horizontal overflow.
 *
 * Returns undefined before the first measurement (use CSS fallback).
 */
export default function useAutoFontSize(
  containerRef: React.RefObject<HTMLElement | null>,
  text: string,
  options: UseAutoFontSizeOptions = {},
): number | undefined {
  const [fontSize, setFontSize] = useState<number | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const container = containerRef.current;
      if (!container) return;

      const charRatio = getCharWidthRatio();
      const maxChars = longestLineLength(text);
      if (maxChars === 0) return;

      // Get available width: check if CSS grid is active
      const computed = getComputedStyle(container);
      const gridCols = computed.gridTemplateColumns;
      let availableWidth: number;

      if (gridCols && gridCols !== 'none' && gridCols.includes(' ')) {
        // Grid mode: use the narrowest column
        const colWidths = gridCols.split(' ').map(parseFloat).filter(w => !isNaN(w));
        const narrowest = Math.min(...colWidths);
        availableWidth = narrowest - (optionsRef.current.columnOverhead ?? 0);
      } else {
        // Single column: use content width (clientWidth minus padding)
        const paddingLeft = parseFloat(computed.paddingLeft) || 0;
        const paddingRight = parseFloat(computed.paddingRight) || 0;
        availableWidth = container.clientWidth - paddingLeft - paddingRight;
      }

      if (availableWidth <= 0) return;

      const ideal = availableWidth / (maxChars * charRatio);
      const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, ideal));
      // Round to 1 decimal to avoid sub-pixel jitter
      setFontSize(Math.round(clamped * 10) / 10);
    };

    compute();

    const observer = new ResizeObserver(compute);
    observer.observe(el);

    return () => observer.disconnect();
  }, [containerRef, text]);

  return fontSize;
}
