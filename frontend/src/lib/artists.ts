/**
 * What an artist name is, and when a song has none.
 *
 * Lifted out of `LibraryTab` when the tidy screen arrived. Both screens have to
 * agree on which songs are in the "Unknown artist" bucket: the library draws the
 * card that says how many there are, the tidy screen lists them, and a second
 * definition of "blank" would let one of them offer to fix a song the other
 * never counted.
 */

/**
 * Grouping key for charts with no artist. The leading space is load-bearing: a
 * real key is a `tidyArtist` result, so it is always trimmed, and no artist a
 * user can type will collide with this one. Without it, someone who titled an
 * artist "__unknown__" would have their charts swallowed by the bucket.
 */
export const UNKNOWN_ARTIST_KEY = ' __unknown__';

/** Trimmed, with every run of internal whitespace collapsed to one space. */
export function tidyArtist(artist: string | null | undefined): string {
  return (artist || '').trim().replace(/\s+/g, ' ');
}

/** Case-and-whitespace-insensitive grouping key for an artist name. */
export function artistKeyOf(artist: string | null | undefined): string {
  // Internal runs of whitespace collapse as well as leading and trailing ones,
  // so a double space or a stray tab from a pasted chart does not split one
  // artist across two cards.
  const tidy = tidyArtist(artist);
  return tidy ? tidy.toLowerCase() : UNKNOWN_ARTIST_KEY;
}

/** Whether this artist value puts its song in the unknown bucket. */
export function isUnknownArtist(artist: string | null | undefined): boolean {
  return artistKeyOf(artist) === UNKNOWN_ARTIST_KEY;
}
