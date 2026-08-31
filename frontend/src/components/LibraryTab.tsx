import { useState, useEffect, useRef, useMemo, useCallback, type DragEvent } from 'react';
import { useNavigate, useLocation, useSearchParams, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import api, { STORAGE_KEYS } from '@/api';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { UNKNOWN_ARTIST_KEY, artistKeyOf, tidyArtist } from '@/lib/artists';
import { buildProposals } from '@/lib/tidy';
import { Select } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import PromptDialog, { type PromptField } from '@/components/ui/prompt-dialog';
import TagSuggestDialog from '@/components/TagSuggestDialog';
import TagEditDialog from '@/components/TagEditDialog';
import { cn } from '@/lib/utils';
import { SongCapNotice, SongShareAction, SongShareNotice } from '@/extensions';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song } from '@/types';

// shrink-0 because the tag row is a horizontal scroller below the sm
// breakpoint. Without it the pills compress to fit instead of scrolling, and a
// long tag name arrives as a column of one word per line.
const TAG_PILL_CLASS = 'shrink-0 bg-card border border-border rounded-full px-3 py-1.5 text-xs cursor-pointer transition-all text-muted-foreground font-medium hover:border-primary hover:text-foreground whitespace-nowrap';
const TAG_PILL_ACTIVE = 'bg-primary text-white border-primary';

/** What the library sends to mean "songs carrying no tags at all". */
const UNTAGGED = '__untagged__';

interface TagPillProps {
  tag: string;
  count: number;
  isActive: boolean;
  isDragOver: boolean;
  onToggle: (tag: string) => void;
  onRename: (tag: string) => void;
  onDelete: (tag: string) => void;
  onDragOver: (e: DragEvent, tag: string) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent, tag: string) => void;
}

