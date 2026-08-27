import { parseNote } from './theory';

/**
 * One vocabulary for "does this token look like a chord", shared by everything
 * that reads a chart.
 *
 * Three modules used to answer this independently: `followAlign` classified
 * chord rows for Follow, `songMeta` skipped them when hunting for a title, and
 * `theory.parseChordName` parsed them into diagrams. Each had its own regex and
 * they disagreed on real charts. `Cm7b5   Fm7` and `C#m      A` (with a unicode
 * sharp) were both classified as *lyric* rows, which meant an empty chord panel
 * and Follow trying to align a singer against a line of chord symbols.
 *
 * The split here is deliberate and is the thing that keeps that bug from coming
 * back in a new form:
 *
 *  - `isChordShaped` answers "is this token a chord *name*", and is permissive.
 *    It accepts qualities this app cannot draw (`Cm11`, `Cno3`), because a chord
 *    row does not stop being a chord row when it contains one.
 *  - `parseChordName` (in ./theory) answers "can we draw it", and is narrow.
 *
 * `isChordShaped` is a strict superset of `parseChordName`, enforced by a test.
 * Line-level policy stays with the callers, because it genuinely differs: Follow
 * accepts a row where most tokens are chords, `songMeta` requires all of them.
 */

/** Bar lines, repeat marks and counts: chart furniture that shares a chord row. */
const NOISE = /^(?:\||\|\||:\||\|:|\|\.|%|-+|x\d+|\d+x|\/+)$/i;

/** "No chord": a real chord-row token that names the absence of one. */
const NO_CHORD = /^n\.?c\.?$/i;

/** Wrappers a chart puts around a chord: (C), [C], and trailing bar lines. */
const WRAPPER = /^[[(]+|[\])|]+$/g;

/**
 * The note letter, and only the letter.
 *
 * Accidentals are left to the tail vocabulary below, which has to know them
 * anyway for altered qualities like `7b5` and `7#9`. Matching them here as well
 * would be a second, untested path to the same answer: a mutation removing
 * unicode support from this pattern changed nothing, because the tail absorbed
 * `♯` regardless. One place, exercised by every accidental test.
 */
const ROOT = /^([A-G])(.*)$/;

/**
 * The pieces a chord quality is spelled out of.
 *
 * An explicit vocabulary rather than a character class, because a character
 * class matches lyrics. `[A-G]` plus "any letters" makes chords out of "Every",
 * "Cause" and "Dance"; requiring the tail to be a run of these words does not.
 *
 * Every alias in `theory.QUALITY_ALIASES` has to be spellable from this list, or
 * a chord the dictionary can draw would fail the looser test that gates it.
 * `chordToken.test.ts` asserts exactly that, and caught `madd9` the first time
 * it ran: the words overlap, so the tail has to be searched rather than chewed
 * greedily. See `tailIsQuality`.
 */
const QUALITY_WORDS = [
  // Accidentals. These carry the root's own sharp or flat ("Bb", "C♯m") as well
  // as altered tones inside a quality ("7b5", "7#9"), which is why they live
  // here rather than in ROOT above.
  '#',
  'b',
  '♯',
  '♭',
  'major',
  'minor',
  'maj',
  'min',
  'dom',
  'sus',
  'add',
  'aug',
  'dim',
  'alt',
  'ma',
  'no',
  'm',
  'M',
  'Δ', // Δ, major 7th
  '°', // °, diminished
  'ø', // ø, half-diminished
  '+',
  '-',
  '/',
];

/** Strip the brackets, parens and bar lines a chart wraps around a chord. */
export function unwrapChordToken(token: string): string {
  return token.replace(WRAPPER, '').trim();
}

/** True for "N.C.", "NC", "n.c." — a chord row saying there is no chord here. */
export function isNoChordToken(token: string): boolean {
  return NO_CHORD.test(unwrapChordToken(token));
}

/**
 * True for bar lines, repeat marks and bar counts.
 *
 * Callers drop these from the denominator rather than counting them against the
 * line. `| C | G |` is a chord row with two chords on it, not a five-token line
 * that is 40% chords.
 */
export function isChordNoiseToken(token: string): boolean {
  return NOISE.test(token.trim());
}

/**
 * Whether the whole tail can be read as a run of quality words and digits.
 *
 * Backtracking, not greedy, because the vocabulary overlaps: `madd9` is
 * `m`+`add`+`9`, and taking the longest word first reads it as `ma` and then
 * dead-ends on `dd9`. Failed positions are remembered so an adversarial token
 * of repeated `m`s cannot make this exponential.
 */
function tailIsQuality(tail: string): boolean {
  const dead = new Set<number>();

  const from = (i: number): boolean => {
    if (i >= tail.length) return true;
    if (dead.has(i)) return false;
    if (/\d/.test(tail[i]!) && from(i + 1)) return true;
    for (const word of QUALITY_WORDS) {
      if (tail.startsWith(word, i) && from(i + word.length)) return true;
    }
    dead.add(i);
    return false;
  };

  return from(0);
}

/**
 * True when the token names a chord, whether or not this app can draw it.
 *
 * Used to decide what a *line* is. Deliberately looser than `parseChordName`:
 * classifying a row by whether every chord on it is in our 28-quality table is
 * how `Cm7b5   Fm7` came to be read as a lyric.
 */
export function isChordShaped(token: string): boolean {
  const bare = unwrapChordToken(token);
  if (!bare) return false;

  const rooted = ROOT.exec(bare);
  if (!rooted) return false;

  let tail = rooted[2]!;

  // A slash bass ("D/F#") is part of the name. Only stripped when what follows
  // the slash really is a note, so "6/9" keeps its 9 and stays chord-shaped.
  const slash = tail.lastIndexOf('/');
  if (slash >= 0 && parseNote(tail.slice(slash + 1)) !== null) {
    tail = tail.slice(0, slash);
  }

  // The rest must be a run of quality words and digits, with nothing left over.
  // "Amazing" gets as far as the "m" and then stops on "azing".
  return tailIsQuality(tail);
}
