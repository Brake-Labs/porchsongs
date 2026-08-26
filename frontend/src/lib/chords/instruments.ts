/**
 * Instrument and tuning definitions for the chord dictionary.
 *
 * Strings are listed in *diagram order*, left to right as drawn, which is not
 * always pitch order. A re-entrant ukulele's 4th string is the leftmost one and
 * also the second-highest sounding, and a 5-string banjo's drone is leftmost and
 * higher than the three strings to its right. Anything that reasons about which
 * note is in the bass has to sort by `midi` rather than trusting position.
 */

export interface GuitarString {
  /** MIDI note number of the open string. */
  midi: number;
  /**
   * Set on a string that does not run the full length of the neck: the 5-string
   * banjo drone, which is anchored at the 5th fret. It can be played open or
   * muted, or fretted at this fret or above, never below.
   */
  shortFrom?: number;
}

export interface Tuning {
  slug: string;
  name: string;
  /** Left-to-right as drawn on a chord diagram. */
  strings: GuitarString[];
  /** Shown under the name, e.g. "D A D G A D". */
  description: string;
}

export interface Instrument {
  slug: string;
  name: string;
  /** Plural, for headings: "Guitar chords". */
  tunings: Tuning[];
  /** Widest fret span one hand can cover on this neck. */
  maxSpan: number;
  /** How many frets the diagram draws. */
  fretsShown: number;
}

/** MIDI numbers for the octave-tagged note names used below. C4 = 60. */
const N = {
  D2: 38, E2: 40, G2: 43, A2: 45,
  C3: 48, D3: 50, F3: 53, Fs3: 54, G3: 55, A3: 57, Bb3: 58, B3: 59,
  C4: 60, D4: 62, E4: 64, G4: 67, A4: 69,
  E5: 76,
} as const;

export const INSTRUMENTS: Instrument[] = [
  {
    slug: 'guitar',
    name: 'Guitar',
    maxSpan: 4,
    fretsShown: 5,
    tunings: [
      {
        slug: 'standard',
        name: 'Standard',
        description: 'E A D G B E',
        strings: [{ midi: N.E2 }, { midi: N.A2 }, { midi: N.D3 }, { midi: N.G3 }, { midi: N.B3 }, { midi: N.E4 }],
      },
      {
        slug: 'drop-d',
        name: 'Drop D',
        description: 'D A D G B E',
        strings: [{ midi: N.D2 }, { midi: N.A2 }, { midi: N.D3 }, { midi: N.G3 }, { midi: N.B3 }, { midi: N.E4 }],
      },
      {
        slug: 'open-g',
        name: 'Open G',
        description: 'D G D G B D',
        strings: [{ midi: N.D2 }, { midi: N.G2 }, { midi: N.D3 }, { midi: N.G3 }, { midi: N.B3 }, { midi: N.D4 }],
      },
      {
        slug: 'open-d',
        name: 'Open D',
        description: 'D A D F# A D',
        strings: [{ midi: N.D2 }, { midi: N.A2 }, { midi: N.D3 }, { midi: N.Fs3 }, { midi: N.A3 }, { midi: N.D4 }],
      },
      {
        slug: 'dadgad',
        name: 'DADGAD',
        description: 'D A D G A D',
        strings: [{ midi: N.D2 }, { midi: N.A2 }, { midi: N.D3 }, { midi: N.G3 }, { midi: N.A3 }, { midi: N.D4 }],
      },
    ],
  },
  {
    slug: 'ukulele',
    name: 'Ukulele',
    maxSpan: 4,
    fretsShown: 5,
    tunings: [
      {
        // Re-entrant: the leftmost string sounds above the two next to it, which
        // is why voicings on a uke rarely have a "lowest string" worth calling a
        // bass note. The generator scores root-in-bass by pitch, so it does the
        // right thing here without a special case.
        slug: 'standard',
        name: 'Standard C',
        description: 'G C E A (high G)',
        strings: [{ midi: N.G4 }, { midi: N.C4 }, { midi: N.E4 }, { midi: N.A4 }],
      },
      {
        slug: 'low-g',
        name: 'Low G',
        description: 'G C E A (low G)',
        strings: [{ midi: N.G3 }, { midi: N.C4 }, { midi: N.E4 }, { midi: N.A4 }],
      },
      {
        slug: 'baritone',
        name: 'Baritone',
        description: 'D G B E',
        strings: [{ midi: N.D3 }, { midi: N.G3 }, { midi: N.B3 }, { midi: N.E4 }],
      },
    ],
  },
  {
    slug: 'mandolin',
    name: 'Mandolin',
    // Four courses of two. The pairs are tuned in unison, so a chord shape is a
    // four-note problem and the diagram draws four strings.
    maxSpan: 4,
    fretsShown: 5,
    tunings: [
      {
        slug: 'standard',
        name: 'Standard',
        description: 'G D A E',
        strings: [{ midi: N.G3 }, { midi: N.D4 }, { midi: N.A4 }, { midi: N.E5 }],
      },
    ],
  },
  {
    slug: 'banjo',
    name: 'Banjo',
    maxSpan: 4,
    fretsShown: 5,
    tunings: [
      {
        slug: 'open-g',
        name: 'Open G',
        description: 'g D G B D (5-string)',
        strings: [{ midi: N.G4, shortFrom: 5 }, { midi: N.D3 }, { midi: N.G3 }, { midi: N.B3 }, { midi: N.D4 }],
      },
    ],
  },
];

const INSTRUMENT_BY_SLUG = new Map(INSTRUMENTS.map(i => [i.slug, i]));

export function findInstrument(slug: string): Instrument | null {
  return INSTRUMENT_BY_SLUG.get(slug.toLowerCase()) ?? null;
}

export function findTuning(instrument: Instrument, slug: string): Tuning | null {
  return instrument.tunings.find(t => t.slug === slug.toLowerCase()) ?? null;
}

export const DEFAULT_INSTRUMENT = INSTRUMENTS[0]!;

/**
 * Apply a capo by raising every open string.
 *
 * A capo makes the chord you finger sound higher, so the alternative would be to
 * transpose the chord down and show the shape for that. Raising the tuning gets
 * the same shapes out of the generator while keeping fret numbers relative to
 * the capo, which is how a player reads them: "second fret" means two frets above
 * the capo, not above the nut.
 */
export function withCapo(tuning: Tuning, capo: number): Tuning {
  if (capo <= 0) return tuning;
  return {
    ...tuning,
    strings: tuning.strings.map(s => ({
      midi: s.midi + capo,
      // Banjo players raise the drone to match (a 5th-string spike or slide),
      // so it rises with the rest. Its anchor moves closer to the capo, because
      // fret numbers are read relative to the capo from here on.
      ...(s.shortFrom !== undefined ? { shortFrom: Math.max(0, s.shortFrom - capo) } : {}),
    })),
  };
}
