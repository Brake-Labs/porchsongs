import {
  CHORD_QUALITIES,
  ROOT_PITCH_CLASSES,
  chordFullName,
  chordName,
  chordPitchClasses,
  findQuality,
  noteName,
  parseNote,
  roleByPitchClass,
} from './theory';

describe('note names', () => {
  it('gives each pitch class the one spelling players write', () => {
    // Not uniformly sharp: Bb and Eb, but F#. One name per sound keeps a
    // chord's page, its URL, and its server-rendered title in agreement.
    expect(noteName(10)).toBe('Bb');
    expect(noteName(3)).toBe('Eb');
    expect(noteName(8)).toBe('Ab');
    expect(noteName(1)).toBe('C#');
    expect(noteName(6)).toBe('F#');
    expect(noteName(0)).toBe('C');
  });

  it('wraps out-of-range pitch classes instead of returning undefined', () => {
    expect(noteName(12)).toBe('C');
    expect(noteName(-1)).toBe('B');
  });
});

describe('parseNote', () => {
  it('reads naturals, sharps, and flats in either case', () => {
    expect(parseNote('C')).toBe(0);
    expect(parseNote('f#')).toBe(6);
    expect(parseNote('Bb')).toBe(10);
    expect(parseNote(' eb ')).toBe(3);
  });

  it('handles the enharmonics at the edges of the octave', () => {
    expect(parseNote('Cb')).toBe(11);
    expect(parseNote('B#')).toBe(0);
  });

  it('accepts the typographic accidentals as well as ASCII', () => {
    expect(parseNote('F♯')).toBe(parseNote('F#'));
    expect(parseNote('B♭')).toBe(parseNote('Bb'));
  });

  it('rejects anything that is not a note', () => {
    expect(parseNote('H')).toBeNull();
    expect(parseNote('')).toBeNull();
    expect(parseNote('Cmaj7')).toBeNull();
  });

  it('round-trips every name it generates', () => {
    for (const pc of ROOT_PITCH_CLASSES) {
      expect(parseNote(noteName(pc))).toBe(pc);
    }
  });

  it('still reads the spelling we do not display', () => {
    // Someone searching for "A#m7" should land on the Bbm7 page, not a 404.
    expect(parseNote('A#')).toBe(10);
    expect(parseNote('Db')).toBe(1);
  });
});

describe('chord qualities', () => {
  it('has a unique suffix per quality, so lookup is unambiguous', () => {
    const suffixes = CHORD_QUALITIES.map(q => q.suffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it('finds a quality by its suffix, case-insensitively', () => {
    expect(findQuality('m7')!.label).toBe('minor 7th');
    expect(findQuality('MAJ7')!.suffix).toBe('maj7');
    expect(findQuality('')!.label).toBe('major');
    expect(findQuality('nonsense')).toBeNull();
  });

  it('always states a root, and never makes it optional', () => {
    // A shape labelled G7 with no G in it is a lookup result nobody can use.
    for (const quality of CHORD_QUALITIES) {
      const root = quality.tones.filter(t => t.role === 'root');
      expect(root, quality.suffix).toHaveLength(1);
      expect(root[0]!.interval, quality.suffix).toBe(0);
      expect(root[0]!.optional, quality.suffix).toBe(false);
    }
  });

  it('never marks the note that names the chord as droppable', () => {
    // The third and the seventh are what make a chord minor or dominant. Only
    // the fifth and some extensions can go.
    for (const quality of CHORD_QUALITIES) {
      for (const tone of quality.tones) {
        if (!tone.optional) continue;
        expect(['fifth', 'third', 'extension'], `${quality.suffix} ${tone.role}`).toContain(tone.role);
        expect(tone.role, `${quality.suffix} seventh must not be optional`).not.toBe('seventh');
      }
    }
  });

  it('gives the qualities in the compact picker a sensible size', () => {
    const common = CHORD_QUALITIES.filter(q => q.common);
    expect(common.length).toBeGreaterThan(10);
    expect(common.length).toBeLessThan(20);
    // The ones nobody would forgive us for leaving out.
    for (const suffix of ['', 'm', '7', 'm7', 'maj7', 'sus4', 'sus2']) {
      expect(common.map(q => q.suffix)).toContain(suffix);
    }
  });

  it('builds each quality from distinct intervals', () => {
    for (const quality of CHORD_QUALITIES) {
      const intervals = quality.tones.map(t => t.interval);
      expect(new Set(intervals).size, quality.suffix).toBe(intervals.length);
    }
  });
});

describe('chord names', () => {
  it('writes the root followed by the suffix', () => {
    expect(chordName({ root: 10, quality: findQuality('m7')! })).toBe('Bbm7');
    expect(chordName({ root: 7, quality: findQuality('')! })).toBe('G');
    expect(chordName({ root: 1, quality: findQuality('maj7')! })).toBe('C#maj7');
  });

  it('spells a name out for screen readers and meta descriptions', () => {
    expect(chordFullName({ root: 10, quality: findQuality('m7')! })).toBe('B flat minor 7th');
    expect(chordFullName({ root: 6, quality: findQuality('')! })).toBe('F sharp major');
    expect(chordFullName({ root: 0, quality: findQuality('')! })).toBe('C major');
  });
});

describe('chord tones', () => {
  it('lists the pitch classes a chord contains', () => {
    // C major: C E G.
    expect([...chordPitchClasses({ root: 0, quality: findQuality('')! })].sort((a, b) => a - b)).toEqual([0, 4, 7]);
    // G7: G B D F.
    expect([...chordPitchClasses({ root: 7, quality: findQuality('7')! })].sort((a, b) => a - b)).toEqual([2, 5, 7, 11]);
  });

  it('maps each pitch class back to the role it plays', () => {
    const roles = roleByPitchClass({ root: 0, quality: findQuality('m7')! });
    expect(roles.get(0)).toBe('root');
    expect(roles.get(3)).toBe('third');
    expect(roles.get(7)).toBe('fifth');
    expect(roles.get(10)).toBe('seventh');
  });

  it('keeps the first role when two intervals land on one pitch class', () => {
    // dim7 spells its seventh as a major sixth, so 9 semitones is reachable as
    // both. Root-first ordering makes the answer deterministic.
    const roles = roleByPitchClass({ root: 0, quality: findQuality('dim7')! });
    expect(roles.get(9)).toBe('seventh');
    expect(roles.size).toBe(4);
  });
});
