/**
 * Passing songs between accounts. Inert in OSS, where there is one local user and
 * so nobody to pass anything to.
 *
 * Premium replaces this file wholesale through the overlay. Both copies must
 * export the same members with the same signatures, and `contract.test.ts`
 * enforces that in both repos. See ./README.md.
 *
 * Two seams, because sharing has exactly two places it touches the library: the
 * action that sends a song, which sits on the song, and the notice that something
 * arrived, which sits above the list.
 */

/**
 * The affordance for sending songs to a friend.
 *
 * Rendered in two places with the same component, because it is one action and
 * splitting it would let the two drift:
 *
 * - `variant="menu"` inside a song card's dropdown, where premium renders a
 *   `DropdownMenuItem` so it keyboard-navigates with its siblings rather than
 *   sitting inside them as a foreign element.
 * - `variant="bulk"` in the selection toolbar, where it renders a button next to
 *   the tag controls.
 *
 * `songUuids` is always a list, even for the single-song menu, so the send call
 * has one shape.
 */
export function SongShareAction(_props: {
  songUuids: string[];
  variant: 'menu' | 'bulk';
  /** Called once songs have actually been sent, so a caller can clear a selection. */
  onSent?: () => void;
}): null {
  return null;
}

/**
 * The notice that somebody sent you songs, and the review it opens.
 *
 * Sits directly above the library list, in the same slot as `SongCapNotice`, and
 * renders nothing at all when the inbox is empty: this is the one screen every
 * user opens, so an empty-state row here would be permanent furniture for a
 * feature most people use a few times a year.
 *
 * Owns the review UI as well as the banner. The accept step creates songs in the
 * viewer's library, which is why `onSongsChanged` exists: the library has to
 * reload rather than quietly disagree with the database.
 */
export function SongShareNotice(_props: {
  onSongsChanged?: () => void;
  className?: string;
}): null {
  return null;
}

/**
 * Where a song came from, or who took a copy of it.
 *
 * A third seam alongside the send action and the arrival notice, and the only
 * one that is purely informational: it renders a line on a song card and has
 * nothing to click. It exists because "who gave me this" is a property of the
 * song rather than of a queue, and neither the inbox nor the friends page can
 * answer it once the song is in the library.
 *
 * Renders nothing for a song nobody has passed around, which is nearly all of
 * them, so it costs an empty component per card rather than a line of furniture.
 */
export function SongProvenanceTag(_props: { songUuid: string }): null {
  return null;
}
