import {
  longestLineLength,
  solvePerformanceLayout,
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

  it('caps a fixed column preference by what the width can hold', () => {
    // 4 columns cannot hold a 58-char line on a 350px phone.
    const result = solvePerformanceLayout(baseInput({ containerWidth: 350, containerHeight: 660, columnsPref: 4 }));
    expect(result.numCols).toBe(1);
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
