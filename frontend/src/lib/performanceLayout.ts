/**
 * Pure layout logic for the performance (play-along) view.
 *
 * The product rule, in one sentence: pick the largest readable monospace font
 * that fits the chart on screen, using multiple columns only when they let you
 * see the whole song at once. Otherwise fall back to a single column you scroll
 * vertically. We never scroll horizontally; that loses the chord/lyric alignment
 * that is the entire point of the chart.
 */

export const MIN_LINES_PER_COLUMN = 10;

/** Largest font we ever render at. */
export const FONT_MAX = 18;
/** Floor for a single scrolling column (lyrics stay legible this small). */
export const FONT_MIN_SINGLE = 10;
/** Floor for a multi-column layout. Below this, columns aren't worth it. */
export const FONT_MIN_MULTI = 12;

/** Horizontal gap between columns, in px (matches the `gap-4` grid class). */
const COLUMN_GAP = 16;
/** Per-divider overhead: right border + right padding on non-last columns. */
const COLUMN_DIVIDER = 13;
/** Line-box height as a multiple of font size (matches Tailwind `leading-snug`). */
export const LINE_HEIGHT_RATIO = 1.375;

/**
 * Split lyrics into N balanced columns at section boundaries.
 * Returns null if the content is too short to split.
 */
export function splitContentForColumns(text: string, numCols: number): string[] | null {
  if (numCols <= 1) return null;

  const lines = text.split('\n');
  if (lines.length < MIN_LINES_PER_COLUMN * numCols) return null;

  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '' || /^\[.+\]$/.test(trimmed)) {
      boundaries.push(i);
    }
  }

  if (boundaries.length < numCols - 1) return null;

  // Find numCols-1 split points that divide content most evenly
  const targetSize = lines.length / numCols;
  const splitPoints: number[] = [];

  for (let col = 1; col < numCols; col++) {
    const target = targetSize * col;
    const minLine = splitPoints.length > 0 ? splitPoints[splitPoints.length - 1]! + MIN_LINES_PER_COLUMN : lines.length * 0.1;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const idx of boundaries) {
      if (idx <= minLine) continue;
      if (idx >= lines.length - MIN_LINES_PER_COLUMN) continue;
      const dist = Math.abs(idx - target);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }
    if (bestIdx === -1) return null;

    const isSectionHeader = /^\[.+\]$/.test(lines[bestIdx]!.trim());
    splitPoints.push(isSectionHeader ? bestIdx : bestIdx + 1);
  }

  const columns: string[] = [];
  let start = 0;
  for (const sp of splitPoints) {
    columns.push(lines.slice(start, sp).join('\n').replace(/\n+$/, ''));
    start = sp;
  }
  columns.push(lines.slice(start).join('\n').replace(/^\n+/, ''));

  return columns;
}

/**
 * Determine the max column count the content can support (by length).
 */
export function maxColumnsForContent(text: string): number {
  const lineCount = text.split('\n').length;
  if (lineCount >= MIN_LINES_PER_COLUMN * 4) return 4;
  if (lineCount >= MIN_LINES_PER_COLUMN * 3) return 3;
  if (lineCount >= MIN_LINES_PER_COLUMN * 2) return 2;
  return 1;
}

/** Length of the longest line, ignoring trailing whitespace. */
export function longestLineLength(text: string): number {
  let max = 0;
  for (const line of text.split('\n')) {
    // Trailing spaces on chord rows shouldn't dictate the font size.
    const len = line.replace(/\s+$/, '').length;
    if (len > max) max = len;
  }
  return max;
}