function TagPill({
  tag, count, isActive, isDragOver, onToggle, onRename, onDelete,
  onDragOver, onDragLeave, onDrop,
}: TagPillProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        'shrink-0 inline-flex items-stretch rounded-full border overflow-hidden transition-all',
        isActive
          ? 'bg-primary border-primary text-white'
          : 'bg-card border-border text-muted-foreground',
        isDragOver && 'bg-primary-light border-primary text-primary shadow-[0_0_0_2px_var(--color-primary-light)]',
      )}
      onDragOver={(e) => onDragOver(e, tag)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, tag)}
    >
      <button
        data-testid={`tag-pill-${tag}`}
        aria-pressed={isActive}
        className="px-3 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap"
        onClick={() => onToggle(tag)}
      >
        {tag}
        <span className={cn('ml-1.5 tabular-nums', isActive ? 'opacity-80' : 'opacity-60')}>
          {count}
        </span>
      </button>
      {/* A visible trigger, not a right-click.
          The folder version opened its menu from `onContextMenu` and explicitly
          swallowed the click, so renaming or deleting one was impossible on a
          phone: there is no right-click, and a long press does not reliably fire
          contextmenu in a mobile browser. That is why tags could not be tidied up
          from the device most people use this on. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Actions for ${tag}`}
            className={cn(
              'px-2 text-xs leading-none cursor-pointer border-l',
              isActive
                ? 'border-white/30 hover:bg-primary-hover'
                : 'border-border hover:bg-panel hover:text-foreground',
            )}
          >
            &hellip;
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onRename(tag)}>Rename</DropdownMenuItem>
          <DropdownMenuItem
            className="text-danger hover:!bg-danger-light"
            onClick={() => onDelete(tag)}
          >
            Delete tag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}


interface SongMenuProps {
  song: Song;
  onDelete: (uuid: string) => void;
  onRename: (song: Song) => void;
  onEdit: (song: Song) => void;
  tags: string[];
  onToggleTag: (song: Song, tag: string) => void;
  onEditTags: (song: Song) => void;
  onSuggestTags: (song: Song) => void;
}

function SongMenu({ song, onDelete, onRename, onEdit, tags, onToggleTag, onEditTags, onSuggestTags }: SongMenuProps) {
  // Tagging and renaming a stored tab is ordinary housekeeping. Rewriting one and
  // asking an LLM about it are not: the backend refuses both with a 409, because
  // there is no chart text to send, so offering them here would only produce an
  // error a tap later.
  const isDocument = song.kind === 'document';
  const have = song.tags ?? [];
  const has = (t: string) => have.some(x => x.toLowerCase() === t.toLowerCase());
  // The tags already on the song first, then the rest. A menu that lists the
  // whole library's tags in name order buries the two this song actually has.
  const ordered = [...tags].sort((a, b) => Number(has(b)) - Number(has(a)));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="bg-transparent border border-border rounded-md cursor-pointer text-xl leading-none px-2.5 py-2 text-muted-foreground tracking-wider min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center hover:bg-panel hover:text-foreground"
          onClick={e => e.stopPropagation()}
          aria-label="Song actions"
        >
          &hellip;
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!isDocument && (
          <DropdownMenuItem onClick={() => onEdit(song)}>
            Rewrite
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onRename(song)}>
          Rename
        </DropdownMenuItem>
        {/* Premium renders a DropdownMenuItem here; OSS renders nothing, because
            a single local user has nobody to send anything to. Above the tag
            separator because sending is something you do to the song, and
            tagging is something you do to the library. */}
        <SongShareAction songUuids={[song.uuid]} variant="menu" />
        <DropdownMenuSeparator />
        {/* Toggles, not moves. A song carries as many tags as suit it, so the
            menu shows which are on and lets you switch each one, rather than
            offering a list of places to send it. Capped, because the whole
            library's tags in one dropdown is a scroll, not a menu. */}
        {ordered.slice(0, 8).map(t => (
          <DropdownMenuItem key={t} onClick={() => onToggleTag(song, t)}>
            {has(t) ? '\u2713\u00A0' : '\u00A0\u00A0\u00A0'}{t}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onEditTags(song)}>
          Edit tags&hellip;
        </DropdownMenuItem>
        {/* Sits with the manual tagging rather than on the import path: adding a
            chart is free and silent, and asking what to call it is a separate,
            paid thing you opt into per chart. The dialog names the price before
            it spends anything. */}
        {!isDocument && (
          <DropdownMenuItem onClick={() => onSuggestTags(song)}>
            Suggest tags with AI&hellip;
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger hover:!bg-danger-light" onClick={() => onDelete(song.uuid)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


type SortKey = 'date' | 'modified' | 'title' | 'artist';
type SortDir = 'asc' | 'desc';

/** Which axis the library is browsed along. 'songs' is the flat list filtered by
 *  tags; 'artists' shows an artist picker first and then that artist's charts. */
type BrowseMode = 'songs' | 'artists';
type ArtistSortKey = 'name' | 'count';

const BROWSE_MODES: ReadonlyArray<{ mode: BrowseMode; label: string }> = [
  { mode: 'songs', label: 'Songs' },
  { mode: 'artists', label: 'Artists' },
];

/**
 * The library's filters live in the query string.
 *
 * They used to be component state, which meant the view on screen had no
 * address: a reload, a link sent to someone else, or the browser's Back button
 * all landed in an unfiltered list. Everything that decides *which* charts are
 * shown, and in what order, is a parameter instead, and the component reads
 * those rather than keeping its own copy, so there is one source of truth and
 * the URL cannot fall out of step with what is rendered.
 *
 * Only non-default values are written, so an untouched library is still plain
 * /app/library. Anything unrecognised falls back to the default rather than
 * being trusted: these values arrive from whatever was pasted into the address
 * bar.
 */
type ViewParam = 'view' | 'artist' | 'tags' | 'q' | 'sort' | 'dir' | 'artistSort' | 'artistDir';

const BROWSE_MODE_VALUES: readonly BrowseMode[] = ['songs', 'artists'];
const SORT_KEYS: readonly SortKey[] = ['date', 'modified', 'title', 'artist'];
const ARTIST_SORT_KEYS: readonly ArtistSortKey[] = ['name', 'count'];
const SORT_DIRS: readonly SortDir[] = ['asc', 'desc'];

const DEFAULT_SORT_KEY: SortKey = 'date';
const DEFAULT_SORT_DIR: SortDir = 'desc';
const DEFAULT_ARTIST_SORT_KEY: ArtistSortKey = 'name';

/**
 * "Name" wants A first; "Charts" wants the artist with the most charts first.
 * Both are what the label means when it is picked, so the direction follows the
 * key rather than making the user fix it by hand every time. Applying it here,
 * as the default the `artistDir` parameter falls back to, means a hand-written
 * ?artistSort=count opens the way the control would have left it.
 */
function defaultArtistSortDir(key: ArtistSortKey): SortDir {
  return key === 'count' ? 'desc' : 'asc';
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export interface ArtistGroup {
  /** Normalised grouping key, and what `selectedArtist` holds. */
  key: string;
  /** Spelling shown on the card. */
  name: string;
  count: number;
}

/**
 * Buckets songs by artist.
 *
 * `artist` is free text, nullable, and often filled in by the `guessSongMeta`
 * heuristic rather than typed, so the same act arrives as "Neil Young",
 * "neil young" and " Neil Young ". Grouping on the raw string would show those
 * as three separate artists holding one chart each. The key is normalised and
 * the label is the spelling that occurs most often, so the version the user
 * actually typed wins over a stray capitalisation from an import.
 *
 * A tie is broken by code-unit order, which is deterministic (the label cannot
 * depend on the order the API returned the songs in) and puts every uppercase
 * letter ahead of its lowercase form. So a tie prefers the more capitalised
 * spelling at the first letter they differ on, not only at the first letter of
 * the name: "Neil Young" beats "neil young", and a three-way tie that includes
 * "NEIL YOUNG" picks that one. `localeCompare` would pick lowercase instead.
 *
 * Exported for tests.
 */
export function groupSongsByArtist(songs: Song[]): ArtistGroup[] {
  const buckets = new Map<string, { spellings: Map<string, number>; count: number }>();
  for (const song of songs) {
    const key = artistKeyOf(song.artist);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { spellings: new Map(), count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const raw = tidyArtist(song.artist);
    if (raw) bucket.spellings.set(raw, (bucket.spellings.get(raw) ?? 0) + 1);
  }

  const groups: ArtistGroup[] = [];
  for (const [key, bucket] of buckets) {
    let name = '';
    let best = 0;
    for (const [spelling, uses] of bucket.spellings) {
      if (uses > best || (uses === best && spelling < name)) {
        name = spelling;
        best = uses;
      }
    }
    groups.push({
      key,
      name: key === UNKNOWN_ARTIST_KEY ? 'Unknown artist' : name,
      count: bucket.count,
    });
  }
  return groups;
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'delete'; songUuid: string }
  | { kind: 'bulkDelete'; count: number }
  | { kind: 'rename'; song: Song }
  | { kind: 'newTag'; song?: Song }
  | { kind: 'renameTag'; tag: string }
  | { kind: 'deleteTag'; tag: string }
  | { kind: 'editTags'; song: Song }
  | { kind: 'suggestTags'; song: Song };

const SONGS_PER_PAGE = 20;

// Horizontal-scroll grid geometry.
// GRID_GAP_PX must match the `gap` set on the grid element below.
const GRID_GAP_PX = 12; // 0.75rem
// Used only for the first paint, before a card exists to measure. This was
// previously a hardcoded 76px used for every paint, which was 20px short of the
// height a card actually needs. Rows were `minmax(0, 1fr)` inside a fixed-height
// container, so the shortfall was taken out of every card by `overflow-hidden`,
// and the date is the last line in a card, so the date is what vanished.
const CARD_HEIGHT_FALLBACK_PX = 96;
// The width at which the horizontal grid earns its second column, and therefore the
// width below which it has nothing to offer. Shared with measureGrid's column count
// so the control cannot be offered at a width where the layout it switches to is
// still a single column.
const HORIZONTAL_MIN_WIDTH_PX = 1024;
const THREE_COLUMN_MIN_WIDTH_PX = 1536;

/** Whether the viewport is wide enough for the horizontal grid to lay out in more
 *  than one column. Initialised from `innerWidth` and kept current by a media query
 *  listener, matching the pattern in `ui/resizable-columns.tsx`. */
function useCanScrollHorizontally(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= HORIZONTAL_MIN_WIDTH_PX
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${HORIZONTAL_MIN_WIDTH_PX}px)`);
    const handler = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return wide;
}

interface ArtistCardProps {
  group: ArtistGroup;
  onSelect: (key: string) => void;
}

function ArtistCard({ group, onSelect }: ArtistCardProps) {
  return (
    <Card
      data-testid={`artist-card-${group.key}`}
      role="button"
      tabIndex={0}
      aria-label={`${group.name}, ${group.count} chart${group.count === 1 ? '' : 's'}`}
      className="p-3 cursor-pointer transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onSelect(group.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(group.key);
        }
      }}
    >
      {/* Wraps rather than truncates. This is a picker, and a name the user
          cannot read is a name they cannot pick: "Old Crow Medicine Show" is
          wider than a card at phone width. */}
      <h3 className="text-sm sm:text-base text-foreground leading-snug break-words">
        {group.name}
      </h3>
      <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
        {group.count} chart{group.count === 1 ? '' : 's'}
      </p>
    </Card>
  );
}

interface SongCardProps {
  /** True when this song's file is kept on the device for offline play. */
  keptOffline?: boolean;
  song: Song;
  selectMode: boolean;
  isSelected: boolean;
  isDragging: boolean;
  stretch?: boolean;
  onView: (song: Song) => void;
  onToggleSelect: (uuid: string) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, uuid: string) => void;
  onDragEnd: () => void;
  onDelete: (uuid: string) => void;
  onRename: (song: Song) => void;
  onEdit: (song: Song) => void;
  tags: string[];
  onToggleTag: (song: Song, tag: string) => void;
  onEditTags: (song: Song) => void;
  onSuggestTags: (song: Song) => void;
}

function SongCard({
  song, selectMode, isSelected, isDragging, stretch, keptOffline,
  onView, onToggleSelect, onDragStart, onDragEnd,
  onDelete, onRename, onEdit,
  tags, onToggleTag, onEditTags, onSuggestTags,
}: SongCardProps) {
  const date = new Date(song.created_at).toLocaleDateString();
  const artist = song.artist ? ` by ${song.artist}` : '';
  const isDocument = song.kind === 'document';
  // A document has no lyrics to preview, so the slot shows what it is instead.
  // Otherwise a stored tab reads as a chart that failed to import.
  const preview = isDocument ? '' : lyricsPreview(song.rewritten_content);

  return (
    <Card
      // Marks the card for the horizontal grid's row-height measurement, which
      // reads a real card instead of assuming one. See measureRowHeight.
      data-song-card=""
      className={cn(
        'group cursor-pointer transition-colors overflow-hidden min-w-0',
        stretch && 'h-full',
        isDragging && 'opacity-40',
        isSelected && 'border-primary bg-selected-bg'
      )}
      onClick={() => selectMode ? onToggleSelect(song.uuid) : onView(song)}
      draggable={!selectMode || undefined}
      onDragStart={!selectMode ? (e) => onDragStart(e, song.uuid) : undefined}
      onDragEnd={!selectMode ? onDragEnd : undefined}
    >
      <div className="flex justify-between items-center p-4 hover:bg-panel transition-colors">
        <label
          className={cn(
            'flex items-center pr-2 cursor-pointer shrink-0 transition-opacity',
            selectMode || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          onClick={e => e.stopPropagation()}
        >
          <Checkbox
            checked={isSelected}
            onChange={() => onToggleSelect(song.uuid)}
          />
        </label>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm sm:text-base mb-0.5 leading-snug">
            {/* Plain text, not an inline editor. Rename lives in the "..." menu.
                Tapping the title used to open a text input, which made the biggest
                target on the card do something other than open the song. */}
            <span>{song.title || 'Untitled'}</span>
            {artist}
          </h3>
          {isDocument && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              <span className="inline-flex items-center rounded border border-border px-1 py-px mr-1.5 text-[10px] uppercase tracking-wide">
                PDF
              </span>
              {song.file?.page_count
                ? `${song.file.page_count} page${song.file.page_count === 1 ? '' : 's'}`
                : 'Stored tab'}
              {/* Visible before you leave the house, which is the only time it is
                  useful to know. */}
              {keptOffline && (
                <span className="ml-1.5 text-[10px] uppercase tracking-wide">
                  &middot; Offline
                </span>
              )}
            </p>
          )}
          {preview && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
          )}
          {/* The last line in the card, so the first thing to disappear if a row
              is ever shorter than its card again. The e2e suite asserts on it. */}
          <span
            data-testid="song-card-date"
            className="text-xs text-muted-foreground font-[family-name:var(--font-data)] tabular-nums"
          >
            {date}
            {!isDocument && song.current_version > 1 ? ` \u00B7 v${song.current_version}` : ''}
            {(song.tags ?? []).length ? ` \u00B7 ${(song.tags ?? []).join(', ')}` : ''}
          </span>
        </div>
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <SongMenu
            song={song}
            onDelete={onDelete}
            onRename={onRename}
            onEdit={onEdit}
            tags={tags}
            onToggleTag={onToggleTag}
            onEditTags={onEditTags}
            onSuggestTags={onSuggestTags}
          />
        </div>
      </div>
    </Card>
  );
}

/** Byte count for a storage line. Decimal units, which is what phones report. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${Math.round(bytes / 1000)} KB`;
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

export function lyricsPreview(content: string): string {
  const lines = content.split('\n').filter(l => l.trim() && !/^\[.*\]$/.test(l.trim()));
  const preview = lines.slice(0, 2).join(' \u2022 ');
  return preview.length > 100 ? preview.slice(0, 100) + '\u2026' : preview;
}

export default function LibraryTab() {
  const ctx = useOutletContext<AppShellContext>();
  const onLoadSong = ctx.onLoadSong;
  const navigate = useNavigate();
  const location = useLocation();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragOverTag, setDragOverTag] = useState<string | null>(null);
  const [draggingSongUuid, setDraggingSongUuid] = useState<string | null>(null);
  // Tags the user just made that no song carries yet. A tag exists because a song
  // has it, so a brand new one would vanish the moment it was created if the list
  // came only from the songs.
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [keptOffline, setKeptOffline] = useState<Set<string>>(new Set());
  const [keptBytes, setKeptBytes] = useState(0);
  const selectMode = selectedUuids.size > 0;

  const [searchParams, setSearchParams] = useSearchParams();

  // The browse mode is both a URL parameter and a per-browser preference, and
  // the two answer different questions. The parameter says what this particular
  // link shows; the stored preference says where to open the library when the
  // link does not say. So a link naming the mode wins, and opening someone
  // else's link leaves your own default alone.
  //
  // Read once and then held for the life of the surface, even though the toggle
  // writes a new preference for next time. A URL with no `view` has to keep
  // meaning the same thing for as long as it is sitting in the history stack:
  // if switching to artists also moved this, pressing Back onto the plain
  // /app/library the session started from would land in artist mode and read as
  // Back having done nothing.
  const [rememberedMode] = useState<BrowseMode>(() =>
    localStorage.getItem(STORAGE_KEYS.LIBRARY_BROWSE_MODE) === 'artists' ? 'artists' : 'songs',
  );

  const searchQuery = searchParams.get('q') ?? '';
  // Comma separated in the URL, so a filtered library stays one linkable address.
  // AND, not OR: each tag you add narrows the list, which is what a tag row is for
  // once a library is big enough to need one.
  const activeTags = useMemo(
    () => (searchParams.get('tags') ?? '').split(',').map(t => t.trim()).filter(Boolean),
    [searchParams],
  );
  const browseMode = oneOf(searchParams.get('view'), BROWSE_MODE_VALUES, rememberedMode);
  // Which artist has been drilled into, as a normalised `artistKeyOf` key. Null
  // means the picker is showing. Narrowed to artist mode so the value always
  // means what its name says: `filteredSongs` ignores it in song mode anyway,
  // and this keeps a stale `artist` in a hand-edited URL from reaching the
  // reconciliation effect below and being cleared out of a view that never
  // showed it.
  const selectedArtist = browseMode === 'artists' ? searchParams.get('artist') : null;
  const sortKey = oneOf(searchParams.get('sort'), SORT_KEYS, DEFAULT_SORT_KEY);
  const sortDir = oneOf(searchParams.get('dir'), SORT_DIRS, DEFAULT_SORT_DIR);
  const artistSortKey = oneOf(searchParams.get('artistSort'), ARTIST_SORT_KEYS, DEFAULT_ARTIST_SORT_KEY);
  // Separate from `sortDir` rather than shared with it. The song list defaults to
  // descending because its default key is Created, and newest-first is what that
  // should mean. Pointing an A-to-Z list of artists the same way would open the
  // picker at Z.
  const artistSortDir = oneOf(
    searchParams.get('artistDir'),
    SORT_DIRS,
    defaultArtistSortDir(artistSortKey),
  );

  // Every filter change is one call to `applyView`. React Router resolves a
  // functional update against the parameters from the render the setter was
  // created in, not against anything an earlier call in the same handler has
  // already written, so two calls would silently keep only the second one's
  // changes. `pending` carries a write forward within a handler; the effect puts
  // it back in step after a Back or Forward, which never goes through here.
  const pending = useRef(searchParams);
  useEffect(() => {
    pending.current = searchParams;
  }, [searchParams]);

  /**
   * Writes filter parameters, dropping any that are null or empty.
   *
   * `push` is for the changes that read as going somewhere: switching axis,
   * opening an artist, picking a tag. Typing in the search box and changing
   * the sort stay on replace, because a history entry per keystroke would leave
   * Back unable to get out of the library.
   */
  const applyView = useCallback(
    (changes: Partial<Record<ViewParam, string | null>>, options?: { push?: boolean }) => {
      const next = new URLSearchParams(pending.current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      pending.current = next;
      setSearchParams(next, { replace: !options?.push });
    },
    [setSearchParams],
  );

  const setSearchQuery = useCallback((value: string) => {
    applyView({ q: value });
  }, [applyView]);

  /** Add or remove one tag from the filter, keeping the rest. */
  const toggleTag = useCallback((tag: string) => {
    const next = activeTags.includes(tag)
      ? activeTags.filter(t => t !== tag)
      // Untagged is not a tag, so it cannot be combined with one: no song is both.
      // Picking it replaces the filter rather than producing an empty list nobody
      // asked for.
      : tag === UNTAGGED || activeTags.includes(UNTAGGED)
        ? [tag]
        : [...activeTags, tag];
    applyView({ tags: next.length ? next.join(',') : null }, { push: true });
  }, [activeTags, applyView]);

  const clearTags = useCallback(() => {
    applyView({ tags: null }, { push: true });
  }, [applyView]);

  const setSortKey = useCallback((key: SortKey) => {
    applyView({ sort: key === DEFAULT_SORT_KEY ? null : key });
  }, [applyView]);

  const setSortDir = useCallback((dir: SortDir) => {
    applyView({ dir: dir === DEFAULT_SORT_DIR ? null : dir });
  }, [applyView]);

  const setArtistSortDir = useCallback((dir: SortDir) => {
    applyView({ artistDir: dir === defaultArtistSortDir(artistSortKey) ? null : dir });
  }, [applyView, artistSortKey]);

  const [page, setPage] = useState(0);
  const [dialogState, setDialogState] = useState<DialogState>({ kind: 'none' });
  const [scrollDir, setScrollDir] = useState<'vertical' | 'horizontal'>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.LIBRARY_LAYOUT);
    return stored === 'horizontal' ? 'horizontal' : 'vertical';
  });
  const canScrollHorizontally = useCanScrollHorizontally();
  // Below the breakpoint the horizontal grid is one column wide, so it cannot lay
  // charts out any differently from the vertical list. It only moves some of them
  // off the right edge behind a sideways swipe. The stored preference is left
  // alone rather than rewritten, so a phone visit does not wipe the choice made
  // on a desktop, and this is derived rather than a second piece of state so a
  // stored 'horizontal' cannot strand a phone user with no control to escape it.
  const layout = canScrollHorizontally ? scrollDir : 'vertical';
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRows, setVisibleRows] = useState(5);

  const toggleScrollDir = useCallback(() => {
    setScrollDir(prev => {
      const next = prev === 'vertical' ? 'horizontal' : 'vertical';
      localStorage.setItem(STORAGE_KEYS.LIBRARY_LAYOUT, next);
      return next;
    });
  }, []);

  const containerClass = layout === 'horizontal' ? 'w-full' : 'max-w-[1120px] mx-auto w-full';

  // Calculate grid dimensions from the screen:
  // - Column width matches the original responsive breakpoints (2 at lg, 3 at 2xl)
  // - Row count fills the available viewport height
  const [gridHeight, setGridHeight] = useState<number>(400);
  const [colWidth, setColWidth] = useState<number>(400);
  const [cardHeight, setCardHeight] = useState<number>(CARD_HEIGHT_FALLBACK_PX);
  const measureGrid = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    // Measure from grid top to bottom of the <main> container (excludes footer + main padding).
    // `main` is `flex-1` inside a viewport-height shell, so its bottom does not move
    // when the grid's own height changes. That keeps this stable rather than feeding
    // back into itself.
    const mainEl = el.closest('main');
    const bottomEdge = mainEl
      ? mainEl.getBoundingClientRect().bottom - parseFloat(getComputedStyle(mainEl).paddingBottom)
      : window.innerHeight;
    const top = el.getBoundingClientRect().top;
    const available = bottomEdge - top;
    const clamped = Math.max(200, available);
    setGridHeight(clamped);

    // Width: match the original responsive column count (2 at lg, 3 at 2xl)
    // Use the grid's own clientWidth (includes the negative margin bleed)
    const containerWidth = el.clientWidth;
    const vw = window.innerWidth;
    const cols = vw >= THREE_COLUMN_MIN_WIDTH_PX ? 3 : vw >= HORIZONTAL_MIN_WIDTH_PX ? 2 : 1;
    setColWidth(Math.floor((containerWidth - GRID_GAP_PX * (cols - 1)) / cols));
  }, []);

  // Row height is measured separately, and deliberately after the column width
  // has landed in the DOM. A card's height depends on its width, because a long
  // title wraps to a second line. Measuring both in one pass read the height at
  // the *previous* width, which overestimated it and cost a whole row of songs.
  const measureRowHeight = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    // Read the card's inner content div, not the card box. The box is stretched
    // to fill its row by `h-full`, so measuring it would ratchet: each pass would
    // read back the height the previous pass set.
    //
    // Every card is measured, not a sample. The tallest one sets the row height,
    // and it can be anywhere in the list: on a phone the single column is narrow
    // enough that a long title wraps, and sampling the first 12 left a card
    // further down clipped. These are consecutive reads with no interleaved
    // writes, so they cost one layout pass regardless of count.
    let contentHeight = 0;
    for (const card of el.querySelectorAll('[data-song-card]')) {
      const content = card.firstElementChild;
      if (content) contentHeight = Math.max(contentHeight, content.getBoundingClientRect().height);
    }
    const rowHeight = contentHeight > 0 ? Math.ceil(contentHeight) : CARD_HEIGHT_FALLBACK_PX;
    setCardHeight(rowHeight);
    // n rows have only n-1 gaps between them, so the gap is added back first.
    setVisibleRows(Math.max(1, Math.floor((gridHeight + GRID_GAP_PX) / (rowHeight + GRID_GAP_PX))));
  }, [gridHeight]);

  // Callback ref: fires when the horizontal grid mounts/unmounts
  const setGridRef = useCallback((node: HTMLDivElement | null) => {
    gridRef.current = node;
    if (node) measureGrid();
  }, [measureGrid]);

  useEffect(() => {
    if (layout !== 'horizontal') return;
    window.addEventListener('resize', measureGrid);
    return () => window.removeEventListener('resize', measureGrid);
  }, [layout, measureGrid]);

  // Records which surface a PWA relaunch should return to, the same way PlayPage
  // and RewriteTab do. The library was the one surface that never registered, so
  // quitting from it left whatever the user had visited before it as the "last"
  // surface, and the relaunch reopened that instead. Anyone who had ever
  // workshopped a song came back to the rewrite editor forever after.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LAST_SURFACE, 'library');
  }, []);

  const loadSongs = useCallback(() => {
    setLoadError(null);
    api.listSongs().then(data => {
      setSongs(data);
      setLoaded(true);
    }).catch((err: unknown) => {
      // Previously this swallowed the error and just set loaded, so songs stayed
      // [] and the "your library is empty" state rendered. A user with 200 charts
      // and a flaky connection, or an expired session, was told their library was
      // empty and invited to add their first song.
      setLoadError((err as Error)?.message || 'Could not load your library.');
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);


  // Case-folded, because the pill row shows one entry per spelling but two
  // spellings of the same tag are the same tag to the server.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const song of songs) {
      for (const t of song.tags ?? []) {
        const key = t.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [songs]);

  const tags = useMemo(() => {
    const names = new Set(localTags);
    for (const s of songs) {
      for (const t of s.tags ?? []) names.add(t);
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [songs, localTags]);

  const artistGroups = useMemo(() => groupSongsByArtist(songs), [songs]);

  // Gated on the bucket being open, not just memoised: this walks every song
  // against every artist name in the library, and the answer is only ever shown
  // on one screen.
  const namableCount = useMemo(() => {
    if (selectedArtist !== UNKNOWN_ARTIST_KEY) return 0;
    return buildProposals(songs).filter(p => p.artistSource !== null).length;
  }, [selectedArtist, songs]);

  const artistLookup = useMemo(
    () => new Map(artistGroups.map(g => [g.key, g])),
    [artistGroups],
  );

  const visibleArtists = useMemo(() => {
    let result = artistGroups;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => a.name.toLowerCase().includes(q));
    }
    const sorted = [...result].sort((a, b) => {
      if (artistSortKey === 'count') {
        // The direction applies to the count alone. Artists holding the same
        // number of charts stay alphabetical whichever way the arrow points:
        // flipping it asks a question about counts, and reversing the tiebreak
        // along with it just reads as the list having shuffled itself.
        const byCount = artistSortDir === 'asc' ? a.count - b.count : b.count - a.count;
        return byCount || a.name.localeCompare(b.name);
      }
      const cmp = a.name.localeCompare(b.name);
      return artistSortDir === 'asc' ? cmp : -cmp;
    });
    // "Unknown artist" sorts last whichever way the list is pointing. It is a
    // bucket for charts that were never labelled, not an artist, and someone
    // reversing the sort is asking about artists, not asking to be handed the
    // unlabelled pile first.
    const unknownAt = sorted.findIndex(a => a.key === UNKNOWN_ARTIST_KEY);
    if (unknownAt >= 0) sorted.push(...sorted.splice(unknownAt, 1));
    return sorted;
  }, [artistGroups, searchQuery, artistSortKey, artistSortDir]);

  // True when the artist picker itself is on screen, rather than a song list.
  const showingArtistPicker = browseMode === 'artists' && selectedArtist === null;
  // The one direction button drives whichever list is on screen.
  const activeSortDir = showingArtistPicker ? artistSortDir : sortDir;

  const filteredSongs = useMemo(() => {
    let result = songs;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q)
      );
    }
    // Artist and tags are either/or: only one of them is reachable at a time,
    // because only one of the two is ever on screen to explain an empty list.
    if (browseMode === 'artists') {
      if (selectedArtist) result = result.filter(s => artistKeyOf(s.artist) === selectedArtist);
    } else if (activeTags.includes(UNTAGGED)) {
      result = result.filter(s => (s.tags ?? []).length === 0);
    } else if (activeTags.length) {
      // Every selected tag, not any. Compared case-insensitively, the same way
      // the server does, so a link written by hand still matches.
      const wanted = activeTags.map(t => t.toLowerCase());
      result = result.filter(s => {
        const have = (s.tags ?? []).map(t => t.toLowerCase());
        return wanted.every(t => have.includes(t));
      });
    }
    return result;
  }, [songs, searchQuery, activeTags, browseMode, selectedArtist]);

  // Reset page when filters/sorting change
  useEffect(() => { setPage(0); }, [searchQuery, activeTags, sortKey, sortDir, browseMode, selectedArtist]);

  // An artist can vanish under the drilled-in view: delete its last chart, or
  // retitle the artist from the song menu, and `selectedArtist` would keep
  // filtering the list down to nothing with a breadcrumb naming an artist that
  // no longer exists. Fall back to the picker instead.
  //
  // Gated on `loaded`, which matters now that the artist can arrive in the URL:
  // before the fetch lands there are no songs, so every artist looks deleted and
  // a shared link would clear itself before it could ever be shown.
  useEffect(() => {
    if (!loaded) return;
    if (selectedArtist && !artistLookup.has(selectedArtist)) applyView({ artist: null });
  }, [loaded, selectedArtist, artistLookup, applyView]);

  const sortedSongs = useMemo(() => {
    const sorted = [...filteredSongs].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'title':
          cmp = (a.title || '').localeCompare(b.title || '');
          break;
        case 'artist':
          cmp = (a.artist || '').localeCompare(b.artist || '');
          break;
        case 'modified':
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
        case 'date':
        default:
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredSongs, sortKey, sortDir]);

  const totalPages = Math.ceil(sortedSongs.length / SONGS_PER_PAGE);
  const pagedSongs = sortedSongs.slice(page * SONGS_PER_PAGE, (page + 1) * SONGS_PER_PAGE);

  // Measure the row height once the width and available height are in the DOM,
  // and again whenever either changes or the rendered set does. Which card is
  // tallest moves with the search and tag filters: a long title wraps at a
  // narrow column width, and a chart with no lyrics preview is a line shorter.
  // This converges in one extra pass, because measureRowHeight does not feed
  // back into either colWidth or gridHeight.
  useEffect(() => {
    if (layout !== 'horizontal') return;
    measureRowHeight();
  }, [layout, measureRowHeight, colWidth, sortedSongs]);

  const refreshKept = useCallback(async () => {
    try {
      const [kept, bytes] = await Promise.all([api.keptSongFiles(), api.keptSongFilesSize()]);
      setKeptOffline(kept);
      setKeptBytes(bytes);
    } catch {
      /* Offline storage is optional; the library works without it. */
    }
  }, []);

  useEffect(() => {
    void refreshKept();
  }, [refreshKept]);

  const forgetAllKept = useCallback(async () => {
    await Promise.all([...keptOffline].map((uuid) => api.forgetSongFileOffline(uuid)));
    await refreshKept();
  }, [keptOffline, refreshKept]);

  const handleUploadFiles = useCallback(async (files: FileList | null) => {
    const profileId = ctx.profile?.id;
    if (!files?.length || !profileId) return;
    setUploadError(null);
    setUploading(true);
    // Sequential, not Promise.all. Somebody adding a folder of tabs off their
    // disk is uploading
    // megabytes per file, and firing twenty of those at once on a phone connection
    // is how they all time out together.
    const added: Song[] = [];
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        added.push(await api.uploadDocument(profileId, file));
      } catch (err) {
        failed.push(`${file.name}: ${(err as Error)?.message ?? 'upload failed'}`);
      }
    }
    if (added.length) setSongs(prev => [...added, ...prev]);
    // Partial success is the common case with a multi-file drop, so the ones that
    // worked are kept and only the failures are named.
    if (failed.length) setUploadError(failed.join('; '));
    setUploading(false);
  }, [ctx.profile?.id]);

  const handlePlay = useCallback((song: Song) => {
    navigate(`/app/play/${song.uuid}`, {
      // `from` is the same courtesy for the play route, which is full-screen and
      // has its own back button. Without it, playing a chart out of an artist or
      // a tag and coming back drops the filter.
      state: {
        title: song.title,
        artist: song.artist,
        from: `/app/library${location.search}`,
      },
    });
  }, [navigate, location.search]);



  const handleDeleteRequest = (uuid: string) => {
    setDialogState({ kind: 'delete', songUuid: uuid });
  };

  const handleDeleteConfirmed = async (uuid: string) => {
    try {
      await api.deleteSong(uuid);
      setSongs(prev => prev.filter(s => s.uuid !== uuid));
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
    }
  };

  const handleSongUpdated = (updated: Song) => {
    setSongs(prev => prev.map(s => s.uuid === updated.uuid ? updated : s));
  };

  const handleRenameRequest = (song: Song) => {
    setDialogState({ kind: 'rename', song });
  };

  const handleRenameConfirmed = async (song: Song, values: Record<string, string>) => {
    try {
      const updates: Record<string, string | null> = {};
      const newTitle = (values.title ?? '').trim();
      const newArtist = (values.artist ?? '').trim();
      if (newTitle !== (song.title || '')) updates.title = newTitle || null;
      if (newArtist !== (song.artist || '')) updates.artist = newArtist || null;
      if (Object.keys(updates).length === 0) return;
      const updated = await api.updateSong(song.uuid, updates as Partial<Song>);
      handleSongUpdated(updated);
    } catch (err) {
      toast.error('Failed to rename: ' + (err as Error).message);
    }
  };

  /** Replace a song's whole tag set. The API takes the set, not a delta. */
  const setSongTags = async (song: Song, next: string[]) => {
    try {
      const updated = await api.updateSong(song.uuid, { tags: next } as Partial<Song>);
      handleSongUpdated(updated);
      return updated;
    } catch (err) {
      toast.error('Failed to save tags: ' + (err as Error).message);
      return null;
    }
  };

  /** Add one tag if it is missing, remove it if it is there. */
  const handleToggleSongTag = async (song: Song, tag: string) => {
    const have = song.tags ?? [];
    const next = have.some(t => t.toLowerCase() === tag.toLowerCase())
      ? have.filter(t => t.toLowerCase() !== tag.toLowerCase())
      : [...have, tag];
    await setSongTags(song, next);
  };

  const handleEditTags = (song: Song) => setDialogState({ kind: 'editTags', song });
  const handleSuggestTagsRequest = (song: Song) => setDialogState({ kind: 'suggestTags', song });

  const handleDragStart = (e: DragEvent<HTMLDivElement>, songUuid: string) => {
    e.dataTransfer.setData('text/plain', songUuid);
    // Copy, not move. Dropping a song on a tag adds that tag; it does not take
    // the song out of anything, because it was never in one place to begin with.
    e.dataTransfer.effectAllowed = 'copy';
    setDraggingSongUuid(songUuid);
  };

  const handleDragEnd = () => {
    setDraggingSongUuid(null);
    setDragOverTag(null);
  };

  const handleTagDragOver = (e: DragEvent, tag: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverTag(tag);
  };

  const handleTagDragLeave = () => setDragOverTag(null);

  const handleTagDrop = async (e: DragEvent, tag: string) => {
    e.preventDefault();
    setDragOverTag(null);
    const songUuid = e.dataTransfer.getData('text/plain');
    if (!songUuid) return;
    const song = songs.find(s => s.uuid === songUuid);
    if (!song) return;
    const have = song.tags ?? [];
    // Adding a tag a song already has is a no-op rather than a removal. A drop is
    // a statement about where the song belongs, not a toggle, and silently
    // untagging something because it was dropped on the wrong pill is the sort of
    // thing nobody notices until the tag is empty.
    if (have.some(t => t.toLowerCase() === tag.toLowerCase())) return;
    await setSongTags(song, [...have, tag]);
  };

  const handleCreateTag = () => {
    setDialogState({
      kind: 'newTag',
      song: draggingSongUuid ? songs.find(s => s.uuid === draggingSongUuid) : undefined,
    });
  };

  const handleRenameTagRequest = (tag: string) => setDialogState({ kind: 'renameTag', tag });

  const handleRenameTagConfirmed = async (oldName: string, values: Record<string, string>) => {
    const newName = (values.name ?? '').trim();
    if (!newName || newName === oldName) return;
    try {
      await api.renameTag(oldName, newName);
      setSongs(prev =>
        prev.map(s => {
          const have = s.tags ?? [];
          if (!have.some(t => t.toLowerCase() === oldName.toLowerCase())) return s;
          const renamed = have.filter(t => t.toLowerCase() !== oldName.toLowerCase());
          // The rename may have merged onto a tag the song already had, which is
          // what the server does rather than refusing.
          if (!renamed.some(t => t.toLowerCase() === newName.toLowerCase())) renamed.push(newName);
          return { ...s, tags: renamed.sort() };
        }),
      );
      setLocalTags(prev => prev.map(t => (t === oldName ? newName : t)));
      // Replace rather than push. The tag moved under the view; the user did not
      // go anywhere. A pushed entry leaves Back pointing at a name that no longer
      // exists, and the list under it is empty with no pill to clear.
      if (activeTags.includes(oldName)) {
        applyView({ tags: activeTags.map(t => (t === oldName ? newName : t)).join(',') });
      }
    } catch (err) {
      toast.error('Failed to rename tag: ' + (err as Error).message);
    }
  };

  const handleDeleteTagRequest = (tag: string) => setDialogState({ kind: 'deleteTag', tag });

  const handleDeleteTagConfirmed = async (tag: string) => {
    try {
      await api.deleteTag(tag);
      setSongs(prev =>
        prev.map(s => ({
          ...s,
          tags: (s.tags ?? []).filter(t => t.toLowerCase() !== tag.toLowerCase()),
        })),
      );
      setLocalTags(prev => prev.filter(t => t !== tag));
      // Replace, for the same reason as the rename above.
      if (activeTags.includes(tag)) {
        const rest = activeTags.filter(t => t !== tag);
        applyView({ tags: rest.length ? rest.join(',') : null });
      }
    } catch (err) {
      toast.error('Failed to delete tag: ' + (err as Error).message);
    }
  };

  const handleNewTagConfirmed = (values: Record<string, string>, song?: Song) => {
    const trimmed = (values.name ?? '').trim();
    if (!trimmed) return;
    if (song) {
      void handleToggleSongTag(song, trimmed);
    } else {
      // Nothing carries it yet, so it would vanish on the next render if the pill
      // row read only from the songs.
      setLocalTags(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    }
  };

  const handleBrowseModeChange = useCallback((mode: BrowseMode) => {
    // Tapping the half that is already lit is a no-op, not a reset. Both halves
    // stay clickable so the pair reads as one control, and without this a tap on
    // the current mode threw away the tag filter and the search query with it.
    if (mode === browseMode) return;
    localStorage.setItem(STORAGE_KEYS.LIBRARY_BROWSE_MODE, mode);
    setSelectedUuids(new Set());
    // Both filters are cleared on every switch, not just the one being left.
    // Carrying a tag into artist mode would silently narrow the artist list
    // with nothing on screen saying so, and carrying an artist back into song
    // mode would do the same to the songs. The search box is shared but the two
    // modes search different things: a query that found songs almost never
    // matches an artist name, so keeping it would drop the user into an empty
    // picker the moment they switched.
    //
    // `view` is written out even for the default mode. An absent parameter means
    // "whatever this browser last chose", so leaving it off would make the URL
    // say something weaker than what is on screen.
    applyView({ view: mode, artist: null, tags: null, q: null }, { push: true });
  }, [browseMode, applyView]);

  // Clearing `artistDir` rather than setting it hands the direction back to
  // `defaultArtistSortDir`, so picking a key still points the list the way that
  // key means.
  const handleArtistSortKeyChange = useCallback((key: ArtistSortKey) => {
    applyView({ artistSort: key === DEFAULT_ARTIST_SORT_KEY ? null : key, artistDir: null });
  }, [applyView]);

  const handleSelectArtist = useCallback((key: string) => {
    // The query that found the artist would go on to filter their charts, which
    // is not what picking an artist asks for.
    applyView({ artist: key, q: null }, { push: true });
  }, [applyView]);

  const handleClearArtist = useCallback(() => {
    setSelectedUuids(new Set());
    applyView({ artist: null, q: null }, { push: true });
  }, [applyView]);

  const toggleSelect = (songUuid: string) => {
    setSelectedUuids(prev => {
      const next = new Set(prev);
      if (next.has(songUuid)) next.delete(songUuid);
      else next.add(songUuid);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedUuids(new Set(filteredSongs.map(s => s.uuid)));
  };

  const clearSelection = () => {
    setSelectedUuids(new Set());
  };

  const handleBulkDeleteRequest = () => {
    setDialogState({ kind: 'bulkDelete', count: selectedUuids.size });
  };

  const handleBulkDeleteConfirmed = async () => {
    try {
      await Promise.all([...selectedUuids].map(uuid => api.deleteSong(uuid)));
      setSongs(prev => prev.filter(s => !selectedUuids.has(s.uuid)));
      setSelectedUuids(new Set());
    } catch (err) {
      toast.error('Failed to delete some songs: ' + (err as Error).message);
    }
  };

  const handleBulkTag = async (tag: string, add: boolean) => {
    try {
      const results = await Promise.all(
        [...selectedUuids].map(uuid => {
          const song = songs.find(s => s.uuid === uuid);
          const have = song?.tags ?? [];
          const next = add
            ? (have.some(t => t.toLowerCase() === tag.toLowerCase()) ? have : [...have, tag])
            : have.filter(t => t.toLowerCase() !== tag.toLowerCase());
          return api.updateSong(uuid, { tags: next } as Partial<Song>);
        })
      );
      setSongs(prev => prev.map(s => {
        const updated = results.find(r => r.uuid === s.uuid);
        return updated || s;
      }));
      setSelectedUuids(new Set());
    } catch (err) {
      toast.error('Failed to move some songs: ' + (err as Error).message);
    }
  };

  // Rename dialog fields
  const renameFields: PromptField[] = useMemo(() => {
    if (dialogState.kind !== 'rename') return [];
    return [
      { key: 'title', label: 'Song title', defaultValue: dialogState.song.title || '', placeholder: 'Song title' },
      { key: 'artist', label: 'Artist', defaultValue: dialogState.song.artist || '', placeholder: 'Artist' },
    ];
  }, [dialogState]);

  const newTagFields: PromptField[] = useMemo(() => [
    { key: 'name', label: 'Tag name', placeholder: 'Enter tag name' },
  ], []);

  const renameTagFields: PromptField[] = useMemo(() => {
    if (dialogState.kind !== 'renameTag') return [];
    return [{ key: 'name', label: 'Tag name', defaultValue: dialogState.tag, placeholder: 'New tag name' }];
  }, [dialogState]);

  // --- Loading ---
  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <Spinner />
        <span className="text-sm">Loading songs...</span>
      </div>
    );
  }

  // --- Load failure ---
  // Distinct from "empty": an error must never be presented as an empty library.
  if (loadError) {
    return (
      <div className="text-center py-16 px-8">
        <h3 className="font-display text-lg font-semibold text-foreground mb-2">
          Could not load your library
        </h3>
        <p className="text-muted-foreground mb-4">
          Your charts are safe. This is a problem reaching the server.
        </p>
        <Button variant="default" onClick={loadSongs}>
          Try again
        </Button>
      </div>
    );
  }

  // --- Song List ---
  if (songs.length === 0) {
    return (
      <div className="text-center py-16 px-8">
      {/* One input for both entry points. accept is a hint the picker uses; the
          backend decides for real by reading the file header. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        data-testid="tab-upload-input"
        onChange={e => {
          void handleUploadFiles(e.target.files);
          // Cleared so picking the same file twice in a row still fires a change.
          e.target.value = '';
        }}
      />
        <h3 className="font-display text-lg font-semibold text-foreground mb-2">Your library is empty</h3>
        <p className="text-muted-foreground mb-4">
          Import a chord chart to get started, or store a tab PDF you already have.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button variant="default" onClick={() => navigate('/app/rewrite')}>
            Import a chart
          </Button>
          <Button
            variant="secondary"
            disabled={uploading || !ctx.profile}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? 'Adding...' : 'Add a tab PDF'}
          </Button>
        </div>
        {uploadError && <p className="text-sm text-danger mt-3">{uploadError}</p>}
      </div>
    );
  }

  const hasUntagged = songs.some(s => (s.tags ?? []).length === 0);
  const hasTags = tags.length > 0;

  return (
    <div className={cn('flex flex-col gap-4', containerClass, layout === 'horizontal' && 'h-full min-h-0')}>
      {/* Chart-count status. Inert in OSS; premium renders a count as the plan cap
          approaches and an explanation once it is passed. The library owns the
          count, so it is passed in rather than refetched. */}
      <SongCapNotice count={songs.length} />
      {/* Songs somebody sent you. Renders nothing when the inbox is empty, so this
          costs the one screen everybody opens exactly nothing until it has
          something to say. Accepting creates songs, hence the reload. */}
      <SongShareNotice onSongsChanged={loadSongs} />
      {/* One input for both entry points. accept is a hint the picker uses; the
          backend decides for real by reading the file header. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        data-testid="tab-upload-input"
        onChange={e => {
          void handleUploadFiles(e.target.files);
          // Cleared so picking the same file twice in a row still fires a change.
          e.target.value = '';
        }}
      />
      {uploadError && (
        <p className="text-sm text-danger" role="alert">
          {uploadError}
        </p>
      )}
      {/* Only when something is kept. Storage you are using is worth seeing where
          you manage the things using it, and invisible megabytes on a phone are
          how a music app becomes the one you delete. */}
      {keptOffline.size > 0 && (
        <p className="text-xs text-muted-foreground">
          {keptOffline.size} tab{keptOffline.size === 1 ? '' : 's'} kept on this device
          {keptBytes > 0 && ` \u00B7 ${formatBytes(keptBytes)}`}
          {' \u00B7 '}
          <button
            type="button"
            onClick={() => void forgetAllKept()}
            className="underline hover:text-foreground cursor-pointer"
          >
            Remove all
          </button>
        </p>
      )}
      <div className="flex flex-col gap-2">
        {/* Row one is the view controls: what you are looking at, in what order,
            and the two things you can add. Below the sm breakpoint the search box
            takes the line to itself. Sharing it with the sort controls left it
            about three words wide and cropped its own placeholder mid-word. */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder={showingArtistPicker ? 'Search artists...' : 'Search songs by title or artist...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-card basis-full sm:basis-0 sm:flex-1 min-w-0"
          />
          {/* Which axis the library is browsed along. It sits with the sort and
              layout controls because it changes the view rather than filtering it,
              and it is a segmented control rather than another pill.

              It used to lead the tag row, which was the whole problem: an
              active "Songs" and an active "All" were the same brown pill sitting
              side by side in one strip, so a mode switch and a tag filter read
              as one set of nine options with two of them chosen. */}
          <div
            className="inline-flex shrink-0 items-center rounded-md border border-border bg-panel p-0.5"
            role="group"
            aria-label="Browse by"
          >
            {BROWSE_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                data-testid={`browse-mode-${mode}`}
                aria-pressed={browseMode === mode}
                className={cn(
                  'rounded-sm px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors whitespace-nowrap',
                  browseMode === mode
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => handleBrowseModeChange(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Key and direction are one control, so they are grouped: they stay
              adjacent, and a wrap breaks before them rather than between them. */}
          <div className="flex shrink-0 items-center gap-1">
            {/* The picker lists artists, so it gets the two orderings that mean
                something for artists. The sort direction button is shared, because
                it means the same thing in both. */}
            {showingArtistPicker ? (
              <Select
                className="w-auto py-2 px-2 text-xs"
                value={artistSortKey}
                onChange={(e) => handleArtistSortKeyChange(e.target.value as ArtistSortKey)}
                aria-label="Sort artists by"
              >
                <option value="name">Name</option>
                <option value="count">Charts</option>
              </Select>
            ) : (
              <Select
                className="w-auto py-2 px-2 text-xs"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                aria-label="Sort songs by"
              >
                <option value="date">Created</option>
                <option value="modified">Modified</option>
                <option value="title">Title</option>
                <option value="artist">Artist</option>
              </Select>
            )}
            {/* rounded-md, not the button default, so the row's corners agree with
                the input and the select it sits against. */}
            <Button
              variant="secondary"
              size="sm"
              className="rounded-md"
              onClick={() => {
                const next = activeSortDir === 'asc' ? 'desc' : 'asc';
                if (showingArtistPicker) setArtistSortDir(next);
                else setSortDir(next);
              }}
              title={activeSortDir === 'asc' ? 'Ascending' : 'Descending'}
              aria-label={activeSortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
            >
              {activeSortDir === 'asc' ? '\u2191' : '\u2193'}
            </Button>
          </div>
          {/* Also reachable from the Import screen's File tab. This one is here
              because filing a tab you already have is library housekeeping, and
              somebody adding a folder of them off their disk should not have
              to leave. */}
          {!showingArtistPicker && (
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 rounded-md"
              disabled={uploading || !ctx.profile}
              onClick={() => fileInputRef.current?.click()}
              title="Store a tab PDF in your library"
            >
              {uploading ? 'Adding\u2026' : '+ Tab'}
            </Button>
          )}
          {/* Hidden below the breakpoint rather than shown and made inert. At phone
              width the grid it switches to is still one column, so the control
              could only move charts off the right edge behind a sideways swipe. A
              disabled button would still be asking the question. */}
          {/* The picker uses a plain wrapping grid rather than either song layout,
              so the control would toggle a preference with nothing to apply it to. */}
          {canScrollHorizontally && !showingArtistPicker && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleScrollDir}
              title={layout === 'vertical' ? 'Switch to horizontal scroll' : 'Switch to vertical scroll'}
              aria-label={layout === 'vertical' ? 'Switch to horizontal scroll' : 'Switch to vertical scroll'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                {layout === 'vertical' ? (
                  <>
                    <rect x="2" y="3" width="12" height="10" rx="1" />
                    <line x1="5" y1="3" x2="5" y2="13" />
                    <line x1="11" y1="3" x2="11" y2="13" />
                  </>
                ) : (
                  <>
                    <rect x="2" y="3" width="12" height="10" rx="1" />
                    <line x1="4" y1="6" x2="12" y2="6" />
                    <line x1="4" y1="8" x2="12" y2="8" />
                    <line x1="4" y1="10" x2="9" y2="10" />
                  </>
                )}
              </svg>
            </Button>
          )}
        </div>
        {/* Row two is what the list is narrowed to: tags, or the artist that
            was drilled into. One kind of thing per row, so an active tag is
            the only brown pill on screen and means one thing.

            It scrolls sideways on a phone and wraps on a wider screen. Wrapping
            at phone width pushed five tags plus "+ New Tag" onto three
            lines and cost a fifth of the viewport before the first song. Wrapping
            is kept above the breakpoint because dragging a song onto a tag
            needs every tag visible, and that gesture is mouse-only anyway. */}
        {(browseMode === 'songs' || selectedArtist) && (
        <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {browseMode === 'artists' && selectedArtist && (
            <div className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap">
              <button
                data-testid="artist-back"
                className={TAG_PILL_CLASS}
                onClick={handleClearArtist}
              >
                &larr; All artists
              </button>
              <span className="text-muted-foreground" aria-hidden="true">/</span>
              <span className="font-semibold text-foreground">
                {artistLookup.get(selectedArtist)?.name ?? 'Unknown artist'}
              </span>
              <span className="text-muted-foreground tabular-nums">
                ({artistLookup.get(selectedArtist)?.count ?? 0})
              </span>
            </div>
          )}
          {browseMode === 'songs' && hasTags && (
            <button
              className={cn(TAG_PILL_CLASS, activeTags.length === 0 && TAG_PILL_ACTIVE)}
              onClick={clearTags}
            >
              All
            </button>
          )}
          {browseMode === 'songs' && tags.map(t => (
            <TagPill
              key={t}
              tag={t}
              count={tagCounts.get(t.toLowerCase()) ?? 0}
              isActive={activeTags.includes(t)}
              isDragOver={dragOverTag === t}
              onToggle={toggleTag}
              onRename={handleRenameTagRequest}
              onDelete={handleDeleteTagRequest}
              onDragOver={handleTagDragOver}
              onDragLeave={handleTagDragLeave}
              onDrop={handleTagDrop}
            />
          ))}
          {browseMode === 'songs' && hasTags && hasUntagged && (
            <button
              className={cn(TAG_PILL_CLASS, activeTags.includes(UNTAGGED) && TAG_PILL_ACTIVE)}
              onClick={() => toggleTag(UNTAGGED)}
            >
              Untagged
            </button>
          )}
          {/* Divides making a tag from choosing one. Both are pills in the same
              row, and dashed alone was not enough to stop "+ New Tag" reading as
              the last tag in the list. */}
          {browseMode === 'songs' && hasTags && (
            <span aria-hidden="true" className="shrink-0 w-px h-5 bg-border mx-0.5" />
          )}
          {browseMode === 'songs' && (
          <button
            className="shrink-0 bg-card border border-dashed border-border rounded-full px-3 py-1.5 text-xs cursor-pointer font-semibold text-muted-foreground hover:border-primary hover:text-foreground whitespace-nowrap"
            onClick={handleCreateTag}
            onDragOver={(e: DragEvent<HTMLButtonElement>) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={(e: DragEvent<HTMLButtonElement>) => {
              e.preventDefault();
              const songUuid = e.dataTransfer.getData('text/plain');
              if (!songUuid) return;
              const song = songs.find(s => s.uuid === songUuid);
              if (song) setDialogState({ kind: 'newTag', song });
            }}
            title="Make a new tag"
            aria-label="Make a new tag"
          >
            + New Tag
          </button>
          )}
        </div>
        )}
      </div>

      {selectedArtist === UNKNOWN_ARTIST_KEY && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5 bg-primary-light border border-primary rounded-md">
          <p className="flex-1 text-sm text-primary">
            {namableCount > 0
              ? `${namableCount} of these can be named from what is already here, for free.`
              : 'Give these an artist, one screen, without opening each one.'}
          </p>
          <Button size="sm" className="shrink-0" onClick={() => navigate('/app/library/tidy')}>
            Name these
          </Button>
        </div>
      )}

      {selectMode && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5 bg-primary-light border border-primary rounded-md flex-wrap">
          <span className="text-sm font-semibold text-primary mr-1 tabular-nums">{selectedUuids.size} selected</span>
          <Button variant="secondary" size="sm" onClick={selectAll}>Select All</Button>
          <Button variant="secondary" size="sm" onClick={clearSelection}>Clear</Button>
          {tags.length > 0 && (
            <>
              {/* Two selects rather than one with a remove sentinel. Adding and
                  removing are opposite actions, and a single list that does both
                  depending on which row you pick is how somebody untags twenty
                  songs meaning to tag them. */}
              <Select
                className="w-auto py-1.5 px-2 text-xs"
                value=""
                aria-label="Add a tag to the selected songs"
                onChange={(e) => { if (e.target.value) void handleBulkTag(e.target.value, true); }}
              >
                <option value="">Add tag&hellip;</option>
                {tags.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
              <Select
                className="w-auto py-1.5 px-2 text-xs"
                value=""
                aria-label="Remove a tag from the selected songs"
                onChange={(e) => { if (e.target.value) void handleBulkTag(e.target.value, false); }}
              >
                <option value="">Remove tag&hellip;</option>
                {tags.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </>
          )}
          <SongShareAction
            songUuids={[...selectedUuids]}
            variant="bulk"
            onSent={clearSelection}
          />
          <Button variant="danger" size="sm" onClick={handleBulkDeleteRequest}>Delete Selected</Button>
        </div>
      )}

      {showingArtistPicker ? (
        /* Deliberately a plain wrapping grid rather than either song layout. The
           horizontal grid measures song cards to size its rows, and an artist
           card is a different height, so reusing it would mis-measure the moment
           the user switched back. */
        <>
          <div
            data-testid="artist-grid"
            className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 items-start"
          >
            {visibleArtists.map(group => (
              <ArtistCard key={group.key} group={group} onSelect={handleSelectArtist} />
            ))}
          </div>
          {visibleArtists.length === 0 && (
            <div className="text-center py-16 px-8 text-muted-foreground">
              <p>No artists match your search.</p>
            </div>
          )}
        </>
      ) : layout === 'horizontal' ? (
        <div
          ref={setGridRef}
          data-testid="horizontal-grid"
          className="overflow-x-auto overflow-y-hidden -mx-2 sm:-mx-4 px-2 sm:px-4"
          style={{
            height: `${gridHeight}px`,
            display: 'grid',
            // The floor is the measured card height, so a row can never be shorter
            // than the card it holds. 1fr still distributes whatever is left over,
            // so the grid fills the space without cropping any card.
            gridTemplateRows: `repeat(${visibleRows}, minmax(${cardHeight}px, 1fr))`,
            gridAutoFlow: 'column',
            gridAutoColumns: `${colWidth}px`,
            gap: `${GRID_GAP_PX}px`,
            scrollSnapType: 'x mandatory',
          }}
        >
          {sortedSongs.map(song => (
            <SongCard
              key={song.uuid}
              song={song}
              stretch
              keptOffline={keptOffline.has(song.uuid)}
              selectMode={selectMode}
              isSelected={selectedUuids.has(song.uuid)}
              isDragging={draggingSongUuid === song.uuid}
              onView={handlePlay}
              onToggleSelect={toggleSelect}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDelete={handleDeleteRequest}
              onRename={handleRenameRequest}
              onEdit={onLoadSong}
              tags={tags}
              onToggleTag={handleToggleSongTag}
              onEditTags={handleEditTags}
              onSuggestTags={handleSuggestTagsRequest}
            />
          ))}
          {sortedSongs.length === 0 && songs.length > 0 && (
            <div className="text-center py-16 px-8 text-muted-foreground col-span-full">
              {activeTags.length > 0 && !searchQuery ? (
                <p>Nothing carries {activeTags.length === 1 ? 'that tag' : 'all of those tags'} yet. Drag a song onto a tag, or use the song menu.</p>
              ) : (
                <p>No songs match your search.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {pagedSongs.map(song => (
              <SongCard
                key={song.uuid}
                song={song}
                keptOffline={keptOffline.has(song.uuid)}
                selectMode={selectMode}
                isSelected={selectedUuids.has(song.uuid)}
                isDragging={draggingSongUuid === song.uuid}
                onView={handlePlay}
                onToggleSelect={toggleSelect}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDelete={handleDeleteRequest}
                onRename={handleRenameRequest}
                onEdit={onLoadSong}
                tags={tags}
                onToggleTag={handleToggleSongTag}
                onEditTags={handleEditTags}
                onSuggestTags={handleSuggestTagsRequest}
              />
            ))}
            {sortedSongs.length === 0 && songs.length > 0 && (
              <div className="text-center py-16 px-8 text-muted-foreground">
                {activeTags.length > 0 && !searchQuery ? (
                  <p>Nothing carries {activeTags.length === 1 ? 'that tag' : 'all of those tags'} yet. Drag a song onto a tag, or use the song menu.</p>
                ) : (
                  <p>No songs match your search.</p>
                )}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                aria-label="Previous page"
              >
                &larr; Prev
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                aria-label="Next page"
              >
                Next &rarr;
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={dialogState.kind === 'delete'}
        onOpenChange={(o: boolean) => { if (!o) setDialogState({ kind: 'none' }); }}
        title="Delete Song"
        description="Are you sure you want to delete this song? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (dialogState.kind === 'delete') handleDeleteConfirmed(dialogState.songUuid);
        }}
      />

      <ConfirmDialog
        open={dialogState.kind === 'bulkDelete'}
        onOpenChange={(o: boolean) => { if (!o) setDialogState({ kind: 'none' }); }}
        title="Delete Songs"
        description={dialogState.kind === 'bulkDelete' ? `Are you sure you want to delete ${dialogState.count} selected song${dialogState.count > 1 ? 's' : ''}? This action cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleBulkDeleteConfirmed}
      />

      <PromptDialog
        open={dialogState.kind === 'rename'}
        onOpenChange={(o: boolean) => { if (!o) setDialogState({ kind: 'none' }); }}
        title="Rename Song"
        fields={renameFields}
        confirmLabel="Save"
        onConfirm={(values) => {
          if (dialogState.kind === 'rename') handleRenameConfirmed(dialogState.song, values);
        }}
      />

      <PromptDialog
        open={dialogState.kind === 'newTag'}
        onOpenChange={(o: boolean) => { if (!o) setDialogState({ kind: 'none' }); }}
        title="New Tag"
        fields={newTagFields}
        confirmLabel="Create"
        onConfirm={(values) => {
          handleNewTagConfirmed(values, dialogState.kind === 'newTag' ? dialogState.song : undefined);
        }}
      />

      <PromptDialog
        open={dialogState.kind === 'renameTag'}
        onOpenChange={(o: boolean) => { if (!o) setDialogState({ kind: 'none' }); }}
        title="Rename Tag"
        fields={renameTagFields}
        confirmLabel="Rename"
        onConfirm={(values) => {
          if (dialogState.kind === 'renameTag') handleRenameTagConfirmed(dialogState.tag, values);
        }}
      />

      <ConfirmDialog
        open={dialogState.kind === 'deleteTag'}
        onOpenChange={(o: boolean) => { if (!o) setDialogState({ kind: 'none' }); }}
        title="Delete Tag"
        description={dialogState.kind === 'deleteTag' ? `Remove the tag "${dialogState.tag}" from every song carrying it? The songs themselves are not touched.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (dialogState.kind === 'deleteTag') handleDeleteTagConfirmed(dialogState.tag);
        }}
      />

      <TagEditDialog
        open={dialogState.kind === 'editTags'}
        onOpenChange={(o: boolean) => { if (!o) setDialogState({ kind: 'none' }); }}
        song={dialogState.kind === 'editTags' ? dialogState.song : null}
        allTags={tags}
        onSave={setSongTags}
      />

      <TagSuggestDialog
        open={dialogState.kind === 'suggestTags'}
        onOpenChange={(o: boolean) => { if (!o) setDialogState({ kind: 'none' }); }}
        song={dialogState.kind === 'suggestTags' ? dialogState.song : null}
        // Premium sends an empty model on purpose: the guard middleware pins the
        // platform model before the endpoint sees the body, exactly as it does
        // for parse and chat. So availability is a separate question from which
        // model string goes on the wire.
        model={ctx.llmSettings?.model ?? ''}
        canUseAi={ctx.isPremium || !!ctx.llmSettings?.model}
        onApply={setSongTags}
        onOpenSettings={ctx.onOpenSettings}
      />
    </div>
  );
}
