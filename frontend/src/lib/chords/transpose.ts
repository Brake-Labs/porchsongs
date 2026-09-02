import { normalizeSong } from '@/lib/followAlign';
import { isChordShaped } from './chordToken';
import { noteName, parseNote, type PitchClass } from './theory';

/**
 * Transpose a chart as text, because the chart *is* text.
 *
 * A chart renders as raw monospace lines with chords sitting above the syllables
 * they belong to by column, so moving a song to another key means rewriting
 * chord tokens in place while disturbing those columns as little as possible.
 * There is no chord data model to shift; the text is the model.
 *
 * Which tokens move is decided by the shared vocabulary in ./chordToken, not by
 * a private regex (see the header there for why a fourth grammar is a bug
 * factory). Anything `isChordShaped` accepts is transposed, including qualities
 * the dictionary cannot draw: a row transposed except for its one `Cm11` is
 * musical nonsense. That is why the rewriter shifts the root and keeps the
 * quality tail verbatim rather than round-tripping through `parseChordName`,
 * which also silently drops the slash bass it cannot draw, and D/F# up a tone
 * is E/G#, not E.
 */

/** Leading and trailing chart furniture around a chord, kept through a rewrite:
 *  the two halves of `chordToken.WRAPPER`, captured instead of stripped. */
const WRAPPED = /^([[(]*)(.*?)([\])|]*)$/;

/** The root with all of its accidentals, so `parseNote` sees the whole spelling
 *  and a double flat is one root, not a root and a stray accidental. */
const ROOT_SPELLING = /^([A-G][#b♯♭]*)(.*)$/;

/**
 * A chord name shifted by an interval, or null when the token is not one.
 *
 * The output spelling comes from `NOTE_NAMES`, the one place that decides Bb
 * over A# (see theory.ts). Whatever accidental convention the chart arrived
 * with, the transposed chart agrees with the chord panel and the dictionary.
 */
export function transposeChordToken(token: string, semitones: number): string | null {
  if (!isChordShaped(token)) return null;

  const wrapped = WRAPPED.exec(token)!;
  const bare = wrapped[2]!;

  const rooted = ROOT_SPELLING.exec(bare);
  if (!rooted) return null;
  const root = parseNote(rooted[1]!);
  if (root === null) return null;

  let tail = rooted[2]!;

  // The slash bass moves with the chord. Only rewritten when what follows the
  // slash really is a note, so "6/9" keeps its 9, same rule as isChordShaped.
  const slash = tail.lastIndexOf('/');
  if (slash >= 0) {
    const bass = parseNote(tail.slice(slash + 1));
    if (bass !== null) {
      tail = `${tail.slice(0, slash + 1)}${noteName(bass + semitones)}`;
    }
  }

  return `${wrapped[1]}${noteName(root + semitones)}${tail}${wrapped[3]}`;
}

/**
 * Rewrite one chord row, holding every token to its original column.
 *
 * Renaming can change a token's width (C to C# grows, Bb to A shrinks), and the
 * lyric line underneath does not move. Each token is placed back at the column
 * it came from whenever the drift allows, and pushed right by at most the
 * accumulated growth when it does not, with a single space kept between tokens
 * so two chords can never fuse into one.
 */
function transposeRow(line: string, semitones: number): string {
  let out = '';
  for (const m of line.matchAll(/\S+/g)) {
    const token = transposeChordToken(m[0], semitones) ?? m[0];
    const col = m.index ?? 0;
    const start = out.length === 0 ? col : Math.max(col, out.length + 1);
    out = out.padEnd(start, ' ') + token;
  }
  return out;
}

/** Inline chords share their line with lyrics: "[C]down by the [G]river". The
 *  brackets are the columns there, so only the content is rewritten. */
function transposeInline(line: string, semitones: number): string {
  return line.replace(/\[([^\]\n]+)\]/g, (whole, content: string) => {
    const moved = transposeChordToken(content.trim(), semitones);
    return moved === null ? whole : `[${moved}]`;
  });
}

/** "Chords used: C G Am". Filed as metadata by normalizeSong, but it is the one
 *  line where a chart names its chords deliberately, so it moves with them. */
const CHORDS_USED_LINE = /^\s*chords?\s+used\b\s*[:|-]/i;

/** "Key: G". The declared key is a chord-shaped token and moves like one. */
const KEY_LINE = /^\s*key\b\s*[:|-]/i;

/**
 * A legend row pairing a name with a fingering: "G - 320003".
 *
 * Left alone entirely. Transposing the name would caption the old shape with a
 * chord it does not play, and the shape cannot be transposed in text. The chord
 * panel is the source of correct shapes for the new key. Same pattern as
 * followAlign's CHORD_LEGEND.
 */
const FINGERING_LEGEND = /^(.+?)\s*[-–—]\s*([xX0-9]{4,6})$/;

/**
 * The whole chart moved by an interval, as new text.
 *
 * Guaranteed not to change the line count, lyric characters outside brackets,
 * or what `normalizeSong` makes of any line. That invariant is what lets Follow
 * mode, the layout solver, and the column splitter all take transposed text
 * with no idea a transposition happened.
 *
 * An offset of a whole number of octaves returns the text unchanged, spelling
 * included: stepping up twelve and back down must not respell the author's A#
 * as Bb behind their back.
 */
export function transposeChart(text: string, semitones: number): string {
  if (((semitones % 12) + 12) % 12 === 0) return text;

  const lines = text.split('\n');
  const { lineKind } = normalizeSong(text);

  return lines
    .map((line, i) => {
      if (FINGERING_LEGEND.test(line.trim())) return line;
      if (CHORDS_USED_LINE.test(line) || KEY_LINE.test(line)) {
        return transposeRow(line, semitones);
      }
      if (lineKind[i] === 'chord') return transposeRow(line, semitones);
      return transposeInline(line, semitones);
    })
    .join('\n');
}

/**
 * Roots that have open-position shapes, per instrument.
 *
 * The stand-in for "shapes a porch player fingers without a barre": the cowboy
 * keys on guitar, their equivalents elsewhere. Quality barely matters at this
 * level (C, Cm and C7 all live at the nut), so roots are enough.
 */
const OPEN_ROOTS: Record<string, PitchClass[]> = {
  guitar: [0, 2, 4, 7, 9], // C D E G A
  ukulele: [0, 2, 5, 7, 9], // C D F G A
  mandolin: [0, 2, 7, 9], // C D G A
  banjo: [0, 2, 7], // C D G
};

/** Where the suggestion stops looking. Past the 7th fret a capo stops being a
 *  convenience, which is also where the dictionary's picker stops. */
const HIGHEST_SUGGESTED_CAPO = 7;

/**
 * The capo that turns the most of these chords into open shapes.
 *
 * `roots` are the *sounding* roots the player wants to hear; a capo at fret c
 * means fingering everything c semitones lower. Ties go to the lowest fret,
 * and capo 0 competes like any other, so a chart already sitting on open
 * shapes suggests no capo at all.
 */
export function suggestCapo(roots: PitchClass[], instrumentSlug: string): number {
  const open = OPEN_ROOTS[instrumentSlug];
  if (!open || roots.length === 0) return 0;
  const openSet = new Set(open);

  let best = 0;
  let bestScore = -1;
  for (let capo = 0; capo <= HIGHEST_SUGGESTED_CAPO; capo++) {
    let score = 0;
    for (const root of roots) {
      if (openSet.has(((root - capo) % 12 + 12) % 12)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = capo;
    }
  }
  return best;
}
