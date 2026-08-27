import { describe, it, expect } from 'vitest';
import {
  isChordNoiseToken,
  isChordShaped,
  isNoChordToken,
  unwrapChordToken,
} from './chordToken';
import { CHORD_QUALITIES, NOTE_NAMES, parseChordName } from './theory';

/**
 * The shared chord vocabulary, and the invariant that keeps it shared.
 *
 * Before this module there were three private grammars, and the bug they caused
 * was not that any one of them was wrong: it was that the classifier deciding
 * "this is a chord row" and the parser deciding "this is a chord" disagreed, so
 * rows silently became lyrics. The superset test below is the thing that has to
 * keep passing.
 */

describe('isChordShaped', () => {
  it('accepts the spellings the old grammars each missed', () => {
    // Every one of these was rejected by at least one of the three regexes this
    // module replaced, which is why they are here by name.
    expect(isChordShaped('Cm7b5')).toBe(true); // rejected by followAlign + songMeta
    expect(isChordShaped('C♯m')).toBe(true); // unicode sharp: rejected by followAlign
    expect(isChordShaped('C6/9')).toBe(true); // rejected by followAlign + songMeta
    expect(isChordShaped('Bbb')).toBe(true); // double flat: rejected by songMeta
    expect(isChordShaped('C°')).toBe(true); // rejected by followAlign
    expect(isChordShaped('Cø7')).toBe(true); // rejected by followAlign
    expect(isChordShaped('E♭maj7')).toBe(true); // unicode flat
  });

  it('accepts qualities the dictionary cannot draw', () => {
    // The whole point of the split. A row does not stop being a chord row
    // because it uses a quality outside our 28-entry table; treating it as a
    // lyric is the original bug.
    expect(isChordShaped('Cm11')).toBe(true);
    expect(isChordShaped('Gno3')).toBe(true);
    expect(isChordShaped('F13sus4')).toBe(true);
    expect(parseChordName('Cm11')).toBeNull();
    expect(parseChordName('Gno3')).toBeNull();
  });

  it('accepts slash chords without eating a six-nine', () => {
    expect(isChordShaped('D/F#')).toBe(true);
    expect(isChordShaped('Bb/D')).toBe(true);
    expect(isChordShaped('C6/9')).toBe(true);
  });

  it('tolerates the wrappers charts put around chords', () => {
    expect(isChordShaped('(C)')).toBe(true);
    expect(isChordShaped('[Am]')).toBe(true);
    expect(isChordShaped('G|')).toBe(true);
  });

  it('rejects lyrics that start with a note letter', () => {
    // The reason the tail is a vocabulary and not a character class. Each of
    // these begins with A-G and would pass a `[A-G][A-Za-z]*` test.
    for (const word of [
      'Amazing',
      '␣Cause'.replace('␣', ''),
      'Dance',
      'Every',
      'Fine',
      'Gonna',
      'Baby',
      'Come',
      'Down',
      'Adam',
      'Bass',
      'Chorus',
      'Capo',
      'Fall',
      'Dear',
      'Add',
      'Be',
      'Go',
    ]) {
      expect(isChordShaped(word), `"${word}" should not be chord-shaped`).toBe(false);
    }
  });

  it('rejects a section marker', () => {
    expect(isChordShaped('[Verse 1]')).toBe(false);
    expect(isChordShaped('[Chorus]')).toBe(false);
  });

  it('rejects an empty or non-note token', () => {
    expect(isChordShaped('')).toBe(false);
    expect(isChordShaped('   ')).toBe(false);
    expect(isChordShaped('H7')).toBe(false);
    expect(isChordShaped('am')).toBe(false); // lowercase root: "a" is the article
  });
});

describe('the superset invariant', () => {
  it('accepts every chord the dictionary can draw', () => {
    // If this fails, a chord the panel can render sits on a row the classifier
    // calls a lyric — which is the exact shape of the bug this module fixes.
    const missed: string[] = [];
    for (const note of NOTE_NAMES) {
      for (const quality of CHORD_QUALITIES) {
        const name = note + quality.suffix;
        if (parseChordName(name) !== null && !isChordShaped(name)) missed.push(name);
      }
    }
    expect(missed).toEqual([]);
  });

  it('accepts every alias spelling the parser understands', () => {
    // QUALITY_ALIASES is not exported, so the spellings are listed here. A new
    // alias that this misses shows up as a chord row read as a lyric.
    const aliases = [
      'M', 'maj', 'major', 'min', 'minor', '-', 'dom7', 'M7', 'ma7', 'Δ',
      'min7', '-7', 'sus', '+', '°', '°7', 'ø', 'm7-5', 'min7b5', '69', 'add2',
    ];
    const missed: string[] = [];
    for (const alias of aliases) {
      const name = `C${alias}`;
      expect(parseChordName(name), `${name} should parse`).not.toBeNull();
      if (!isChordShaped(name)) missed.push(name);
    }
    expect(missed).toEqual([]);
  });
});

describe('furniture', () => {
  it('recognises bar lines, repeats and counts', () => {
    for (const token of ['|', '||', ':|', '|:', '%', '-', '---', 'x4', '4x', '/', '//']) {
      expect(isChordNoiseToken(token), `"${token}" should be noise`).toBe(true);
    }
    expect(isChordNoiseToken('C')).toBe(false);
    expect(isChordNoiseToken('Am')).toBe(false);
  });

  it('recognises a no-chord marker in its usual spellings', () => {
    for (const token of ['N.C.', 'NC', 'n.c.', '(N.C.)']) {
      expect(isNoChordToken(token), `"${token}" should be a no-chord marker`).toBe(true);
    }
    expect(isNoChordToken('C')).toBe(false);
  });

  it('unwraps brackets, parens and trailing bar lines', () => {
    expect(unwrapChordToken('(C)')).toBe('C');
    expect(unwrapChordToken('[Am]')).toBe('Am');
    expect(unwrapChordToken('G|')).toBe('G');
    expect(unwrapChordToken('D')).toBe('D');
  });
});
