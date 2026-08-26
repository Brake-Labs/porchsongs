import { normalizeSong } from '@/lib/followAlign';
import { chordName, parseChordName, type Chord } from './theory';

/**
 * The chords a chart actually uses, in the order they first appear.
 *
 * This is what turns the chord panel from a dictionary you have to search into
 * one that already knows what you are playing. Charts arrive in two shapes and
 * both have to work: chords bracketed inline with the words, and chords on
 * their own line above them.
 *
 * The inline case is a plain scan for bracketed tokens, filtered by whether
 * they parse as a chord, which is also what keeps "[Verse 1]" and "[Chorus]"
 * out. The chords-above-lyrics case leans on `normalizeSong`, which already
 * decides line by line what is a chord row for Follow. Scanning every line for
 * chord-shaped words instead would collect the "A" in "A long time ago".
 */

/** Longest bracketed token still worth testing. "[Instrumental break]" is not a chord. */
const MAX_TOKEN_LENGTH = 12;

/**
 * Cap on how many distinct chords are reported.
 *
 * The row is a shortcut, not an inventory. A jazz chart can genuinely use forty
 * chords, and forty pills is a wall to read rather than a way to jump.
 */
export const MAX_SONG_CHORDS = 24;

const BRACKETED = /\[([^\]\n]+)\]/g;

/**
 * A chart's own legend of the chords in it.
 *
 * `normalizeSong` files this as metadata rather than as a chord row, which is
 * right for Follow (it is not a row anyone sings along to) and wrong here: it is
 * the one line where a chart lists its chords deliberately. Matched separately
 * rather than by loosening the classifier, which the rest of the app depends on.
 */
const CHORDS_USED = /^\s*chords?\s+used\b\s*[:|-]\s*(.*)$/i;

export function chordsUsedIn(text: string): Chord[] {
  if (!text.trim()) return [];

  const found: Chord[] = [];
  const seen = new Set<string>();

  const add = (token: string): void => {
    if (found.length >= MAX_SONG_CHORDS) return;
    if (token.length > MAX_TOKEN_LENGTH) return;
    const chord = parseChordName(token);
    if (!chord) return;
    const key = chordName(chord);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(chord);
  };

  /** A bare token from a chord row, which sometimes wears parentheses. */
  const addToken = (token: string): void => {
    if (token) add(token.replace(/^\(|\)$/g, ''));
  };

  // One walk down the chart rather than a pass per format, so the order really
  // is the order they appear. Running the formats as two passes reported every
  // bracketed chord ahead of every chord row, which on a chart that mixes them
  // meant `chordsUsedIn(...)[0]` was not the chart's first chord, and that is
  // the value the panel opens on.
  const lines = text.split('\n');
  const { lineKind } = normalizeSong(text);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Bracketed chords can share a line with anything, a chord row included, so
    // this runs on every line and the dedupe sorts out the overlap.
    for (const match of line.matchAll(BRACKETED)) add(match[1]!.trim());

    const legend = CHORDS_USED.exec(line);
    if (legend) {
      for (const token of legend[1]!.split(/\s+/)) addToken(token);
      continue;
    }

    if (lineKind[i] === 'chord') {
      for (const token of line.split(/\s+/)) addToken(token);
    }
  }

  return found;
}
