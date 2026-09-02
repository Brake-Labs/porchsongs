import { describe, it, expect } from 'vitest';
import { transposeChart, transposeChordToken } from './transpose';
import { normalizeSong } from '@/lib/followAlign';

/**
 * The contract under test, in order of how expensive it would be to break:
 *
 * 1. transposeChart never changes what a line *is*. Follow mode, the layout
 *    solver, and the column splitter all consume transposed text with no idea a
 *    transposition happened, and that only works if normalizeSong reads the
 *    transposed chart identically.
 * 2. Every chord-shaped token moves, including the ones the dictionary cannot
 *    draw and the slash basses parseChordName drops.
 * 3. Columns hold. Chords sit above their syllables by column, and a rename
 *    that changes width must not scramble the row.
 */

describe('transposeChordToken', () => {
  it('moves a plain chord', () => {
    expect(transposeChordToken('C', 2)).toBe('D');
    expect(transposeChordToken('Am', 2)).toBe('Bm');
    expect(transposeChordToken('G7', -2)).toBe('F7');
  });

  it('spells the result from NOTE_NAMES, whatever spelling came in', () => {
    // One spelling per pitch class: Bb not A#, F# not Gb. See theory.ts.
    expect(transposeChordToken('A#', 1)).toBe('B');
    expect(transposeChordToken('Gb', 0 + 1)).toBe('G');
    expect(transposeChordToken('C', 10)).toBe('Bb');
    expect(transposeChordToken('C', 6)).toBe('F#');
  });

  it('moves the slash bass with the chord', () => {
    // parseChordName drops the bass ("D/F# is a D"); a transposer cannot.
    // The bass takes the NOTE_NAMES spelling like every other note, so this is
    // E/Ab rather than the E/G# a copyist would write: one spelling per pitch
    // class everywhere beats a private enharmonic table for one token.
    expect(transposeChordToken('D/F#', 2)).toBe('E/Ab');
    expect(transposeChordToken('C/E', -1)).toBe('B/Eb');
  });

  it('does not mistake 6/9 for a slash bass', () => {
    expect(transposeChordToken('C6/9', 2)).toBe('D6/9');
  });

  it('keeps a quality the dictionary cannot draw', () => {
    // A row transposed except for its one Cm11 is musical nonsense, which is
    // why this does not round-trip through parseChordName.
    expect(transposeChordToken('Cm11', 1)).toBe('C#m11');
    expect(transposeChordToken('Cno3', 2)).toBe('Dno3');
  });

  it('keeps the wrapper a chart put around the chord', () => {
    expect(transposeChordToken('[C]', 2)).toBe('[D]');
    expect(transposeChordToken('(Am)', 2)).toBe('(Bm)');
    expect(transposeChordToken('C|', 2)).toBe('D|');
  });

  it('reads unicode accidentals', () => {
    expect(transposeChordToken('C♯m', 1)).toBe('Dm');
    expect(transposeChordToken('E♭maj7', 2)).toBe('Fmaj7');
  });

  it('answers null for anything that is not a chord', () => {
    expect(transposeChordToken('Amazing', 2)).toBeNull();
    expect(transposeChordToken('N.C.', 2)).toBeNull();
    expect(transposeChordToken('|', 2)).toBeNull();
    expect(transposeChordToken('x2', 2)).toBeNull();
    expect(transposeChordToken('[Verse', 2)).toBeNull();
  });
});

describe('transposeChart', () => {
  it('moves a chord row and leaves the lyric under it alone', () => {
    const chart = 'C       G       Am\nAmazing grace how sweet';
    expect(transposeChart(chart, 2)).toBe('D       A       Bm\nAmazing grace how sweet');
  });

  it('holds each chord to its column when widths change', () => {
    // Bb shrinks to A; the Eb above "grace" stays above "grace".
    const chart = 'Bb      Eb\nAmazing grace';
    expect(transposeChart(chart, -1)).toBe('A       D\nAmazing grace');
  });

  it('pushes right rather than fusing when a chord grows into the gap', () => {
    const out = transposeChart('C C C\nla la la', 1);
    expect(out.split('\n')[0]).toBe('C# C# C#');
  });

  it('rewrites inline bracketed chords and leaves section markers alone', () => {
    const chart = '[Verse 1]\n[C]Down by the [G7]river';
    expect(transposeChart(chart, 2)).toBe('[Verse 1]\n[D]Down by the [A7]river');
  });

  it('moves the chords-used legend and the declared key', () => {
    const chart = 'Key: G\nChords used: C G Am\n\n[Verse]\nla la';
    const out = transposeChart(chart, 2);
    expect(out.split('\n')[0]).toBe('Key: A');
    expect(out.split('\n')[1]).toBe('Chords used: D A Bm');
  });

  it('leaves a name-plus-fingering legend row entirely alone', () => {
    // Transposing the name would caption the old shape with a chord it does
    // not play. The shape cannot move, so the line does not either.
    const chart = 'G - 320003\nC - x32010';
    expect(transposeChart(chart, 2)).toBe(chart);
  });

  it('passes bar lines and N.C. through a chord row', () => {
    const chart = '| C | N.C. | G |\nsing it now anyway';
    expect(transposeChart(chart, 2)).toBe('| D | N.C. | A |\nsing it now anyway');
  });

  it('never touches a lyric line without brackets', () => {
    // "A long time ago" opens with a note letter and must not move.
    const chart = 'C       G\nA long time ago';
    expect(transposeChart(chart, 2).split('\n')[1]).toBe('A long time ago');
  });

  it('returns the text unchanged for a whole number of octaves', () => {
    // Including the spelling: stepping +12 must not respell the author's A#.
    const chart = 'A#      D#\nAmazing grace';
    expect(transposeChart(chart, 0)).toBe(chart);
    expect(transposeChart(chart, 12)).toBe(chart);
    expect(transposeChart(chart, -12)).toBe(chart);
  });

  it('round-trips a canonically spelled chart exactly', () => {
    const chart = 'Bb      F#m     Eb/G\nAmazing grace how sweet\n\n[Chorus]\n[C#m]the sound';
    expect(transposeChart(transposeChart(chart, 5), -5)).toBe(chart);
  });

  it('is invisible to normalizeSong', () => {
    const chart = [
      'Key: G',
      'Chords used: C G Am',
      '',
      '[Verse 1]',
      'C       G',
      'Amazing grace how sweet the sound',
      'Am      F',
      'that saved a wretch like me',
      '| C | N.C. |',
    ].join('\n');
    const before = normalizeSong(chart);
    const after = normalizeSong(transposeChart(chart, 3));
    expect(after.lineKind).toEqual(before.lineKind);
    expect(after.lyricStates).toEqual(before.lyricStates);
  });
});

