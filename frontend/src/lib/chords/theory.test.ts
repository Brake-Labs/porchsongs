import {
  CHORD_QUALITIES,
  ROOT_PITCH_CLASSES,
  chordFullName,
  chordName,
  chordPitchClasses,
  findQuality,
  noteName,
  parseChordName,
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

describe('parseChordName', () => {
  const spell = (name: string) => {
    const chord = parseChordName(name);
    return chord ? chordName(chord) : null;
  };

  it('reads the plain shapes a chart is mostly made of', () => {
    expect(spell('G')).toBe('G');
    expect(spell('Am')).toBe('Am');
    expect(spell('D7')).toBe('D7');
    expect(spell('Cmaj7')).toBe('Cmaj7');
    expect(spell('F#m7')).toBe('F#m7');
    expect(spell('Esus4')).toBe('Esus4');
  });

  it('spells the root the way the dictionary does, whichever way it was written', () => {
    // One chord, one address: a chart writing A# gets the Bb page, because that
    // is the only page for that sound.
    expect(spell('A#m7')).toBe('Bbm7');
    expect(spell('Bbm7')).toBe('Bbm7');
    expect(spell('Gb')).toBe('F#');
  });

  it('tells M from m', () => {
    // findQuality lowercases before it looks up, so an alias has to catch this
    // spelling first or "CM" comes back as C minor.
    expect(spell('CM')).toBe('C');
    expect(spell('Cm')).toBe('Cm');
    expect(spell('CM7')).toBe('Cmaj7');
    expect(spell('Cm7')).toBe('Cm7');
  });

  it('accepts the other spellings players write', () => {
    expect(spell('Cmin')).toBe('Cm');
    expect(spell('C-')).toBe('Cm');
    expect(spell('Cmaj')).toBe('C');
    expect(spell('C+')).toBe('Caug');
    expect(spell('Csus')).toBe('Csus4');
    expect(spell('C\u00b0')).toBe('Cdim');
  });

  it('drops the bass note of a slash chord but keeps the 9 of a 6/9', () => {
    // The dictionary has no way to draw a specified bass, so D/F# is shown as
    // D. The exception is the one quality whose own suffix contains a slash.
    expect(spell('D/F#')).toBe('D');
    expect(spell('G/B')).toBe('G');
    expect(spell('C6/9')).toBe('C6/9');
  });

  it('returns null for text that is not a chord', () => {
    // This is what makes it safe to point at every bracketed token in a chart.
    expect(parseChordName('Verse 1')).toBeNull();
    expect(parseChordName('Chorus')).toBeNull();
    expect(parseChordName('Instrumental')).toBeNull();
    expect(parseChordName('')).toBeNull();
    expect(parseChordName('Gzzz')).toBeNull();
    // A capital B is a chord; the lowercase words around it are not.
    expect(spell('B')).toBe('B');
    expect(parseChordName('a')).toBeNull();
    expect(parseChordName('and')).toBeNull();
  });

  it('is not fooled by a suffix that names something on Object.prototype', () => {
    // The alias table is looked up with a slice of a chart, and a chart is
    // arbitrary text. An object literal answers "toString" with a function,
    // which findQuality would then call .toLowerCase() on, throwing during the
    // render of the play route rather than returning null.
    for (const word of ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(parseChordName(`G${word}`)).toBeNull();
    }
  });
});
