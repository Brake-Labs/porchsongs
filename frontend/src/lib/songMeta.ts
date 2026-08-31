/**
 * Guess a song's title and artist without an LLM.
 *
 * Two entry points, one set of rules. `guessSongMeta` reads pasted chart text
 * and runs at import. `guessFilenameMeta` reads the filename a tab PDF arrived
 * with and runs in the library tidy screen, because an uploaded document is
 * titled with its raw filename and has no artist at all.
 *
 * Importing a chart used to require a `/parse` round trip purely to fill in the
 * title and artist, which is why saving a song cost AI credits. This covers the
 * common cases locally so import can be free and instant.
 *
 * The contract is deliberately conservative: return empty strings rather than a
 * bad guess. An untitled song is trivially fixed by tapping the title on the
 * chart; a confidently wrong title is worse, because the user has to notice it
 * first.
 */

import { isChordNoiseToken, isChordShaped, isNoChordToken } from '@/lib/chords/chordToken';

export interface SongMeta {
  title: string;
  artist: string;
}

const EMPTY: SongMeta = { title: '', artist: '' };

/** ChordPro metadata, e.g. `{title: Wildwood Flower}` or `{st: The Carter Family}`. */
const DIRECTIVE = /^\s*\{\s*([a-z_]+)\s*:\s*(.+?)\s*\}\s*$/i;

/** A section marker on its own line, e.g. `[Verse 1]` or `[Chorus]`. */
const SECTION_LINE = /^\s*\[[^\]]*\]\s*$/;


/** Words that mean "this line is a chart annotation, not a title". */
const ANNOTATION =
  /^\s*(?:capo|key|tempo|bpm|time|tuning|intro|outro|verse|chorus|bridge|pre[- ]?chorus|refrain|solo|instrumental|interlude|tab|tabbed|transcribed|arrangement|standard tuning)\b/i;

/**
 * Separators between a title and an artist on a single line. Order matters: the
 * longest/most explicit forms are tried first so " - " does not win inside
 * " -- ".
 */
const TITLE_ARTIST_SEPARATORS = [' -- ', ' — ', ' – ', ' - ', ' by ', ' · ', ' | '];

/**
 * Stricter than Follow's version of this question, on purpose.
 *
 * Follow asks "is this a chord row" and tolerates a stray token, because getting
 * it wrong costs one mis-scrolled line. This asks "is it safe to skip this line
 * while hunting for a title", where a false positive silently discards the
 * title. So every token that is not furniture has to be a chord.
 */
function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  let chords = 0;
  for (const token of tokens) {
    if (isChordNoiseToken(token) || isNoChordToken(token)) continue;
    if (!isChordShaped(token)) return false;
    chords += 1;
  }
  // Everything was a chord or furniture, and at least one was a real chord.
  return chords > 0;
}

/** Strip decoration people paste around titles: quotes, and trailing "Chords"/"Tab". */
function cleanTitle(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  value = value.replace(/\s*\((?:official|lyrics|acoustic|live|chords?|tab)\b[^)]*\)\s*$/i, '');
  value = value.replace(/\s+(?:chords?|tabs?|lyrics)\s*$/i, '');
  // A dangling separator, e.g. "Blackbird - " where the artist half was blank.
  // The line is trimmed before splitting, so " - " no longer matches and the
  // hyphen would otherwise survive into the title.
  value = value.replace(/[\s]*[-–—|·]+\s*$/, '');
  return value.trim();
}

function cleanArtist(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^(?:by|artist)\s*[:-]?\s*/i, '');
  value = value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  return value.trim();
}

function splitTitleArtist(line: string): SongMeta {
  for (const separator of TITLE_ARTIST_SEPARATORS) {
    const index = line.toLowerCase().indexOf(separator.toLowerCase());
    if (index <= 0) continue;
    const title = cleanTitle(line.slice(0, index));
    const artist = cleanArtist(line.slice(index + separator.length));
    // Only accept the split if both halves survived cleaning. A trailing
    // separator would otherwise produce a title with an empty artist, which the
    // no-separator path already handles.
    if (title && artist) return { title, artist };
  }
  return { title: cleanTitle(line), artist: '' };
}

