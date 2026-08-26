/**
 * Note and chord-quality primitives for the chord dictionary.
 *
 * Deliberately small: pitch classes as integers 0-11 (C = 0), chord qualities as
 * interval lists in semitones from the root. There is no published dataset that
 * covers guitar, ukulele, mandolin, and banjo together, let alone in alternate
 * tunings, so every shape the app draws is generated from a tuning plus one of
 * these interval lists. See ./voicing.ts for the generator and
 * ./voicing.chordsdb.test.ts for the check that it agrees with published shapes.
 */

/** Semitones above C. */
export type PitchClass = number;

/**
 * One spelling per pitch class, and not uniformly sharp.
 *
 * Every black note has two names for one sound, and choosing per note rather
 * than per keyboard follows what players write: Bb and Eb, never A# and D#, but
 * F# rather than Gb. This list is the single source of that decision. A chord's
 * URL slug is derived from it (./chordUrl.ts) and the server renders meta from a
 * mirror of it (porchsongs_premium/seo.py), so a page, its address, and its
 * title always agree.
 *
 * There was briefly a sharp/flat toggle instead. It meant the page at
 * /chords/ukulele/b-flat-m7 rendered "A#m7" as its heading while the
 * server-rendered title said "Bbm7": one chord disagreeing with itself in three
 * places. Both spellings still resolve, so a search for either lands here.
 */
export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/**
 * Roots offered in the picker, in the order they appear.
 *
 * Twelve entries, not seventeen: a dictionary that lists C# and Db as separate
 * rows doubles the grid to show identical fingerings.
 */
export const ROOT_PITCH_CLASSES: PitchClass[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export function noteName(pc: PitchClass): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12]!;
}

