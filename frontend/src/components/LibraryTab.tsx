import { useState, useEffect, useRef, useMemo, useCallback, type DragEvent, type MouseEvent } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import api, { STORAGE_KEYS } from '@/api';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import PromptDialog, { type PromptField } from '@/components/ui/prompt-dialog';
import { cn } from '@/lib/utils';
import useAutoFontSize from '@/hooks/useAutoFontSize';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song } from '@/types';

/**
 * Split lyrics into N balanced columns at section boundaries.
 * Returns null if the content is too short to split.
 */
const MIN_LINES_PER_COLUMN = 10;

export function splitContentForColumns(text: string, numCols: number): string[] | null {
  if (numCols <= 1) return null;

  const lines = text.split('\n');
  if (lines.length < MIN_LINES_PER_COLUMN * numCols) return null;

  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '' || /^\[.+\]$/.test(trimmed)) {
      boundaries.push(i);
    }
  }

  if (boundaries.length < numCols - 1) return null;

  // Find numCols-1 split points that divide content most evenly
  const targetSize = lines.length / numCols;
  const splitPoints: number[] = [];

  for (let col = 1; col < numCols; col++) {
    const target = targetSize * col;
    const minLine = splitPoints.length > 0 ? splitPoints[splitPoints.length - 1]! + MIN_LINES_PER_COLUMN : lines.length * 0.1;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const idx of boundaries) {
      if (idx <= minLine) continue;
      if (idx >= lines.length - MIN_LINES_PER_COLUMN) continue;
      const dist = Math.abs(idx - target);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }
    if (bestIdx === -1) return null;

    const isSectionHeader = /^\[.+\]$/.test(lines[bestIdx]!.trim());
    splitPoints.push(isSectionHeader ? bestIdx : bestIdx + 1);
  }

  const columns: string[] = [];
  let start = 0;
  for (const sp of splitPoints) {
    columns.push(lines.slice(start, sp).join('\n').replace(/\n+$/, ''));
    start = sp;
  }
  columns.push(lines.slice(start).join('\n').replace(/^\n+/, ''));

  return columns;
}

const PRE_BASE_CLASS = 'font-mono text-xs sm:text-code leading-snug whitespace-pre text-foreground';

const FOLDER_PILL_CLASS = 'bg-card border border-border rounded-full px-3 py-1.5 text-xs cursor-pointer transition-all text-muted-foreground font-medium hover:border-primary hover:text-foreground whitespace-nowrap';
const FOLDER_PILL_ACTIVE = 'bg-primary text-white border-primary';

interface FolderPillProps {
  folder: string;
  isActive: boolean;
  isDragOver: boolean;
  onSelect: (folder: string) => void;
  onRename: (folder: string) => void;
  onDelete: (folder: string) => void;
  onDragOver: (e: DragEvent, folder: string) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent, folder: string) => void;
}

function FolderPill({
  folder,
  isActive,
  isDragOver,
  onSelect,
  onRename,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderPillProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const openedByContextMenu = useRef(false);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openedByContextMenu.current = true;
    setMenuOpen(true);
  };

  const handleOpenChange = (open: boolean) => {
    if (open && !openedByContextMenu.current) {
      /* Ignore Radix trying to open the menu from trigger click */
      return;
    }
    openedByContextMenu.current = false;
    setMenuOpen(open);
  };

  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          data-testid={`folder-pill-${folder}`}
          className={cn(
            FOLDER_PILL_CLASS,
            isActive && FOLDER_PILL_ACTIVE,
            isDragOver && 'bg-primary-light border-primary text-primary shadow-[0_0_0_2px_var(--color-primary-light)]'
          )}
          onClick={() => {
            onSelect(folder);
          }}
          onContextMenu={handleContextMenu}
          onDragOver={(e) => onDragOver(e, folder)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, folder)}
        >
          {folder}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onRename(folder)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-danger hover:!bg-danger-light"
          onClick={() => onDelete(folder)}
        >
          Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Determine the best auto column count based on viewport width.
 * Returns 1-4 columns, scaling with available width.
 */
function autoColumnCount(viewportWidth: number): number {
  if (viewportWidth >= 1920) return 4;
  if (viewportWidth >= 1536) return 3;
  if (viewportWidth >= 1280) return 2;
  return 1;
}

/**
 * Determine the max column count the content can support.
 */