/**
 * Read ChordPro directives anywhere in the text. `title`/`t` and
 * `subtitle`/`st`/`artist`/`a` are the widely used spellings; `subtitle` is
 * conventionally the artist in ChordPro files.
 */
function fromDirectives(lines: string[]): SongMeta {
  let title = '';
  let artist = '';
  for (const line of lines) {
    const match = DIRECTIVE.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (!value) continue;
    if (!title && (key === 'title' || key === 't')) title = cleanTitle(value);
    else if (!artist && (key === 'subtitle' || key === 'st' || key === 'artist' || key === 'a')) {
      artist = cleanArtist(value);
    }
  }
  return { title, artist };
}

/**
 * Best-effort title and artist for a pasted chart.
 *
 * Precedence: explicit ChordPro directives, then the first line that looks like
 * prose rather than a chord row, a section marker, or a chart annotation.
 */
export function guessSongMeta(text: string): SongMeta {
  if (!text || !text.trim()) return EMPTY;

  const lines = text.split(/\r?\n/);

  const directives = fromDirectives(lines);
  if (directives.title) {
    // A directive title is authoritative. Fall back to a line-derived artist only
    // when no directive supplied one.
    if (directives.artist) return directives;
    return { title: directives.title, artist: '' };
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (SECTION_LINE.test(trimmed)) continue;
    if (DIRECTIVE.test(trimmed)) continue;
    if (ANNOTATION.test(trimmed)) continue;
    if (isChordLine(trimmed)) continue;
    // Very long lines are lyrics, not a title.
    if (trimmed.length > 120) return { title: '', artist: directives.artist };

    const guess = splitTitleArtist(trimmed);
    if (!guess.title) continue;
    return { title: guess.title, artist: guess.artist || directives.artist };
  }

  return { title: '', artist: directives.artist };
}

// ── Filenames ───────────────────────────────────────────────────────────────
//
// A tab PDF is stored with `title` set to its filename minus the extension and
// no artist at all, so every uploaded document lands in the library's "Unknown
// artist" bucket under a name like `wildwood_flower_carter_family_v2 (1)`. The
// filename is usually the only thing that knows better, and reading it costs
// nothing, so the tidy screen reads it before it offers to spend anything.

/** `.pdf` and friends. Only a short, alphabetic extension, so "Vol. 2" survives. */
const EXTENSION = /\.[a-z0-9]{1,5}$/i;

/**
 * A leading track number: "03 - Blackbird", "03. Blackbird", "03) Blackbird".
 *
 * The punctuation is required. Without it this would eat the opening of "99 Red
 * Balloons" and "8 Days a Week", and a title the user has to repair is worse
 * than a track number they can see and delete.
 *
 * Stripped before the title/artist split, or "03 - Blackbird" splits on its own
 * separator into the title "03" by the artist "Blackbird".
 */
const LEADING_TRACK_NUMBER = /^\d{1,3}\s*[-._)\]]\s*/;

/** Trailing marks from saving a file twice or twiddling it: "(1)", "v2", "copy", "final". */
const TRAILING_NOISE = [
  /\s*\(\d+\)\s*$/,
  /[\s_-]+copy(\s*\d+)?\s*$/i,
  /[\s_-]+v\d+\s*$/i,
  /[\s_-]+(?:final|draft|edit|new|old)\s*$/i,
];

/**
 * Parenthetical suffixes that describe the chart rather than name an artist, so
 * "Blackbird (Live)" does not get filed under an artist called Live.
 *
 * `cleanTitle` already removes several of these. This list is what remains once
 * it has run, and it is consulted only to reject: anything not on it is offered
 * as a suggestion for the user to accept or not, never written on its own.
 */
