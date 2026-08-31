/**
 * Proposals for the songs sitting in the library's "Unknown artist" bucket.
 *
 * Every signal here is free and local. The library listing already carries each
 * song's chart text and, for a stored document, the filename it arrived with, so
 * this runs over data that is on the page and spends nothing. That is the point:
 * importing a chart costs no AI credit, and tidying up after the import must not
 * quietly become the place where the bill arrives. Whatever is left over after
 * this pass is the only thing worth offering to spend a credit on.
 *
 * Three signals, in order of how much they are trusted:
 *
 *   filename  A document is stored titled with its raw filename and no artist at
 *             all, so `wildwood_flower.pdf` is the whole of what is known about
 *             it. `guessFilenameMeta` reads the structure out of that.
 *   chart     A pasted chart may name its artist in a ChordPro directive or on
 *             its first line. `guessSongMeta` already tried this at import and
 *             came back empty, which is why the song is here, but a chart that
 *             arrived before that heuristic existed has never been asked.
 *   library   The user's own artist list. If "Carter Family" is already the
 *             artist on four other songs, finding that name in this filename is
 *             evidence rather than a guess, and it is the only signal that can
 *             pull an artist out of a name with no separator in it.
 *
 * Nothing here writes anything. `buildProposals` returns what could be changed
 * and the tidy screen shows it; a song is only touched when the user applies it.
 */

import { isUnknownArtist, tidyArtist } from '@/lib/artists';
import { guessFilenameMeta, guessSongMeta, titleCaseIfFlat } from '@/lib/songMeta';
import type { Song } from '@/types';

/** Where a proposed value was read from. Shown on the row, so it stays honest. */
export type MetaSource = 'filename' | 'chart' | 'library';

export interface TidyProposal {
  song: Song;
  /** Proposed title. Never empty: falls back to the title the song already has. */
  title: string;
  /** Proposed artist, or empty when no signal found one. */
  artist: string;
  /** Null when the title is unchanged. */
  titleSource: MetaSource | null;
  /** Null when no artist was found. */
  artistSource: MetaSource | null;
  /** The text the guess was read from, shown under the row so it can be checked. */
  evidence: string;
}

/** True when this proposal has something to apply. */
export function hasChange(p: TidyProposal): boolean {
  return p.titleSource !== null || p.artistSource !== null;
}