function maxColumnsForContent(text: string): number {
  const lineCount = text.split('\n').length;
  if (lineCount >= MIN_LINES_PER_COLUMN * 4) return 4;
  if (lineCount >= MIN_LINES_PER_COLUMN * 3) return 3;
  if (lineCount >= MIN_LINES_PER_COLUMN * 2) return 2;
  return 1;
}

const GRID_COL_CLASSES: Record<number, string> = {
  2: 'grid grid-cols-2 gap-4',
  3: 'grid grid-cols-3 gap-3',
  4: 'grid grid-cols-4 gap-2',
};

interface PerformanceSheetProps {
  song: Song;
  className?: string;
  fontSizeOverride?: number | null;
  scrollDir?: 'vertical' | 'horizontal';
}

function PerformanceSheet({ song, className, fontSizeOverride, scrollDir = 'vertical' }: PerformanceSheetProps) {
  const text = song.rewritten_content;
  const sheetRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const maxCols = useMemo(() => maxColumnsForContent(text), [text]);
  const isHorizontal = scrollDir === 'horizontal' && maxCols >= 2;
  const autoCols = isHorizontal
    ? Math.max(2, Math.min(autoColumnCount(viewportWidth), maxCols))
    : 1;
  const columns = useMemo(() => splitContentForColumns(text, autoCols), [text, autoCols]);
  const isMultiCol = autoCols > 1 && columns !== null;

  const columnOverhead = isMultiCol ? 17 * (autoCols - 1) : 0;
  const autoFontSize = useAutoFontSize(sheetRef, text, { columnOverhead });
  const effectiveSize = fontSizeOverride ?? autoFontSize;
  const fontStyle = effectiveSize !== undefined ? { fontSize: `${effectiveSize}px` } : undefined;

  return (
    <div
      ref={sheetRef}
      className={cn(
        isHorizontal ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto',
        isMultiCol && GRID_COL_CLASSES[autoCols],
        className,
      )}
    >
      {isMultiCol && columns ? (
        columns.map((col, i) => (
          <pre
            key={i}
            className={cn(
              PRE_BASE_CLASS,
              'min-w-0',
              i < columns.length - 1 && 'border-r border-border pr-3'
            )}
            style={fontStyle}
          >
            {col}
          </pre>
        ))
      ) : (
        <pre className={PRE_BASE_CLASS} style={fontStyle}>{text}</pre>
      )}
    </div>
  );
}

function EditableTitle({ song, onSaved }: { song: Song; onSaved: (song: Song) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(song.title || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed === (song.title || '')) return;
    try {
      const updated = await api.updateSong(song.uuid, { title: trimmed || null } as Partial<Song>);
      onSaved(updated);
    } catch {
      setValue(song.title || '');
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="text-inherit font-inherit border border-primary rounded-sm px-1 bg-background text-foreground outline-none"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setValue(song.title || ''); setEditing(false); }
        }}
        onClick={e => e.stopPropagation()}
        placeholder="Untitled"
      />
    );
  }

  return (
    <span
      className="cursor-pointer border-b border-dashed border-muted-foreground hover:border-foreground"
      onClick={e => { e.stopPropagation(); setEditing(true); setValue(song.title || ''); }}
      title="Click to rename"
    >
      {song.title || 'Untitled'}
    </span>
  );
}

interface SongMenuProps {
  song: Song;
  onDelete: (uuid: string) => void;
  onRename: (song: Song) => void;
  onEdit: (song: Song) => void;
  folders: string[];
  onMoveToFolder: (song: Song, folder: string) => void;
  onMoveToNewFolder: (song: Song) => void;
}