/** Parse a note name ("C", "F#", "Bb", "e") to a pitch class, or null. */
export function parseNote(name: string): PitchClass | null {
  const m = /^([A-Ga-g])([#b♯♭]*)$/.exec(name.trim());
  if (!m) return null;
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let pc = base[m[1]!.toLowerCase()]!;
  for (const ch of m[2]!) {
    if (ch === '#' || ch === '♯') pc += 1;
    else pc -= 1;
  }
  return ((pc % 12) + 12) % 12;
}

/**
 * The role an interval plays in the chord, which is what tells the generator
 * which notes it may drop.
 *
 * Four-note chords do not fit on a four-string instrument without dropping
 * something, and which note you drop is not arbitrary: the third and the seventh
 * carry the chord's identity, the fifth is the first to go, and the root can go
 * too once something else is stating it. Ranking voicings without this produces
 * shapes that are technically correct and musically wrong, e.g. a "G7" with no B
 * and no F.
 */
export type ToneRole = 'root' | 'third' | 'fifth' | 'seventh' | 'extension';

export interface ChordTone {
  /** Semitones above the root. */
  interval: number;
  role: ToneRole;
  /** Whether a voicing may leave this tone out entirely. */
  optional: boolean;
}

export interface ChordQuality {
  /** Suffix as written after the root, e.g. "m7". Empty string for major. */
  suffix: string;
  /** Human label for the picker, e.g. "minor 7th". */
  label: string;
  tones: ChordTone[];
  /**
   * Whether this quality appears in the compact picker. The long tail stays
   * reachable by URL and by the "show all qualities" toggle, but a dictionary
   * that opens with 40 buttons is not a dictionary anyone reads.
   */
  common: boolean;
}

function t(interval: number, role: ToneRole, optional = false): ChordTone {
  return { interval, role, optional };
}

/**
 * The root is never optional here.
 *
 * Rootless voicings are real and useful in a band, where the bass covers the
 * root, but this is a dictionary: a shape labelled "G7" that contains no G is a
 * lookup result nobody can use on their own. The fifth is the droppable one.
 */
const ROOT = t(0, 'root');
const FIFTH_OPT = t(7, 'fifth', true);

/**
 * The chord vocabulary.
 *
 * Scoped to what this product's players reach for: folk, worship, country, and
 * singer-songwriter repertoire, plus the jazz colours that show up in a fake
 * book. Order here is the order in the picker.
 */
export const CHORD_QUALITIES: ChordQuality[] = [
  { suffix: '', label: 'major', common: true, tones: [ROOT, t(4, 'third'), FIFTH_OPT] },
  { suffix: 'm', label: 'minor', common: true, tones: [ROOT, t(3, 'third'), FIFTH_OPT] },
  { suffix: '7', label: 'dominant 7th', common: true, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(10, 'seventh')] },
  { suffix: 'm7', label: 'minor 7th', common: true, tones: [ROOT, t(3, 'third'), FIFTH_OPT, t(10, 'seventh')] },
  { suffix: 'maj7', label: 'major 7th', common: true, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(11, 'seventh')] },
  { suffix: 'sus2', label: 'suspended 2nd', common: true, tones: [ROOT, t(2, 'third'), t(7, 'fifth')] },
  { suffix: 'sus4', label: 'suspended 4th', common: true, tones: [ROOT, t(5, 'third'), t(7, 'fifth')] },
  { suffix: '5', label: 'power chord', common: true, tones: [ROOT, t(7, 'fifth')] },
  { suffix: '6', label: 'major 6th', common: true, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(9, 'extension')] },
  { suffix: 'm6', label: 'minor 6th', common: true, tones: [ROOT, t(3, 'third'), FIFTH_OPT, t(9, 'extension')] },
  { suffix: 'add9', label: 'added 9th', common: true, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(14, 'extension')] },
  { suffix: '9', label: 'dominant 9th', common: true, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(10, 'seventh'), t(14, 'extension')] },
  { suffix: 'dim', label: 'diminished', common: true, tones: [ROOT, t(3, 'third'), t(6, 'fifth')] },
  { suffix: 'aug', label: 'augmented', common: true, tones: [ROOT, t(4, 'third'), t(8, 'fifth')] },

  // The long tail. Reachable by URL and behind the "all qualities" toggle.
  { suffix: '7sus4', label: 'dominant 7th suspended 4th', common: false, tones: [ROOT, t(5, 'third'), FIFTH_OPT, t(10, 'seventh')] },
  { suffix: 'm7b5', label: 'half-diminished', common: false, tones: [ROOT, t(3, 'third'), t(6, 'fifth'), t(10, 'seventh')] },
  { suffix: 'dim7', label: 'diminished 7th', common: false, tones: [ROOT, t(3, 'third'), t(6, 'fifth'), t(9, 'seventh')] },
  { suffix: 'mmaj7', label: 'minor major 7th', common: false, tones: [ROOT, t(3, 'third'), FIFTH_OPT, t(11, 'seventh')] },
  { suffix: 'madd9', label: 'minor added 9th', common: false, tones: [ROOT, t(3, 'third'), FIFTH_OPT, t(14, 'extension')] },
  { suffix: 'maj9', label: 'major 9th', common: false, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(11, 'seventh'), t(14, 'extension')] },
  { suffix: 'm9', label: 'minor 9th', common: false, tones: [ROOT, t(3, 'third'), FIFTH_OPT, t(10, 'seventh'), t(14, 'extension')] },
  { suffix: '11', label: 'dominant 11th', common: false, tones: [ROOT, t(4, 'third', true), FIFTH_OPT, t(10, 'seventh'), t(17, 'extension')] },
  { suffix: '13', label: 'dominant 13th', common: false, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(10, 'seventh'), t(21, 'extension')] },
  { suffix: '7b5', label: 'dominant 7th flat 5', common: false, tones: [ROOT, t(4, 'third'), t(6, 'fifth'), t(10, 'seventh')] },
  { suffix: '7#5', label: 'dominant 7th sharp 5', common: false, tones: [ROOT, t(4, 'third'), t(8, 'fifth'), t(10, 'seventh')] },
  { suffix: '7b9', label: 'dominant 7th flat 9', common: false, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(10, 'seventh'), t(13, 'extension')] },
  { suffix: '7#9', label: 'dominant 7th sharp 9', common: false, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(10, 'seventh'), t(15, 'extension')] },
  { suffix: '6/9', label: 'six nine', common: false, tones: [ROOT, t(4, 'third'), FIFTH_OPT, t(9, 'extension'), t(14, 'extension')] },
];

const QUALITY_BY_SUFFIX = new Map(CHORD_QUALITIES.map(q => [q.suffix.toLowerCase(), q]));

export function findQuality(suffix: string): ChordQuality | null {
  return QUALITY_BY_SUFFIX.get(suffix.toLowerCase()) ?? null;
}

export interface Chord {
  root: PitchClass;
  quality: ChordQuality;
}

/** Display name, e.g. "Bbm7". */
export function chordName(chord: Chord): string {
  return noteName(chord.root) + chord.quality.suffix;
}

/** Spoken-ish name for screen readers and meta descriptions, e.g. "B flat minor 7th". */
export function chordFullName(chord: Chord): string {
  const note = noteName(chord.root).replace('#', ' sharp').replace('b', ' flat');
  return `${note} ${chord.quality.label}`;
}

/** The distinct pitch classes a chord contains, ignoring which are optional. */
export function chordPitchClasses(chord: Chord): Set<PitchClass> {
  return new Set(chord.quality.tones.map(tone => (chord.root + tone.interval) % 12));
}

/**
 * Map every pitch class in the chord back to the role it plays.
 *
 * A pitch class can be reached by two intervals in a few qualities (dim7 spells
 * its 6/13 as a seventh, 6/9 has both a 6th and a 9th), so the first role wins
 * and the table is ordered root-first for that reason.
 */
export function roleByPitchClass(chord: Chord): Map<PitchClass, ToneRole> {
  const map = new Map<PitchClass, ToneRole>();
  for (const tone of chord.quality.tones) {
    const pc = (chord.root + tone.interval) % 12;
    if (!map.has(pc)) map.set(pc, tone.role);
  }
  return map;
}
