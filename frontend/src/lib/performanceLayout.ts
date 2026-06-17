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
 * Pack lines into `numCols` columns where every column but the last holds at
 * most `maxLines` lines, so each fills the viewport height without spilling a
 * line below the fold. Breaks at a section boundary (blank line or `[Section]`
 * header) at or before the cap so a verse is never cut across the gap, falling
 * back to a hard cut only when a single section is taller than the viewport.
 * The last column takes the remainder and is the only column allowed to scroll.
 *
 * This is the overflow counterpart to splitContentForColumns: use the balanced
 * split when the song fits on screen, and this when it doesn't, so columns stay
 * a top-to-bottom reading order instead of forcing a scroll down every column.
 *
 * Returns null when the content fits within a single column (`maxLines`), i.e.
 * there is nothing to pack.
 */
export function packColumnsToHeight(text: string, numCols: number, maxLines: number): string[] | null {
  if (numCols <= 1 || maxLines < 1) return null;

  const lines = text.split('\n');
  if (lines.length <= maxLines) return null;

  const isSectionHeader = (i: number): boolean => /^\[.+\]$/.test(lines[i]?.trim() ?? '');
  const isBoundary = (i: number): boolean => (lines[i]?.trim() ?? '') === '' || isSectionHeader(i);

  const columns: string[] = [];
  let start = 0;

  for (let col = 0; col < numCols - 1; col++) {
    if (start >= lines.length) {
      columns.push('');
      continue;
    }
    const hardEnd = Math.min(start + maxLines, lines.length);
    // Break at the highest section boundary at or before the height cap to fill
    // the column as much as fits. Breaking at the boundary index itself keeps a
    // section header (and any blank line) at the top of the next column, where
    // the leading blank is trimmed off; this never overshoots the cap.
    let end = -1;
    for (let i = hardEnd; i > start; i--) {
      if (isBoundary(i)) {
        end = i;
        break;
      }
    }
    if (end === -1) end = hardEnd; // single section taller than the viewport

    columns.push(lines.slice(start, end).join('\n').replace(/\n+$/, ''));
    start = end;
  }

  columns.push(start < lines.length ? lines.slice(start).join('\n').replace(/^\n+/, '') : '');
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
 *
 * `honorExplicit` is set when the user picked this column count by hand. In that
 * mode we never reject the count for being "too narrow": we size the font to fit
 * the column width so the longest line is not clipped (multi-column can't scroll
 * sideways), dropping below the readability floor only when the width genuinely
 * cannot hold the line at the floor. In auto mode the floor is hard, so a
 * cramped multi-column candidate is simply marked as not fitting and skipped.
 */
function evaluate(numCols: number, input: SolveInput, honorExplicit = false): Candidate {
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

  const fitFont = Math.min(widthFont, heightFont);

  if (honorExplicit) {
    // Prefer the readable floor, but never let it exceed what the width can
    // hold or the longest line would clip. Height overflow just scrolls.
    const floor = Math.min(FONT_MIN_MULTI, widthFont);
    const fontSize = clamp(fitFont, floor, FONT_MAX);
    return { numCols, fontSize, fitsOnScreen: fontSize <= fitFont + 0.05 };
  }

  // Auto multi-column must fit both width and height to be worthwhile.
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
 * column sized to the available width. A fixed `columnsPref` is honored as long
 * as the content is long enough to split into that many columns; the font
 * shrinks to whatever fits the resulting column width, even below the
 * readability floor, rather than silently dropping columns the screen can't fit.
 */
export function solvePerformanceLayout(input: SolveInput): SolveResult {
  if (input.containerWidth <= 0 || input.containerHeight <= 0) {
    return { numCols: 1, fontSize: FONT_MIN_SINGLE, fitsOnScreen: false };
  }

  const contentCap = Math.max(1, input.maxColsContent);

  if (input.columnsPref !== 'auto') {
    // Honor the user's choice, capped only by what the content length supports.
    // Width no longer vetoes the column count; the font drops to fit instead.
    const numCols = clamp(Math.round(input.columnsPref), 1, contentCap);
    return evaluate(numCols, input, true);
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