function SongMenu({ song, onDelete, onRename, onEdit, folders, onMoveToFolder, onMoveToNewFolder }: SongMenuProps) {
  const otherFolders = folders.filter(f => f !== song.folder);

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
        <DropdownMenuItem onClick={() => onEdit(song)}>
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRename(song)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {song.folder && (
          <DropdownMenuLabel>In: {song.folder}</DropdownMenuLabel>
        )}
        {otherFolders.map(f => (
          <DropdownMenuItem key={f} onClick={() => onMoveToFolder(song, f)}>
            Move to {f}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onMoveToNewFolder(song)}>
          Move to new folder&hellip;
        </DropdownMenuItem>
        {song.folder && (
          <DropdownMenuItem onClick={() => onMoveToFolder(song, '')}>
            Remove from folder
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

type DialogState =
  | { kind: 'none' }
  | { kind: 'delete'; songUuid: string }
  | { kind: 'bulkDelete'; count: number }
  | { kind: 'rename'; song: Song }
  | { kind: 'newFolder'; song?: Song }
  | { kind: 'renameFolder'; folder: string }
  | { kind: 'deleteFolder'; folder: string };

const SONGS_PER_PAGE = 20;

interface SongCardProps {
  song: Song;
  selectMode: boolean;
  isSelected: boolean;
  isDragging: boolean;
  stretch?: boolean;
  onView: (song: Song) => void;
  onToggleSelect: (uuid: string) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, uuid: string) => void;
  onDragEnd: () => void;
  onSongUpdated: (song: Song) => void;
  onDelete: (uuid: string) => void;
  onRename: (song: Song) => void;
  onEdit: (song: Song) => void;
  folders: string[];
  onMoveToFolder: (song: Song, folder: string) => void;
  onMoveToNewFolder: (song: Song) => void;
}

function SongCard({
  song, selectMode, isSelected, isDragging, stretch,
  onView, onToggleSelect, onDragStart, onDragEnd,
  onSongUpdated, onDelete, onRename, onEdit,
  folders, onMoveToFolder, onMoveToNewFolder,
}: SongCardProps) {
  const date = new Date(song.created_at).toLocaleDateString();
  const artist = song.artist ? ` by ${song.artist}` : '';
  const preview = lyricsPreview(song.rewritten_content);

  return (
    <Card
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
            <EditableTitle song={song} onSaved={onSongUpdated} />
            {artist}
          </h3>
          {preview && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
          )}
          <span className="text-xs text-muted-foreground font-[family-name:var(--font-data)] tabular-nums">
            {date}
            {song.current_version > 1 ? ` \u00B7 v${song.current_version}` : ''}
            {song.folder ? ` \u00B7 ${song.folder}` : ''}
          </span>
        </div>
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <SongMenu
            song={song}
            onDelete={onDelete}
            onRename={onRename}
            onEdit={onEdit}
            folders={folders}
            onMoveToFolder={onMoveToFolder}
            onMoveToNewFolder={onMoveToNewFolder}
          />
        </div>
      </div>
    </Card>
  );
}

export function lyricsPreview(content: string): string {
  const lines = content.split('\n').filter(l => l.trim() && !/^\[.*\]$/.test(l.trim()));
  const preview = lines.slice(0, 2).join(' \u2022 ');
  return preview.length > 100 ? preview.slice(0, 100) + '\u2026' : preview;
}

export default function LibraryTab() {
  const ctx = useOutletContext<AppShellContext>();
  const onLoadSong = ctx.onLoadSong;
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const initialSongRef = idParam ?? null;
  const [songs, setSongs] = useState<Song[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewingSong, setViewingSong] = useState<Song | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [draggingSongUuid, setDraggingSongUuid] = useState<string | null>(null);
  const [localFolders, setLocalFolders] = useState<string[]>([]);
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());
  const selectMode = selectedUuids.size > 0;
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [dialogState, setDialogState] = useState<DialogState>({ kind: 'none' });
  const [scrollDir, setScrollDir] = useState<'vertical' | 'horizontal'>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.LIBRARY_LAYOUT);
    return stored === 'horizontal' ? 'horizontal' : 'vertical';
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRows, setVisibleRows] = useState(5);

  const toggleScrollDir = useCallback(() => {
    setScrollDir(prev => {
      const next = prev === 'vertical' ? 'horizontal' : 'vertical';
      localStorage.setItem(STORAGE_KEYS.LIBRARY_LAYOUT, next);
      return next;
    });
  }, []);

  // Performance view: font size override (per-song, persisted to DB)
  const [perfFontSize, setPerfFontSize] = useState<number | null>(null);
  // Performance view: scroll direction (user preference, persisted to localStorage)
  const [perfScrollDir, setPerfScrollDir] = useState<'vertical' | 'horizontal'>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.PERFORMANCE_LAYOUT);
    return stored === 'horizontal' ? 'horizontal' : 'vertical';
  });

  useEffect(() => {
    setPerfFontSize(viewingSong?.font_size ?? null);
  }, [viewingSong?.uuid, viewingSong?.font_size]);

  const togglePerfScrollDir = useCallback(() => {
    setPerfScrollDir(prev => {
      const next = prev === 'vertical' ? 'horizontal' : 'vertical';
      localStorage.setItem(STORAGE_KEYS.PERFORMANCE_LAYOUT, next);
      return next;
    });
  }, []);

  const containerClass = scrollDir === 'horizontal' ? 'w-full' : 'max-w-[1120px] mx-auto w-full';

  // Calculate grid dimensions from the screen:
  // - Column width matches the original responsive breakpoints (2 at lg, 3 at 2xl)
  // - Row count fills the available viewport height
  const CARD_HEIGHT_PX = 76; // approximate height of a song card + gap
  const [gridHeight, setGridHeight] = useState<number>(400);
  const [colWidth, setColWidth] = useState<number>(400);
  const measureGrid = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    // Measure from grid top to bottom of the <main> container (excludes footer + main padding)
    const mainEl = el.closest('main');
    const bottomEdge = mainEl
      ? mainEl.getBoundingClientRect().bottom - parseFloat(getComputedStyle(mainEl).paddingBottom)
      : window.innerHeight;
    const top = el.getBoundingClientRect().top;
    const available = bottomEdge - top;
    const clamped = Math.max(200, available);
    setGridHeight(clamped);
    setVisibleRows(Math.max(1, Math.floor(clamped / CARD_HEIGHT_PX)));
    // Width: match the original responsive column count (2 at lg, 3 at 2xl)
    // Use the grid's own clientWidth (includes the negative margin bleed)
    const containerWidth = el.clientWidth;
    const vw = window.innerWidth;
    const cols = vw >= 1536 ? 3 : vw >= 1024 ? 2 : 1;
    const gap = 12; // 0.75rem gap
    setColWidth(Math.floor((containerWidth - gap * (cols - 1)) / cols));
  }, []);

  // Callback ref: fires when the horizontal grid mounts/unmounts
  const setGridRef = useCallback((node: HTMLDivElement | null) => {
    gridRef.current = node;
    if (node) measureGrid();
  }, [measureGrid]);

  useEffect(() => {
    if (scrollDir !== 'horizontal') return;
    window.addEventListener('resize', measureGrid);
    return () => window.removeEventListener('resize', measureGrid);
  }, [scrollDir, measureGrid]);

  useEffect(() => {
    api.listSongs().then(data => {
      setSongs(data);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);


  const folders = useMemo(() => {
    const names = new Set(localFolders);
    for (const s of songs) {
      if (s.folder) names.add(s.folder);
    }
    return [...names].sort();
  }, [songs, localFolders]);

  const filteredSongs = useMemo(() => {
    let result = songs;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q)
      );
    }
    if (activeFolder === '__unfiled__') {
      result = result.filter(s => !s.folder);
    } else if (activeFolder) {
      result = result.filter(s => s.folder === activeFolder);
    }
    return result;
  }, [songs, searchQuery, activeFolder]);

  // Reset page when filters/sorting change
  useEffect(() => { setPage(0); }, [searchQuery, activeFolder, sortKey, sortDir]);

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

  useEffect(() => {
    if (initialSongRef != null && loaded) {
      const song = songs.find(s => s.uuid === initialSongRef);
      if (song) {
        setViewingSong(song);
      }
    } else if (initialSongRef == null) {
      // URL changed to /app/library (no song id), return to list view
      setViewingSong(null);
    }
  }, [initialSongRef, loaded, songs]);

  const pushSongUrl = useCallback((songUuid: string | null) => {
    const target = songUuid ? `/app/library/${songUuid}` : '/app/library';
    navigate(target, { replace: true });
  }, [navigate]);

  const handleView = (song: Song) => {
    setViewingSong(song);
    pushSongUrl(song.uuid);
  };

  const handleBack = () => {
    setViewingSong(null);
    pushSongUrl(null);
  };


  const handleDeleteRequest = (uuid: string) => {
    setDialogState({ kind: 'delete', songUuid: uuid });
  };

  const handleDeleteConfirmed = async (uuid: string) => {
    try {
      await api.deleteSong(uuid);
      setSongs(prev => prev.filter(s => s.uuid !== uuid));
      if (viewingSong?.uuid === uuid) {
        setViewingSong(null);
        pushSongUrl(null);
      }
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
    }
  };

  const handleSongUpdated = (updated: Song) => {
    setSongs(prev => prev.map(s => s.uuid === updated.uuid ? updated : s));
    if (viewingSong?.uuid === updated.uuid) setViewingSong(updated);
  };

  const persistPerfFontSize = useCallback((value: number | null) => {
    if (!viewingSong) return;
    const sendValue = value === null ? 0 : value;
    api.updateSong(viewingSong.uuid, { font_size: sendValue } as Partial<Song>).then(updated => {
      setSongs(prev => prev.map(s => s.uuid === updated.uuid ? updated : s));
      setViewingSong(prev => prev?.uuid === updated.uuid ? updated : prev);
    }).catch(() => {});
  }, [viewingSong]);

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

  const handleMoveToFolder = async (song: Song, folderName: string) => {
    try {
      const updated = await api.updateSong(song.uuid, { folder: folderName } as Partial<Song>);
      handleSongUpdated(updated);
    } catch (err) {
      toast.error('Failed to move song: ' + (err as Error).message);
    }
  };

  const handleMoveToNewFolder = (song: Song) => {
    setDialogState({ kind: 'newFolder', song });
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, songUuid: string) => {
    e.dataTransfer.setData('text/plain', songUuid);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingSongUuid(songUuid);
  };

  const handleDragEnd = () => {
    setDraggingSongUuid(null);
    setDragOverFolder(null);
  };

  const handleFolderDragOver = (e: DragEvent, folderKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolder(folderKey);
  };

  const handleFolderDragLeave = () => {
    setDragOverFolder(null);
  };

  const handleFolderDrop = async (e: DragEvent, folderName: string) => {
    e.preventDefault();
    setDragOverFolder(null);
    const songUuid = e.dataTransfer.getData('text/plain');
    if (!songUuid) return;
    const song = songs.find(s => s.uuid === songUuid);
    if (!song) return;
    await handleMoveToFolder(song, folderName);
  };

  const handleCreateFolder = () => {
    setDialogState({ kind: 'newFolder', song: draggingSongUuid ? songs.find(s => s.uuid === draggingSongUuid) : undefined });
  };

  const handleRenameFolderRequest = (folder: string) => {
    setDialogState({ kind: 'renameFolder', folder });
  };

  const handleRenameFolderConfirmed = async (oldName: string, values: Record<string, string>) => {
    const newName = (values.name ?? '').trim();
    if (!newName || newName === oldName) return;
    try {
      await api.renameFolder(oldName, newName);
      setSongs(prev => prev.map(s => s.folder === oldName ? { ...s, folder: newName } : s));
      setLocalFolders(prev => prev.map(f => f === oldName ? newName : f));
      if (activeFolder === oldName) setActiveFolder(newName);
    } catch (err) {
      toast.error('Failed to rename folder: ' + (err as Error).message);
    }
  };

  const handleDeleteFolderRequest = (folder: string) => {
    setDialogState({ kind: 'deleteFolder', folder });
  };

  const handleDeleteFolderConfirmed = async (folder: string) => {
    try {
      await api.deleteFolder(folder);
      setSongs(prev => prev.map(s => s.folder === folder ? { ...s, folder: null } : s));
      setLocalFolders(prev => prev.filter(f => f !== folder));
      if (activeFolder === folder) setActiveFolder(null);
    } catch (err) {
      toast.error('Failed to delete folder: ' + (err as Error).message);
    }
  };

  const handleNewFolderConfirmed = (values: Record<string, string>, song?: Song) => {
    const trimmed = (values.name ?? '').trim();
    if (!trimmed) return;
    if (song) {
      handleMoveToFolder(song, trimmed);
    } else {
      setLocalFolders(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    }
    setActiveFolder(trimmed);
  };

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
      if (viewingSong && selectedUuids.has(viewingSong.uuid)) {
        setViewingSong(null);
        pushSongUrl(null);
      }
      setSelectedUuids(new Set());
    } catch (err) {
      toast.error('Failed to delete some songs: ' + (err as Error).message);
    }
  };

  const handleBulkMoveToFolder = async (folderName: string) => {
    try {
      const results = await Promise.all(
        [...selectedUuids].map(uuid => api.updateSong(uuid, { folder: folderName } as Partial<Song>))
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

  const handleDownloadPdf = (song: Song) => {
    toast.promise(
      api.downloadSongPdf(song.uuid, song.title, song.artist),
      {
        loading: 'Generating PDF...',
        success: 'PDF downloaded',
        error: 'Failed to download PDF',
      }
    );
  };

  // Rename dialog fields
  const renameFields: PromptField[] = useMemo(() => {
    if (dialogState.kind !== 'rename') return [];
    return [
      { key: 'title', label: 'Song title', defaultValue: dialogState.song.title || '', placeholder: 'Song title' },
      { key: 'artist', label: 'Artist', defaultValue: dialogState.song.artist || '', placeholder: 'Artist' },
    ];
  }, [dialogState]);

  const newFolderFields: PromptField[] = useMemo(() => [
    { key: 'name', label: 'Folder name', placeholder: 'Enter folder name' },
  ], []);

  const renameFolderFields: PromptField[] = useMemo(() => {
    if (dialogState.kind !== 'renameFolder') return [];
    return [{ key: 'name', label: 'Folder name', defaultValue: dialogState.folder, placeholder: 'New folder name' }];
  }, [dialogState]);

  // --- Performance View (single song) ---
  if (viewingSong) {
    const song = viewingSong;
    const showScrollToggle = maxColumnsForContent(song.rewritten_content) >= 2;
    const sliderValue = perfFontSize ?? 16;
    return (
      <div className="flex flex-col h-full min-h-0 w-full">
        <div className="flex items-center gap-3 mb-2 shrink-0">
          <button
            onClick={handleBack}
            className="text-sm text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="Back to library"
          >
            &larr;
          </button>
          <div className="flex-1 min-w-0">
            <span className="font-display text-lg font-bold text-foreground truncate">
              {song.title || 'Untitled'}
            </span>
            {song.artist && (
              <span className="text-sm text-muted-foreground ml-2">{song.artist}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[32px] text-right">
              {perfFontSize === null ? 'Auto' : `${Math.round(perfFontSize)}px`}
            </span>
            <input
              type="range"
              min={6}
              max={28}
              step={1}
              value={Math.round(sliderValue)}
              onChange={(e) => setPerfFontSize(Number(e.target.value))}
              onMouseUp={() => persistPerfFontSize(perfFontSize)}
              onTouchEnd={() => persistPerfFontSize(perfFontSize)}
              className="w-20 h-1 accent-primary cursor-pointer"
              title="Text size"
              aria-label="Font size"
            />
            {perfFontSize !== null && (
              <button
                onClick={() => { setPerfFontSize(null); persistPerfFontSize(null); }}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                title="Reset to auto size"
                aria-label="Reset to auto font size"
              >
                &times;
              </button>
            )}
          </div>
          {showScrollToggle && (
            <button
              className="inline-flex bg-transparent hover:bg-panel rounded-md p-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
              onClick={togglePerfScrollDir}
              title={perfScrollDir === 'vertical' ? 'Switch to horizontal scroll' : 'Switch to vertical scroll'}
              aria-label={perfScrollDir === 'vertical' ? 'Switch to horizontal scroll' : 'Switch to vertical scroll'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                {perfScrollDir === 'vertical' ? (
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
            </button>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="default" size="sm" onClick={() => onLoadSong(song)}>Edit</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="bg-transparent border border-border rounded-md cursor-pointer text-xl leading-none px-2 py-1.5 text-muted-foreground hover:bg-panel hover:text-foreground"
                  aria-label="Song actions"
                >
                  &hellip;
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownloadPdf(song)}>
                  Download PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleRenameRequest(song)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger hover:!bg-danger-light"
                  onClick={() => handleDeleteRequest(song.uuid)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <PerformanceSheet song={song} className="flex-1 min-h-0" fontSizeOverride={perfFontSize} scrollDir={perfScrollDir} />

        <ConfirmDialog
          open={dialogState.kind === 'delete'}
          onOpenChange={(open) => { if (!open) setDialogState({ kind: 'none' }); }}
          title="Delete Song"
          description="Are you sure you want to delete this song? This action cannot be undone."
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={() => {
            if (dialogState.kind === 'delete') handleDeleteConfirmed(dialogState.songUuid);
          }}
        />

        <PromptDialog
          open={dialogState.kind === 'rename'}
          onOpenChange={(open) => { if (!open) setDialogState({ kind: 'none' }); }}
          title="Rename Song"
          fields={renameFields}
          confirmLabel="Save"
          onConfirm={(values) => {
            if (dialogState.kind === 'rename') handleRenameConfirmed(dialogState.song, values);
          }}
        />
      </div>
    );
  }

  // --- Loading ---
  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <Spinner />
        <span className="text-sm">Loading songs...</span>
      </div>
    );
  }

  // --- Song List ---
  if (songs.length === 0) {
    return (
      <div className="text-center py-16 px-8">
        <h3 className="font-display text-lg font-semibold text-foreground mb-2">Your library is empty</h3>
        <p className="text-muted-foreground mb-4">
          Songs you rewrite will appear here. Head to the Rewrite tab to get started.
        </p>
        <Button variant="default" onClick={() => navigate('/app/rewrite')}>
          Go to Rewrite
        </Button>
      </div>
    );
  }

  const hasUnfiled = songs.some(s => !s.folder);
  const hasFolders = folders.length > 0;

  return (
    <div className={cn('flex flex-col gap-4', containerClass, scrollDir === 'horizontal' && 'h-full min-h-0')}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            placeholder="Search songs by title or artist..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-card flex-1"
          />
          <Select
            className="w-auto py-2 px-2 text-xs"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="date">Created</option>
            <option value="modified">Modified</option>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            aria-label={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          >
            {sortDir === 'asc' ? '\u2191' : '\u2193'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleScrollDir}
            title={scrollDir === 'vertical' ? 'Switch to horizontal scroll' : 'Switch to vertical scroll'}
            aria-label={scrollDir === 'vertical' ? 'Switch to horizontal scroll' : 'Switch to vertical scroll'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              {scrollDir === 'vertical' ? (
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
        </div>
        <div className="flex flex-wrap gap-1.5 items-center overflow-x-auto">
          {hasFolders && (
            <button
              className={cn(
                FOLDER_PILL_CLASS,
                activeFolder === null && FOLDER_PILL_ACTIVE
              )}
              onClick={() => setActiveFolder(null)}
            >
              All
            </button>
          )}
          {folders.map(f => (
            <FolderPill
              key={f}
              folder={f}
              isActive={activeFolder === f}
              isDragOver={dragOverFolder === f}
              onSelect={setActiveFolder}
              onRename={handleRenameFolderRequest}
              onDelete={handleDeleteFolderRequest}
              onDragOver={handleFolderDragOver}
              onDragLeave={handleFolderDragLeave}
              onDrop={handleFolderDrop}
            />
          ))}
          {hasFolders && hasUnfiled && (
            <button
              className={cn(
                FOLDER_PILL_CLASS,
                activeFolder === '__unfiled__' && FOLDER_PILL_ACTIVE,
                dragOverFolder === '__unfiled__' && 'bg-primary-light border-primary text-primary shadow-[0_0_0_2px_var(--color-primary-light)]'
              )}
              onClick={() => setActiveFolder('__unfiled__')}
              onDragOver={(e) => handleFolderDragOver(e, '__unfiled__')}
              onDragLeave={handleFolderDragLeave}
              onDrop={(e) => handleFolderDrop(e, '')}
            >
              Unfiled
            </button>
          )}
          <button
            className="bg-card border border-dashed border-border rounded-full px-3 py-1.5 text-xs cursor-pointer font-semibold text-muted-foreground hover:border-primary hover:text-foreground whitespace-nowrap"
            onClick={handleCreateFolder}
            onDragOver={(e: DragEvent<HTMLButtonElement>) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={(e: DragEvent<HTMLButtonElement>) => {
              e.preventDefault();
              const songUuid = e.dataTransfer.getData('text/plain');
              if (!songUuid) return;
              const song = songs.find(s => s.uuid === songUuid);
              if (song) setDialogState({ kind: 'newFolder', song });
            }}
            title="Create new folder"
            aria-label="Create new folder"
          >
            + New Folder
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5 bg-primary-light border border-primary rounded-md flex-wrap">
          <span className="text-sm font-semibold text-primary mr-1 tabular-nums">{selectedUuids.size} selected</span>
          <Button variant="secondary" size="sm" onClick={selectAll}>Select All</Button>
          <Button variant="secondary" size="sm" onClick={clearSelection}>Clear</Button>
          {folders.length > 0 && (
            <Select
              className="w-auto py-1.5 px-2 text-xs"
              value=""
              onChange={(e) => {
                if (e.target.value === '__remove__') handleBulkMoveToFolder('');
                else if (e.target.value) handleBulkMoveToFolder(e.target.value);
              }}
            >
              <option value="">Move to folder&hellip;</option>
              {folders.map(f => <option key={f} value={f}>{f}</option>)}
              <option value="__remove__">Remove from folder</option>
            </Select>
          )}
          <Button variant="danger" size="sm" onClick={handleBulkDeleteRequest}>Delete Selected</Button>
        </div>
      )}

      {scrollDir === 'horizontal' ? (
        <div
          ref={setGridRef}
          data-testid="horizontal-grid"
          className="overflow-x-auto overflow-y-hidden -mx-2 sm:-mx-4 px-2 sm:px-4"
          style={{
            height: `${gridHeight}px`,
            display: 'grid',
            gridTemplateRows: `repeat(${visibleRows}, minmax(0, 1fr))`,
            gridAutoFlow: 'column',
            gridAutoColumns: `${colWidth}px`,
            gap: '0.75rem',
            scrollSnapType: 'x mandatory',
          }}
        >
          {sortedSongs.map(song => (
            <SongCard
              key={song.uuid}
              song={song}
              stretch
              selectMode={selectMode}
              isSelected={selectedUuids.has(song.uuid)}
              isDragging={draggingSongUuid === song.uuid}
              onView={handleView}
              onToggleSelect={toggleSelect}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onSongUpdated={handleSongUpdated}
              onDelete={handleDeleteRequest}
              onRename={handleRenameRequest}
              onEdit={onLoadSong}
              folders={folders}
              onMoveToFolder={handleMoveToFolder}
              onMoveToNewFolder={handleMoveToNewFolder}
            />
          ))}
          {sortedSongs.length === 0 && songs.length > 0 && (
            <div className="text-center py-16 px-8 text-muted-foreground col-span-full">
              {activeFolder && !searchQuery ? (
                <p>No songs in this folder yet. Drag songs onto the folder tab or use the song menu to move them here.</p>
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
                selectMode={selectMode}
                isSelected={selectedUuids.has(song.uuid)}
                isDragging={draggingSongUuid === song.uuid}
                onView={handleView}
                onToggleSelect={toggleSelect}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onSongUpdated={handleSongUpdated}
                onDelete={handleDeleteRequest}
                onRename={handleRenameRequest}
                onEdit={onLoadSong}
                folders={folders}
                onMoveToFolder={handleMoveToFolder}
                onMoveToNewFolder={handleMoveToNewFolder}
              />
            ))}
            {sortedSongs.length === 0 && songs.length > 0 && (
              <div className="text-center py-16 px-8 text-muted-foreground">
                {activeFolder && !searchQuery ? (
                  <p>No songs in this folder yet. Drag songs onto the folder tab or use the song menu to move them here.</p>
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
        onOpenChange={(open) => { if (!open) setDialogState({ kind: 'none' }); }}
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
        onOpenChange={(open) => { if (!open) setDialogState({ kind: 'none' }); }}
        title="Delete Songs"
        description={dialogState.kind === 'bulkDelete' ? `Are you sure you want to delete ${dialogState.count} selected song${dialogState.count > 1 ? 's' : ''}? This action cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleBulkDeleteConfirmed}
      />

      <PromptDialog
        open={dialogState.kind === 'rename'}
        onOpenChange={(open) => { if (!open) setDialogState({ kind: 'none' }); }}
        title="Rename Song"
        fields={renameFields}
        confirmLabel="Save"
        onConfirm={(values) => {
          if (dialogState.kind === 'rename') handleRenameConfirmed(dialogState.song, values);
        }}
      />

      <PromptDialog
        open={dialogState.kind === 'newFolder'}
        onOpenChange={(open) => { if (!open) setDialogState({ kind: 'none' }); }}
        title="New Folder"
        fields={newFolderFields}
        confirmLabel="Create"
        onConfirm={(values) => {
          handleNewFolderConfirmed(values, dialogState.kind === 'newFolder' ? dialogState.song : undefined);
        }}
      />

      <PromptDialog
        open={dialogState.kind === 'renameFolder'}
        onOpenChange={(open) => { if (!open) setDialogState({ kind: 'none' }); }}
        title="Rename Folder"
        fields={renameFolderFields}
        confirmLabel="Rename"
        onConfirm={(values) => {
          if (dialogState.kind === 'renameFolder') handleRenameFolderConfirmed(dialogState.folder, values);
        }}
      />

      <ConfirmDialog
        open={dialogState.kind === 'deleteFolder'}
        onOpenChange={(open) => { if (!open) setDialogState({ kind: 'none' }); }}
        title="Delete Folder"
        description={dialogState.kind === 'deleteFolder' ? `Delete the folder "${dialogState.folder}"? Songs in this folder will be moved to Unfiled.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (dialogState.kind === 'deleteFolder') handleDeleteFolderConfirmed(dialogState.folder);
        }}
      />
    </div>
  );
}
