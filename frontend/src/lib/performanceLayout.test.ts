import {
  longestLineLength,
  solvePerformanceLayout,
  packColumnsToHeight,
  FONT_MIN_SINGLE,
  FONT_MIN_MULTI,
  FONT_MAX,
  type SolveInput,
} from './performanceLayout';

describe('longestLineLength', () => {
  it('ignores trailing whitespace so chord padding does not dictate width', () => {
    const text = ['C         G         Am   ', 'A short lyric line'].join('\n');
    // The chord row has lots of trailing spaces; trimmed it is 21 chars.
    expect(longestLineLength(text)).toBe('C         G         Am'.length);
  });

  it('keeps leading whitespace (chord positioning matters)', () => {
    expect(longestLineLength('        G')).toBe(9);
  });

  it('returns 0 for empty text', () => {
    expect(longestLineLength('')).toBe(0);
  });
});

const CHAR_RATIO = 0.6; // typical monospace width / font size

function baseInput(overrides: Partial<SolveInput>): SolveInput {
  return {
    containerWidth: 1664,
    containerHeight: 960,
    charRatio: CHAR_RATIO,
    longestLineLen: 58,
    totalLines: 122,
    maxColsContent: 4,
    columnsPref: 'auto',
    ...overrides,
  };
}

describe('solvePerformanceLayout', () => {
  it('uses a single scrolling column on a narrow phone-sized viewport', () => {
    const result = solvePerformanceLayout(baseInput({ containerWidth: 350, containerHeight: 660 }));
    expect(result.numCols).toBe(1);
    expect(result.fitsOnScreen).toBe(false); // long song must scroll
    expect(result.fontSize).toBeGreaterThanOrEqual(FONT_MIN_SINGLE);
    expect(result.fontSize).toBeLessThanOrEqual(FONT_MAX);
  });

  it('uses multiple columns that fit on screen on a wide laptop viewport', () => {
    const result = solvePerformanceLayout(baseInput({ containerWidth: 1664, containerHeight: 960 }));
    expect(result.numCols).toBeGreaterThan(1);
    expect(result.fitsOnScreen).toBe(true);
    expect(result.fontSize).toBeGreaterThanOrEqual(FONT_MIN_MULTI);
    expect(result.fontSize).toBeLessThanOrEqual(FONT_MAX);
  });

  it('never reports a font below the multi-column floor when it chooses columns', () => {
    const result = solvePerformanceLayout(baseInput({ containerWidth: 1664, containerHeight: 960 }));
    if (result.numCols > 1) {
      expect(result.fontSize).toBeGreaterThanOrEqual(FONT_MIN_MULTI);
    }
  });

  it('honors a fixed column preference on a wide viewport', () => {
    const result = solvePerformanceLayout(baseInput({ columnsPref: 2 }));
    expect(result.numCols).toBe(2);
  });

  it('honors a fixed column preference the width cannot fit at the readable floor', () => {
    // A medium viewport where 3 columns of a 58-char line drop below the 12px
    // multi-column floor. The old solver clamped this back down to fewer
    // columns; now we keep the user's choice and shrink the font to fit.
    const result = solvePerformanceLayout(baseInput({ containerWidth: 900, containerHeight: 960, columnsPref: 3 }));
    expect(result.numCols).toBe(3);
    expect(result.fontSize).toBeGreaterThan(0);
    expect(result.fontSize).toBeLessThanOrEqual(FONT_MAX);
  });

  it('honors a cramped fixed preference by shrinking the font instead of dropping columns', () => {
    // 4 columns of a 58-char line on a 350px phone is tiny but it is what the
    // user explicitly asked for, so we never clip the line off the edge.
    const result = solvePerformanceLayout(baseInput({ containerWidth: 350, containerHeight: 660, columnsPref: 4 }));
    expect(result.numCols).toBe(4);
    expect(result.fontSize).toBeGreaterThan(0);
  });

  it('still caps a fixed column preference by content length', () => {
    const result = solvePerformanceLayout(baseInput({ maxColsContent: 2, columnsPref: 4 }));
    expect(result.numCols).toBe(2);
  });

  it('caps columns by content length', () => {
    const result = solvePerformanceLayout(baseInput({ maxColsContent: 1, columnsPref: 'auto' }));
    expect(result.numCols).toBe(1);
  });

  it('returns a safe fallback for a zero-sized container', () => {
    const result = solvePerformanceLayout(baseInput({ containerWidth: 0, containerHeight: 0 }));
    expect(result.numCols).toBe(1);
    expect(result.fitsOnScreen).toBe(false);
  });
});

/** Build a song of `count` sections, each a `[Section]` header + `body` lines, blank-separated. */
function sectioned(count: number, body: number): string {
  const blocks: string[] = [];
  for (let s = 0; s < count; s++) {
    const lines = [`[Section ${s + 1}]`, ...Array.from({ length: body }, (_, i) => `line ${s}-${i}`)];
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

describe('packColumnsToHeight', () => {
  it('fills non-last columns to the cap and dumps the remainder in the last column', () => {
    // 4 sections of 5 lines (6 with header) → 27 lines incl. blanks.
    const text = sectioned(4, 5);
    const cols = packColumnsToHeight(text, 2, 8)!;
    expect(cols).toHaveLength(2);
    // First column never exceeds the height cap...
    expect(cols[0]!.split('\n').length).toBeLessThanOrEqual(8);
    // ...and the last column holds more than one viewport (the overflow that scrolls).
    expect(cols[1]!.split('\n').length).toBeGreaterThan(8);
  });

  it('breaks at a section boundary so a section is never split across the gap', () => {
    const text = sectioned(4, 5);
    const cols = packColumnsToHeight(text, 2, 8)!;
    // Each column starts on a section header, none ends mid-section.
    expect(cols[0]!.startsWith('[Section 1]')).toBe(true);
    expect(cols[1]!.startsWith('[Section')).toBe(true);
    // The whole content is preserved across the columns (ignoring blank padding).
    const rejoined = cols.join('\n').replace(/\n{2,}/g, '\n');
    expect(rejoined).toContain('[Section 2]');
    expect(rejoined).toContain('line 3-4');
  });

  it('always returns exactly numCols entries', () => {
    const cols = packColumnsToHeight(sectioned(6, 5), 3, 8)!;
    expect(cols).toHaveLength(3);
  });

  it('hard-cuts a single section taller than the viewport', () => {
    // 10 lines, no blanks or headers → no boundary to break on.
    const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const cols = packColumnsToHeight(text, 2, 4)!;
    expect(cols).toHaveLength(2);
    expect(cols[0]!.split('\n')).toHaveLength(4); // hard cut at the cap
  });

  it('returns null when the content already fits in one column', () => {
    expect(packColumnsToHeight(sectioned(2, 3), 2, 100)).toBeNull();
  });

  it('returns null for a single column', () => {
    expect(packColumnsToHeight(sectioned(4, 5), 1, 8)).toBeNull();
  });
});
