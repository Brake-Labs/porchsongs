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

  // Both passes run over the whole chart rather than one being a fallback for
  // the other. A chart can carry a "Chords used:" row of bare names at the top
  // and bracketed chords in the body, and picking a single format would drop
  // half of a chart like that.
  for (const match of text.matchAll(BRACKETED)) add(match[1]!.trim());

  const lines = text.split('\n');
  const { lineKind } = normalizeSong(text);
  for (let i = 0; i < lines.length; i++) {
    if (lineKind[i] !== 'chord') continue;
    for (const token of lines[i]!.split(/\s+/)) {
      if (token) add(token.replace(/^\(|\)$/g, ''));
    }
  }

  return found;
}
