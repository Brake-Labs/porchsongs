import { INSTRUMENTS, findInstrument, findTuning, withCapo } from './instruments';
import { assignFingers, generateVoicings, voicingToString } from './voicing';
import type { Voicing } from './voicing';
import { CHORD_QUALITIES, ROOT_PITCH_CLASSES, chordName, findQuality, parseNote } from './theory';
import type { Chord } from './theory';

function chordFor(name: string): Chord {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  if (!m) throw new Error(`bad chord name in test: ${name}`);
  const root = parseNote(m[1]!);
  const quality = findQuality(m[2]!);
  if (root === null || !quality) throw new Error(`bad chord name in test: ${name}`);
  return { root, quality };
}

function voicings(instrument: string, tuning: string, name: string, limit = 8): Voicing[] {
  const inst = findInstrument(instrument)!;
  return generateVoicings(inst, findTuning(inst, tuning)!, chordFor(name), { limit });
}

/**
 * Every instrument, tuning, root, and quality the app can ask for.
 *
 * The invariant tests below run over all of it (a few thousand chords) rather
 * than a sample, because the failures that matter are the ones that only show up
 * for one odd combination: a banjo drone fretted below its anchor, a barre laid
 * across an open string.
 */
interface ChordCase {
  label: string;
  voicings: Voicing[];
  instrument: string;
  tuning: string;
  common: boolean;
}

function everyChord(): ChordCase[] {
  const out: ChordCase[] = [];
  for (const inst of INSTRUMENTS) {
    for (const tuning of inst.tunings) {
      for (const root of ROOT_PITCH_CLASSES) {
        for (const quality of CHORD_QUALITIES) {
          out.push({
            label: `${inst.slug}/${tuning.slug} ${chordName({ root, quality })}`,
            voicings: generateVoicings(inst, tuning, { root, quality }),
            instrument: inst.slug,
            tuning: tuning.slug,
            common: quality.common,
          });
        }
      }
    }
  }
  return out;
}

const ALL = everyChord();