const NOT_AN_ARTIST =
  /^(?:live|acoustic|official|lyrics?|chords?|tabs?|remaster(?:ed)?|cover|demo|reprise|edit|version|ver|easy|beginner|simple|intro|outro|solo|instrumental|guitar|ukulele|uke|banjo|mandolin|piano|print(?:able)?|transcription|capo\b.*|key\b.*|in\s+[a-g][#b]?\b.*|\d+.*)$/i;

/** Words that stay lowercase inside a title. */
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of',
  'on', 'or', 'the', 'to', 'with',
]);

/**
 * Title-case a name that arrived with no capitals at all.
 *
 * Filenames are routinely all lowercase, and "wildwood flower" is not a title
 * anyone typed. A name with any capital in it is left exactly as it is, so
 * "AC/DC" survives untouched.
 *
 * The cost is an act that really does spell itself in lowercase: this turns
 * "k.d. lang" into "K.d. Lang". Accepted, because an all-lowercase filename is a
 * careless filename far more often than it is a deliberate one, and every row
 * this feeds is shown for editing before anything is written.
 */
export function titleCaseIfFlat(value: string): string {
  if (!value || /[A-Z]/.test(value)) return value;
  const words = value.split(' ');
  return words
    .map((word, i) => {
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Underscores and dots stand in for spaces in filenames, but only underscores do
 * so reliably. A dot is also an abbreviation ("Mr. Bojangles", "k.d. lang"), so
 * dots are only converted when the name has no spaces at all and several dots,
 * which is the download-site pattern and nothing else.
 */
function normaliseFilenameSeparators(name: string): string {
  let value = name.replace(/_+/g, ' ');
  if (!/\s/.test(value) && (value.match(/\./g) ?? []).length >= 2) {
    value = value.replace(/\./g, ' ');
  }
  return value.replace(/\s+/g, ' ').trim();
}

function stripTrailingNoise(name: string): string {
  let value = name;
  // Repeated, because these stack: "wildwood flower_v2 (1)" carries two.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = value;
    for (const pattern of TRAILING_NOISE) value = value.replace(pattern, '');
    if (value === before) break;
  }
  return value.trim();
}

/**
 * Pull an artist out of a trailing parenthetical: "Blackbird (The Beatles)".
 *
 * Returns null unless the contents read like somebody's name, which here means
 * one to four words, at least one letter, and nothing on the `NOT_AN_ARTIST`
 * list. The bar is high because the alternative is filing a chart under an
 * artist called "Capo 2", and a wrong artist is harder to notice than a missing
 * one.
 */
function parentheticalArtist(title: string): SongMeta | null {
  const match = /^(.*\S)\s*\(([^()]{2,60})\)\s*$/.exec(title);
  if (!match?.[1] || !match[2]) return null;
  const inner = match[2].trim();
  if (!/[a-z]/i.test(inner)) return null;
  if (inner.split(/\s+/).length > 4) return null;
  if (NOT_AN_ARTIST.test(inner)) return null;
  return { title: match[1].trim(), artist: inner };
}

/**
 * Best-effort title and artist for a stored document, read from its filename.
 *
 * Conservative in the same way as `guessSongMeta`: an artist is only returned
 * when the filename says so with a separator or a parenthetical. A name with no
 * structure at all ("wildwood flower carter family") yields a tidier title and
 * no artist, and it is the tidy screen's job to try the user's own artist list
 * against the leftovers.
 */
export function guessFilenameMeta(filename: string): SongMeta {
  if (!filename || !filename.trim()) return EMPTY;

  let name = filename.trim().replace(EXTENSION, '');
  name = normaliseFilenameSeparators(name);
  name = stripTrailingNoise(name);
  name = name.replace(LEADING_TRACK_NUMBER, '').trim();
  name = stripTrailingNoise(name);
  if (!name) return EMPTY;

  const split = splitTitleArtist(name);
  let { title, artist } = split;
  if (!artist) {
    const paren = parentheticalArtist(title);
    if (paren) ({ title, artist } = paren);
  }

  return { title: titleCaseIfFlat(title), artist: titleCaseIfFlat(artist) };
}