/** Usable content width of one column, given a container width and column count. */
function columnContentWidth(containerWidth: number, numCols: number): number {
  const raw = (containerWidth - COLUMN_GAP * (numCols - 1)) / numCols;
  return raw - (numCols > 1 ? COLUMN_DIVIDER : 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface SolveInput {
  containerWidth: number;
  containerHeight: number;
  /** Monospace character width as a multiple of font size. */
  charRatio: number;
  /** Longest line length (trailing whitespace trimmed). */
  longestLineLen: number;
  /** Total line count of the song. */
  totalLines: number;
  /** Max columns the content length supports (from maxColumnsForContent). */
  maxColsContent: number;
  /** User preference: a fixed column count, or 'auto'. */
  columnsPref: number | 'auto';
}

export interface SolveResult {
  numCols: number;
  fontSize: number;
  /** True when the layout fits on screen without vertical scrolling. */
  fitsOnScreen: boolean;
}

interface Candidate {
  numCols: number;
  fontSize: number;
  fitsOnScreen: boolean;
}

/**
 * Evaluate a single column count: the font that fits its width, and (for
 * multi-column) its height, plus whether the whole song fits on screen.
 */
function evaluate(numCols: number, input: SolveInput): Candidate {
  const { containerWidth, containerHeight, charRatio, longestLineLen, totalLines } = input;
  const charsPerLine = Math.max(1, longestLineLen);

  const colWidth = columnContentWidth(containerWidth, numCols);
  const widthFont = colWidth / (charsPerLine * charRatio);

  const colLines = Math.ceil(totalLines / numCols);
  const heightFont = containerHeight / (colLines * LINE_HEIGHT_RATIO);

  if (numCols === 1) {
    // Single column scrolls vertically: only width constrains the font.
    const fontSize = clamp(widthFont, FONT_MIN_SINGLE, FONT_MAX);
    return { numCols, fontSize, fitsOnScreen: heightFont >= fontSize };
  }

  // Multi-column must fit both width and height to be worthwhile.
  const fitFont = Math.min(widthFont, heightFont);
  return {
    numCols,
    fontSize: clamp(fitFont, FONT_MIN_MULTI, FONT_MAX),
    fitsOnScreen: fitFont >= FONT_MIN_MULTI,
  };
}

/** Largest column count whose column can still hold the longest line at the floor font. */
function maxColumnsByWidth(input: SolveInput, cap: number): number {
  const { containerWidth, charRatio, longestLineLen } = input;
  const needed = Math.max(1, longestLineLen) * charRatio * FONT_MIN_MULTI;
  let best = 1;
  for (let c = 2; c <= cap; c++) {
    if (columnContentWidth(containerWidth, c) >= needed) best = c;
    else break;
  }
  return best;
}

/**
 * Solve the performance layout: how many columns and what font size.
 *
 * Auto mode prefers the on-screen layout with the largest font; if nothing fits
 * on screen (long song / narrow viewport) it falls back to a single scrolling
 * column sized to the available width. A fixed `columnsPref` is honored (capped
 * by what the width and content length allow) even if it has to scroll.
 */
export function solvePerformanceLayout(input: SolveInput): SolveResult {
  if (input.containerWidth <= 0 || input.containerHeight <= 0) {
    return { numCols: 1, fontSize: FONT_MIN_SINGLE, fitsOnScreen: false };
  }

  const contentCap = Math.max(1, input.maxColsContent);

  if (input.columnsPref !== 'auto') {
    const widthCap = maxColumnsByWidth(input, contentCap);
    const numCols = clamp(Math.round(input.columnsPref), 1, Math.min(contentCap, Math.max(1, widthCap)));
    return evaluate(numCols, input);
  }

  const widthCap = Math.min(contentCap, maxColumnsByWidth(input, contentCap));

  const single = evaluate(1, input);
  let best: Candidate = single;

  for (let c = 2; c <= widthCap; c++) {
    const cand = evaluate(c, input);
    if (!cand.fitsOnScreen) continue;
    // Prefer layouts that fit on screen; among those, the largest font wins,
    // with fewer columns breaking ties (simpler to read).
    const bestFits = best.fitsOnScreen;
    if (!bestFits || cand.fontSize > best.fontSize + 0.05) {
      best = cand;
    }
  }

  return best;
}
