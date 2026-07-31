/**
 * Guess a song's title and artist from pasted chart text, with no LLM.
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

export interface SongMeta {
  title: string;
  artist: string;
}

const EMPTY: SongMeta = { title: '', artist: '' };

/** ChordPro metadata, e.g. `{title: Wildwood Flower}` or `{st: The Carter Family}`. */
const DIRECTIVE = /^\s*\{\s*([a-z_]+)\s*:\s*(.+?)\s*\}\s*$/i;

/** A section marker on its own line, e.g. `[Verse 1]` or `[Chorus]`. */
const SECTION_LINE = /^\s*\[[^\]]*\]\s*$/;

/**
 * One chord token: a root note, optional accidental, optional quality/extension,
 * optional slash bass. Wrapped brackets and parens are tolerated because inline
 * chord formats use them.
 */
const CHORD_TOKEN =
  /^[[(]?[A-G][#b♯♭]?(?:maj|min|m|M|aug|dim|sus|add|°|ø|\+|-)?\d*(?:(?:sus|add|maj|no)\d+)?(?:\/[A-G][#b♯♭]?)?[\])]?$/;

/** Percussive or structural noise that shows up on chord lines. */
const CHORD_NOISE = /^(?:\||\|\||:\||\|:|%|-+|x\d+|\d+x|N\.?C\.?|\/+)$/i;

/** Words that mean "this line is a chart annotation, not a title". */
const ANNOTATION =
  /^\s*(?:capo|key|tempo|bpm|time|tuning|intro|outro|verse|chorus|bridge|pre[- ]?chorus|refrain|solo|instrumental|interlude|tab|tabbed|transcribed|arrangement|standard tuning)\b/i;

/**
 * Separators between a title and an artist on a single line. Order matters: the
 * longest/most explicit forms are tried first so " - " does not win inside
 * " -- ".
 */
const TITLE_ARTIST_SEPARATORS = [' -- ', ' — ', ' – ', ' - ', ' by ', ' · ', ' | '];

function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  let chords = 0;
  for (const token of tokens) {
    if (CHORD_NOISE.test(token)) continue;
    if (!CHORD_TOKEN.test(token)) return false;
    chords += 1;
  }
  // All tokens parsed as chords or noise, and at least one was a real chord.
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
