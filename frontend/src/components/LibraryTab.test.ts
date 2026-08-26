import { lyricsPreview, splitContentForColumns, formatBytes } from './LibraryTab';

function makeSongText(sections: number, linesPerSection: number): string {
  const parts: string[] = [];
  for (let s = 1; s <= sections; s++) {
    parts.push(`[Section ${s}]`);
    for (let l = 1; l <= linesPerSection; l++) {
      parts.push(`Line ${l} of section ${s}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

describe('splitContentForColumns', () => {
  it('returns null for numCols=1', () => {
    expect(splitContentForColumns(makeSongText(4, 10), 1)).toBeNull();
  });

  it('returns null when content is too short for requested columns', () => {
    const short = makeSongText(2, 4); // ~12 lines, too short for 2 cols (needs 20)
    expect(splitContentForColumns(short, 2)).toBeNull();
  });

  it('splits into 2 columns at section boundaries', () => {
    const text = makeSongText(4, 8); // 4 sections x ~9 lines each = ~40 lines
    const result = splitContentForColumns(text, 2);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]).toContain('[Section 1]');
    expect(result![1]).toContain(`[Section ${3}`);
  });

  it('splits into 3 columns', () => {
    const text = makeSongText(6, 8); // 6 sections x ~9 lines = ~54 lines
    const result = splitContentForColumns(text, 3);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    // Each column should contain content
    for (const col of result!) {
      expect(col.trim().length).toBeGreaterThan(0);
    }
  });

  it('splits into 4 columns', () => {
    const text = makeSongText(8, 8); // 8 sections x ~9 lines = ~72 lines
    const result = splitContentForColumns(text, 4);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(4);
    for (const col of result!) {
      expect(col.trim().length).toBeGreaterThan(0);
    }
  });

  it('returns null when not enough boundaries for requested columns', () => {
    // Single section with many lines but no internal boundaries
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`);
    expect(splitContentForColumns(lines.join('\n'), 3)).toBeNull();
  });

  it('preserves all content across columns', () => {
    const text = makeSongText(4, 8);
    const result = splitContentForColumns(text, 2);
    expect(result).not.toBeNull();
    const joined = result!.join('\n');
    // Every section header should appear somewhere in the result
    for (let s = 1; s <= 4; s++) {
      expect(joined).toContain(`[Section ${s}]`);
    }
  });
});

describe('lyricsPreview', () => {
  it('returns first two content lines joined by bullet', () => {
    const content = 'First line of lyrics\nSecond line of lyrics\nThird line';
    expect(lyricsPreview(content)).toBe('First line of lyrics \u2022 Second line of lyrics');
  });

  it('skips section headers in brackets', () => {
    const content = '[Verse 1]\nFirst verse line\n[Chorus]\nChorus line';
    expect(lyricsPreview(content)).toBe('First verse line \u2022 Chorus line');
  });

  it('skips blank lines', () => {
    const content = '\n\nActual lyrics\n\nMore lyrics';
    expect(lyricsPreview(content)).toBe('Actual lyrics \u2022 More lyrics');
  });

  it('truncates long previews at 100 chars', () => {
    const longLine = 'A'.repeat(80);
    const content = `${longLine}\n${longLine}`;
    const result = lyricsPreview(content);
    expect(result.length).toBe(101); // 100 chars + ellipsis
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('returns empty string for empty content', () => {
    expect(lyricsPreview('')).toBe('');
  });

  it('handles single line', () => {
    expect(lyricsPreview('Just one line')).toBe('Just one line');
  });
});

describe('formatBytes', () => {
  // Decimal units, matching what a phone's storage screen reports. A tab library
  // is the one place in this app where the number gets large enough to matter.
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1_000, '1 KB'],
    [999_000, '999 KB'],
    [1_200_000, '1.2 MB'],
    [12_400_000, '12.4 MB'],
    [340_000_000, '340 MB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