describe('generated shapes are valid chords', () => {
  it('never sounds a note outside the chord', () => {
    const bad: string[] = [];
    for (const inst of INSTRUMENTS) {
      for (const tuning of inst.tunings) {
        for (const root of ROOT_PITCH_CLASSES) {
          for (const quality of CHORD_QUALITIES) {
            const allowed = new Set(quality.tones.map(t => (root + t.interval) % 12));
            for (const v of generateVoicings(inst, tuning, { root, quality })) {
              for (const note of v.notes) {
                if (!allowed.has(note % 12)) {
                  bad.push(`${inst.slug}/${tuning.slug} ${root}${quality.suffix}: ${voicingToString(v)}`);
                }
              }
            }
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('always contains every tone the chord requires', () => {
    const bad: string[] = [];
    for (const inst of INSTRUMENTS) {
      for (const tuning of inst.tunings) {
        for (const root of ROOT_PITCH_CLASSES) {
          for (const quality of CHORD_QUALITIES) {
            const required = quality.tones.filter(t => !t.optional).map(t => (root + t.interval) % 12);
            for (const v of generateVoicings(inst, tuning, { root, quality })) {
              const present = new Set(v.notes.map(n => n % 12));
              if (!required.every(pc => present.has(pc))) {
                bad.push(`${inst.slug}/${tuning.slug} ${root}${quality.suffix}: ${voicingToString(v)}`);
              }
            }
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('finds a shape for every chord in the common picker', () => {
    const empty = ALL.filter(c => c.voicings.length === 0 && c.common).map(c => c.label);
    expect(empty).toEqual([]);
  });

  it('comes up empty only where the chord genuinely will not fit', () => {
    // A five-note chord on four strings needs four of its tones on four separate
    // strings inside one four-fret window, and for these it cannot be done. The
    // page says so rather than inventing a shape, and this pins the list so that
    // a scoring change which silently drops working chords is visible.
    const empty = ALL.filter(c => c.voicings.length === 0).map(c => c.label);
    expect(empty).toEqual([
      'ukulele/standard F#maj9',
      'ukulele/standard Abm9',
      'ukulele/low-g F#maj9',
      'ukulele/low-g Abm9',
      'ukulele/baritone C#maj9',
      'ukulele/baritone Ebm9',
      'mandolin/standard F7b9',
    ]);
  });
});

describe('generated shapes are playable', () => {
  it('never needs a fifth finger', () => {
    const bad: string[] = [];
    for (const { label, voicings: vs } of ALL) {
      for (const v of vs) {
        const used = new Set(v.fingers.filter((f): f is number => f !== null));
        if (used.size > 4) bad.push(`${label}: ${voicingToString(v)}`);
        if (assignFingers(v.frets).count > 4) bad.push(`${label}: ${voicingToString(v)} (count)`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('never lays a barre across an open string', () => {
    // The bug this pins: guitar F came out as 103211, an F barred at the first
    // fret with the A string ringing open *inside* the barre. A flat finger
    // frets everything it covers, so that shape cannot be made by a hand.
    const bad: string[] = [];
    for (const { label, voicings: vs } of ALL) {
      for (const v of vs) {
        if (!v.barre) continue;
        for (let i = v.barre.fromString; i <= v.barre.toString; i++) {
          if (v.frets[i] === 0) bad.push(`${label}: ${voicingToString(v)} barre@${v.barre.fret}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('never asks the hand to span more frets than the neck allows', () => {
    const bad: string[] = [];
    for (const { label, voicings: vs, instrument } of ALL) {
      const maxSpan = findInstrument(instrument)!.maxSpan;
      for (const v of vs) {
        const fretted = v.frets.filter((f): f is number => f !== null && f > 0);
        if (!fretted.length) continue;
        const span = Math.max(...fretted) - Math.min(...fretted) + 1;
        if (span > maxSpan) bad.push(`${label}: ${voicingToString(v)} spans ${span}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('never frets the banjo drone below the fifth fret', () => {
    // There is no neck under the 5th string below its anchor. An enumerator that
    // treats it as an ordinary string produces shapes with a note that does not
    // physically exist.
    const banjo = findInstrument('banjo')!;
    const tuning = banjo.tunings[0]!;
    const anchor = tuning.strings[0]!.shortFrom!;
    const bad: string[] = [];
    for (const root of ROOT_PITCH_CLASSES) {
      for (const quality of CHORD_QUALITIES) {
        for (const v of generateVoicings(banjo, tuning, { root, quality })) {
          const fret = v.frets[0];
          if (fret !== null && fret !== undefined && fret > 0 && fret < anchor) {
            bad.push(`${root}${quality.suffix}: ${voicingToString(v)}`);
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('assigns a finger to every fretted string and none to open or muted ones', () => {
    const bad: string[] = [];
    for (const { label, voicings: vs } of ALL) {
      for (const v of vs) {
        v.frets.forEach((f, i) => {
          const finger = v.fingers[i];
          if (f !== null && f > 0 && finger === null) bad.push(`${label}: ${voicingToString(v)} string ${i} unfingered`);
          if ((f === null || f === 0) && finger !== null) bad.push(`${label}: ${voicingToString(v)} string ${i} over-fingered`);
        });
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('assignFingers', () => {
  it('fingers an open chord with no barre', () => {
    const { barre, count } = assignFingers([null, 0, 2, 2, 1, 0]); // guitar Am
    expect(barre).toBeNull();
    expect(count).toBe(3);
  });

  it('barres only when the shape cannot be fingered without one', () => {
    // Guitar D. Barring the 2nd fret is possible, and counting it as one finger
    // made an easy open chord outrank real ones. Nobody teaches D as a barre.
    expect(assignFingers([null, null, 0, 2, 3, 2]).barre).toBeNull();
    // Guitar F needs six fingers without a barre, so it gets one.
    const f = assignFingers([1, 3, 3, 2, 1, 1]);
    expect(f.barre).toEqual({ fret: 1, fromString: 0, toString: 5, finger: 1 });
    expect(f.count).toBe(4);
  });

  it('refuses a barre that would cover an open string', () => {
    // 103211: an F shape with the A string open inside the barre.
    expect(assignFingers([1, 0, 3, 2, 1, 1]).barre).toBeNull();
  });
});

/**
 * The shapes every player of these instruments already knows.
 *
 * This is the ranking test. The invariants above prove a shape is possible; only
 * this proves the *first* shape shown is the one someone opening a chord
 * dictionary is looking for. Hand-checked against standard chord books rather
 * than generated, so a scoring change that quietly reorders results fails here.
 */
const CANONICAL: Record<string, Record<string, string>> = {
  'guitar/standard': {
    C: 'x32010', A: 'x02220', G: '320003', E: '022100', D: 'xx0232',
    Am: 'x02210', Em: '022000', Dm: 'xx0231', F: '133211',
    G7: '320001', E7: '020100', A7: 'x02020', D7: 'xx0212', B7: 'x21202',
    Cmaj7: 'x32000', Am7: 'x02010', Em7: '020000', Dsus4: 'xx0233', Asus2: 'x02200',
  },
  'ukulele/standard': {
    C: '0003', G: '0232', F: '2010', Am: '2000', D: '2220',
    // 0432 is the shape most charts print; 0402 is the same chord one finger
    // cheaper, and comes back second. Either is a correct Em.
    Em: '0402',
    A: '2100', Dm: '2210', E: '1402', G7: '0212', C7: '0001', A7: '0100',
    Cmaj7: '0002', Am7: '0000', F7: '2313',
  },
  // Baritone is tuned like a guitar's top four strings, so its shapes are the
  // guitar ones with the bass strings gone: guitar C (x32010) becomes 2010.
  'ukulele/baritone': {
    G: '0003', C: '2010', D: '0232', Em: '2000', Am: '2210', D7: '0212', A: '2220', E: '2100',
  },
  'mandolin/standard': {
    G: '0023', A: '2240', Am: '2230', D7: '2032', C: '0230', D: '2002',
  },
  'banjo/open-g': {
    G: '00000', C: '02012', D: 'x0234', D7: 'x0214', Em: '02002', Am: 'x2212',
  },
};

describe('canonical shapes come first', () => {
  for (const [key, chords] of Object.entries(CANONICAL)) {
    const [instrument, tuning] = key.split('/') as [string, string];
    describe(key, () => {
      for (const [name, expected] of Object.entries(chords)) {
        it(`${name} is ${expected}`, () => {
          const vs = voicings(instrument, tuning, name);
          expect(vs.length).toBeGreaterThan(0);
          expect(voicingToString(vs[0]!)).toBe(expected);
        });
      }
    });
  }
});

describe('capo', () => {
  it('gives the shape of the chord that many semitones lower', () => {
    // A G chord with a capo on 2 is fingered like an F: the frets are the F
    // shape's, read from the capo instead of the nut.
    const guitar = findInstrument('guitar')!;
    const standard = findTuning(guitar, 'standard')!;
    const capoed = generateVoicings(guitar, withCapo(standard, 2), chordFor('A'));
    const openG = generateVoicings(guitar, standard, chordFor('G'));
    expect(voicingToString(capoed[0]!)).toBe(voicingToString(openG[0]!));
  });

  it('leaves shapes unchanged at capo 0', () => {
    const guitar = findInstrument('guitar')!;
    const standard = findTuning(guitar, 'standard')!;
    expect(withCapo(standard, 0)).toBe(standard);
  });

  it('keeps the banjo drone anchored relative to the capo', () => {
    const banjo = findInstrument('banjo')!;
    const capoed = withCapo(banjo.tunings[0]!, 2);
    expect(capoed.strings[0]!.shortFrom).toBe(3);
    expect(capoed.strings[0]!.midi).toBe(banjo.tunings[0]!.strings[0]!.midi + 2);
  });
});

describe('performance', () => {
  it('generates a chord fast enough to run during a render', () => {
    // The page regenerates on every instrument, tuning, capo, or chord change,
    // and does it on phones. The enumerator prunes for this reason.
    const guitar = findInstrument('guitar')!;
    const tuning = findTuning(guitar, 'dadgad')!;
    const start = performance.now();
    for (const root of ROOT_PITCH_CLASSES) {
      generateVoicings(guitar, tuning, { root, quality: findQuality('13')! });
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