/** Punctuation-free comparison key for a single word. "AC/DC" and "ACDC" match. */
function wordKey(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The same, for a whole phrase, padded so `includes` only matches whole words. */
function phraseKey(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * A single-word artist shorter than this matches far too much. "Sun", "War" and
 * "Air" are all real acts and all ordinary words in a song title, and filing
 * "War Pigs" under the artist "War" is the kind of wrong that is hard to spot.
 * Multi-word names are exempt: "The Band" is unambiguous in a way "Band" is not.
 */
const MIN_SINGLE_WORD_ARTIST = 4;

/**
 * Every artist already in the library, longest name first.
 *
 * Longest first so the more specific name wins: a library holding both "Neil
 * Young" and "Neil Young & Crazy Horse" should match the latter when the
 * filename says so, and the shorter name would otherwise match it first.
 */
export function knownArtistNames(songs: Song[]): string[] {
  const seen = new Map<string, string>();
  for (const song of songs) {
    const name = tidyArtist(song.artist);
    if (!name) continue;
    const key = name.toLowerCase();
    // First spelling wins, which is arbitrary but stable. The library's own
    // grouping already picks a display spelling; this only needs to match.
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => b.length - a.length);
}

/** Separator punctuation left stranded at the edge of a title by a match. */
const EDGE_PUNCTUATION = /^[\s\-–—|·_.,]+|[\s\-–—|·_.,]+$/g;

/**
 * Find a known artist at the start or end of `text` and return what is left.
 *
 * Matching is on punctuation-free keys joined across whole words, so
 * "Carter-Family" matches the artist "Carter Family" and "AC/DC" matches "ACDC".
 * The run always starts or ends at a word boundary, which is what keeps "Sun"
 * from matching inside "Sunshine": the key for that word is "sunshine", not a
 * prefix of it.
 *
 * Only the ends. An artist name in the middle of a filename is more often a
 * coincidence than a credit, and the whole value of this signal is that it is
 * safe enough not to need a human to check every row.
 *
 * Returns null when the text is nothing but the artist name, because there would
 * be no title left to give the song.
 */
export function matchKnownArtist(
  text: string,
  known: string[],
): { artist: string; remainder: string } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const keys = words.map(wordKey);

  for (const artist of known) {
    const artistWords = artist.trim().split(/\s+/).map(wordKey).filter(Boolean);
    const artistKey = artistWords.join('');
    if (!artistKey) continue;
    if (artistWords.length === 1 && artistKey.length < MIN_SINGLE_WORD_ARTIST) continue;

    // `k < words.length` on both loops, so a match can never swallow every word
    // and leave the song with no title.
    for (let k = 1; k < words.length; k += 1) {
      const tail = keys.slice(words.length - k).join('');
      // Keys only grow as k does, so once it is too long it stays too long.
      if (tail.length > artistKey.length) break;
      if (tail !== artistKey) continue;
      const remainder = words.slice(0, words.length - k).join(' ').replace(EDGE_PUNCTUATION, '');
      if (remainder) return { artist, remainder };
      break;
    }

    for (let k = 1; k < words.length; k += 1) {
      const head = keys.slice(0, k).join('');
      if (head.length > artistKey.length) break;
      if (head !== artistKey) continue;
      const remainder = words.slice(k).join(' ').replace(EDGE_PUNCTUATION, '');
      if (remainder) return { artist, remainder };
      break;
    }
  }
  return null;
}

/** Find a known artist anywhere in a block of text, as a whole phrase. */
export function findKnownArtistIn(text: string, known: string[]): string | null {
  if (!text.trim()) return null;
  const haystack = phraseKey(text);
  for (const artist of known) {
    const needle = phraseKey(artist);
    if (needle.trim().length < MIN_SINGLE_WORD_ARTIST) continue;
    if (haystack.includes(needle)) return artist;
  }
  return null;
}

/**
 * How much of a chart to scan for a known artist.
 *
 * The head of the file only. An artist named in the middle of a chart is being
 * quoted, covered, or thanked, not credited, and scanning the lyrics for band
 * names finds "The Band" in a verse about a band.
 */
const CHART_HEAD_CHARS = 400;

/**
 * Whether a document's title is still the one `upload_document` gave it.
 *
 * That endpoint titles a stored tab with its filename minus the extension, so a
 * title matching that exactly is a placeholder nobody has looked at. A title that
 * has drifted from it is one the user typed, and re-deriving a title from the
 * filename would quietly undo their edit.
 */
function titleIsStillTheFilename(title: string, filename: string): boolean {
  return title === filename.trim().replace(/\.[a-z0-9]{1,5}$/i, '');
}

function proposeForDocument(song: Song, known: string[]): TidyProposal {
  const current = (song.title || '').trim();
  const filename = song.file?.filename ?? '';
  const guess = guessFilenameMeta(filename);
  const mayRetitle = titleIsStillTheFilename(current, filename);

  let title = (mayRetitle && guess.title) || current;
  let artist = guess.artist;
  let titleSource: MetaSource | null = title !== current ? 'filename' : null;
  let artistSource: MetaSource | null = artist ? 'filename' : null;

  // The filename had no separator to split on. The user's own artist list is the
  // last free way to find one, and it can take the artist back out of the title.
  //
  // Matched against the name read out of the filename rather than the title on
  // screen. Those are the same string until somebody fixes the title by hand,
  // and after that the filename is still the only place the artist is written
  // down: "Wildwood Flower" no longer contains "Carter Family", but
  // wildwood_flower_carter_family.pdf still does.
  if (!artist) {
    const hit = matchKnownArtist(guess.title || current, known);
    if (hit) {
      artist = hit.artist;
      artistSource = 'library';
      if (mayRetitle) {
        title = titleCaseIfFlat(hit.remainder);
        titleSource = title !== current ? 'library' : null;
      }
    }
  }

  return { song, title, artist, titleSource, artistSource, evidence: filename };
}

function proposeForChart(song: Song, known: string[]): TidyProposal {
  const current = (song.title || '').trim();
  const text = song.rewritten_content || song.original_content || '';
  const head = text.slice(0, CHART_HEAD_CHARS);
  const guess = guessSongMeta(text);

  // A title only when the chart has none. This same heuristic ran at import, so
  // a saved title either came from it or the user typed one over it; re-deriving
  // it now can only disagree with what is there, and what is there is the more
  // likely of the two to be right. Left unguarded, a chart titled "Caleb Meyer"
  // gets offered the first prose-looking line of its own lyrics instead.
  let title = current || guess.title;
  let artist = guess.artist;
  let titleSource: MetaSource | null = !current && guess.title ? 'chart' : null;
  let artistSource: MetaSource | null = artist ? 'chart' : null;

  if (!artist) {
    const inHead = findKnownArtistIn(head, known);
    if (inHead) {
      artist = inHead;
      artistSource = 'library';
    } else {
      // A chart titled "Wildwood Flower Carter Family" is the same shape as the
      // document case, so try the title itself.
      const hit = matchKnownArtist(title, known);
      if (hit) {
        artist = hit.artist;
        artistSource = 'library';
        title = titleCaseIfFlat(hit.remainder);
        titleSource = title !== current ? 'library' : null;
      }
    }
  }

  const evidence = head.split(/\r?\n/).filter(l => l.trim()).slice(0, 3).join('\n');
  return { song, title, artist, titleSource, artistSource, evidence };
}

/**
 * Order the queue so the rows worth reading come first.
 *
 * Rows with an artist lead, because they are the ones that empty the bucket and
 * the ones the user is here to approve. Rows with only a tidier title come next.
 * Rows with nothing found sink to the bottom, where the user types or taps one
 * of the quick fills, and where the count of them is the honest answer to "what
 * would an AI pass still have to do".
 */
function rank(p: TidyProposal): number {
  if (p.artistSource) return 0;
  if (p.titleSource) return 1;
  return 2;
}

export function buildProposals(songs: Song[]): TidyProposal[] {
  const known = knownArtistNames(songs);
  const proposals = songs
    .filter(song => isUnknownArtist(song.artist))
    .map(song => (song.kind === 'document'
      ? proposeForDocument(song, known)
      : proposeForChart(song, known)));

  return proposals.sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.title.localeCompare(b.title);
  });
}
