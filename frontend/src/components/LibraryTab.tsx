import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, type DragEvent, type MouseEvent } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import api, { STORAGE_KEYS } from '@/api';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Card, CardHeader } from '@/components/ui/card';
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
import type { Song, SongRevision } from '@/types';

/**
 * Split lyrics into two balanced columns at the best section boundary.
 */
const MIN_LINES_FOR_SPLIT = 20;

function splitContentForColumns(text: string): { left: string; right: string } | null {
  const lines = text.split('\n');
  if (lines.length < MIN_LINES_FOR_SPLIT) return null;

  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '' || /^\[.+\]$/.test(trimmed)) {
      boundaries.push(i);
    }
  }

  if (boundaries.length === 0) return null;

  const mid = lines.length / 2;
  let bestIdx = boundaries[0]!;
  let bestDist = Math.abs(bestIdx - mid);
  for (const idx of boundaries) {
    const dist = Math.abs(idx - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  }

  const minEdge = lines.length * 0.25;
  if (bestIdx < minEdge || bestIdx > lines.length - minEdge) return null;

  const isSectionHeader = /^\[.+\]$/.test(lines[bestIdx]!.trim());
  const splitAt = isSectionHeader ? bestIdx : bestIdx + 1;

  return {
    left: lines.slice(0, splitAt).join('\n').replace(/\n+$/, ''),
    right: lines.slice(splitAt).join('\n').replace(/^\n+/, ''),
  };
}

const PRE_BASE_CLASS = 'font-mono text-xs sm:text-code leading-snug whitespace-pre-wrap break-words sm:whitespace-pre sm:break-normal sm:overflow-x-auto text-foreground';

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

function PerformanceSheet({ song, onSongUpdated }: { song: Song; onSongUpdated: (song: Song) => void }) {
  const text = song.rewritten_content;
  const columns = useMemo(() => splitContentForColumns(text), [text]);
  const cardRef = useRef<HTMLDivElement>(null);
  const [autoOneCol, setAutoOneCol] = useState(false);
  const [userOverride, setUserOverride] = useState<number | null>(null);
  const [localFontSize, setLocalFontSize] = useState<number | null>(song.font_size ?? null);

  useLayoutEffect(() => {
    setAutoOneCol(false);
    setUserOverride(null);
  }, [text]);

  useEffect(() => {
    setLocalFontSize(song.font_size ?? null);
  }, [song.font_size]);

  const canSplit = columns !== null;
  const showTwoCol = canSplit && (userOverride === 2 || (userOverride === null && !autoOneCol));

  useLayoutEffect(() => {
    if (columns && !autoOneCol && userOverride === null && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      const available = window.innerHeight - rect.top - 40;
      if (cardRef.current.scrollHeight > available * 1.5) {
        setAutoOneCol(true);
      }
    }
  }, [columns, autoOneCol, userOverride]);

  const autoFontSize = useAutoFontSize(cardRef, text, { columnOverhead: showTwoCol ? 33 : 0 });
  const effectiveSize = localFontSize ?? autoFontSize;
  const fontStyle = effectiveSize !== undefined ? { fontSize: `${effectiveSize}px` } : undefined;
  const isAuto = localFontSize === null;
  const sliderValue = effectiveSize ?? 16;

  const persistFontSize = useCallback((value: number | null) => {
    const sendValue = value === null ? 0 : value;
    api.updateSong(song.uuid, { font_size: sendValue } as Partial<Song>).then(updated => {
      onSongUpdated(updated);
    }).catch(() => {});
  }, [song.uuid, onSongUpdated]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalFontSize(Number(e.target.value));
  };

  const handleSliderCommit = () => {
    persistFontSize(localFontSize);
  };

  const handleResetToAuto = () => {
    setLocalFontSize(null);
    persistFontSize(null);
  };

  const controls = (
    <div className="flex items-center justify-end gap-2 mb-2 sm:mb-0 sm:absolute sm:top-2 sm:right-2 sm:z-10 sm:opacity-60 sm:hover:opacity-100 sm:transition-opacity">
      <div className="flex items-center gap-1.5 bg-background/80 backdrop-blur-sm rounded-md px-2 py-1 border border-border">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {isAuto ? 'Auto' : `${Math.round(sliderValue)}px`}
        </span>
        <input
          type="range"
          min={10}
          max={28}
          step={1}
          value={Math.round(sliderValue)}
          onChange={handleSliderChange}
          onMouseUp={handleSliderCommit}
          onTouchEnd={handleSliderCommit}
          className="w-20 h-1 accent-primary cursor-pointer"
          title="Text size"
        />
        {!isAuto && (
          <button
            onClick={handleResetToAuto}
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer ml-0.5"
            title="Reset to auto size"
          >
            &times;
          </button>
        )}
      </div>
      {canSplit && (
        <div className="hidden xl:inline-flex items-center gap-0.5 bg-panel border border-border rounded-md p-0.5" role="radiogroup" aria-label="Column layout">
          {([1, 2] as const).map(cols => {
            const isActive = cols === 1 ? !showTwoCol : showTwoCol;
            return (
              <button
                key={cols}
                className={cn(
                  'px-2.5 py-1.5 text-xs rounded cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                  isActive ? 'bg-card text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setUserOverride(cols)}
                role="radio"
                aria-checked={isActive}
                aria-label={`${cols} column layout`}
              >
                {cols} Col
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="relative">
      {controls}
      <Card
        ref={cardRef}
        className={cn('p-4 sm:p-6', showTwoCol && 'xl:grid xl:grid-cols-2 xl:gap-6')}
      >
        {showTwoCol ? (
          <>
            <pre className={cn(PRE_BASE_CLASS, 'min-w-0 xl:border-r xl:border-border xl:pr-8')} style={fontStyle}>{columns!.left}</pre>
            <pre className={cn(PRE_BASE_CLASS, 'min-w-0')} style={fontStyle}>{columns!.right}</pre>
          </>
        ) : (
          <pre className={PRE_BASE_CLASS} style={fontStyle}>{text}</pre>
        )}
      </Card>
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
  const [showDetails, setShowDetails] = useState(false);
  const [revisions, setRevisions] = useState<SongRevision[]>([]);
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
  const [layoutWidth, setLayoutWidth] = useState<'default' | 'wide'>(() => {
    return (localStorage.getItem(STORAGE_KEYS.LIBRARY_LAYOUT) as 'default' | 'wide') || 'default';
  });

  const toggleLayoutWidth = useCallback(() => {
    setLayoutWidth(prev => {
      const next = prev === 'default' ? 'wide' : 'default';
      localStorage.setItem(STORAGE_KEYS.LIBRARY_LAYOUT, next);
      return next;
    });
  }, []);

  const containerClass = layoutWidth === 'wide' ? 'w-full' : 'max-w-[1120px] mx-auto w-full';

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
        setShowDetails(false);
        setRevisions([]);
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
    setShowDetails(false);
    setRevisions([]);
    pushSongUrl(song.uuid);
  };

  const handleBack = () => {
    setViewingSong(null);
    pushSongUrl(null);
  };

  const handleShowDetails = async () => {
    setShowDetails(prev => !prev);
    if (!showDetails && viewingSong && revisions.length === 0) {
      try {
        const revs = await api.getSongRevisions(viewingSong.uuid);
        setRevisions(revs);
      } catch {
        // ignore
      }
    }
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
    return (
      <div className={containerClass}>
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center mb-3 gap-3">
          <Button variant="secondary" onClick={handleBack}>&larr; All Songs</Button>
          <div className="flex gap-2 justify-end flex-wrap">
            <Button variant="default" onClick={() => onLoadSong(song)}>Edit in Rewrite</Button>
            <Button variant="secondary" onClick={() => handleDownloadPdf(song)}>Download PDF</Button>
            <Button variant="ghost" className="text-muted-foreground hover:text-danger" onClick={() => handleDeleteRequest(song.uuid)}>Delete</Button>
          </div>
        </div>

        <div className="text-center mb-3">
          <h2 className="text-xl font-bold text-foreground">{song.title || 'Untitled'}</h2>
          {song.artist && <div className="text-sm text-muted-foreground mt-0.5">{song.artist}</div>}
        </div>

        <PerformanceSheet song={song} onSongUpdated={handleSongUpdated} />

        <Button variant="secondary" className="mt-6" onClick={handleShowDetails}>
          {showDetails ? 'Hide Details' : 'Show Original & History'}
        </Button>

        {showDetails && (
          <div className="mt-4 flex flex-col gap-4">
            <Card>
              <CardHeader>Original</CardHeader>
              <pre className="p-3 sm:p-4 font-mono text-xs sm:text-code leading-relaxed whitespace-pre-wrap break-words overflow-x-auto max-h-[600px] overflow-y-auto">{song.original_content}</pre>
            </Card>

            {song.changes_summary && (
              <Card>
                <CardHeader className="bg-card">Changes</CardHeader>
                <div className="p-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{song.changes_summary}</div>
              </Card>
            )}

            {revisions.length > 1 && (
              <div className="mt-4 border-t border-border pt-3">
                <h4 className="text-sm text-muted-foreground mb-2">Revision History ({revisions.length} versions)</h4>
                {revisions.map(rev => (
                  <div key={rev.id} className="text-xs py-1 text-muted-foreground border-b border-border last:border-b-0">
                    v{rev.version} · {rev.edit_type === 'chat' ? 'Chat edit' : 'Full rewrite'} · {rev.changes_summary || 'No summary'} · {new Date(rev.created_at).toLocaleString()}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-4 text-xs text-muted-foreground pt-2">
              {song.current_version > 1 && <span>Version {song.current_version}</span>}
              <span>{new Date(song.created_at).toLocaleDateString()}</span>
            </div>
          </div>
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
        <h3 className="text-lg font-semibold text-foreground mb-2">Your library is empty</h3>
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
    <div className={cn('flex flex-col gap-4', containerClass)}>
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
            onClick={toggleLayoutWidth}
            title={layoutWidth === 'default' ? 'Switch to wide layout' : 'Switch to compact layout'}
            aria-label={layoutWidth === 'default' ? 'Switch to wide layout' : 'Switch to compact layout'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              {layoutWidth === 'default' ? (
                <>
                  <rect x="2" y="3" width="12" height="10" rx="1" />
                  <line x1="5" y1="3" x2="5" y2="13" />
                  <line x1="11" y1="3" x2="11" y2="13" />
                </>
              ) : (
                <>
                  <rect x="1" y="3" width="14" height="10" rx="1" />
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
          <span className="text-sm font-semibold text-primary mr-1">{selectedUuids.size} selected</span>
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

      <div className={cn('gap-3', layoutWidth === 'wide' ? 'grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3' : 'flex flex-col')}>
        {pagedSongs.map(song => {
          const date = new Date(song.created_at).toLocaleDateString();
          const artist = song.artist ? ` by ${song.artist}` : '';
          const isSelected = selectedUuids.has(song.uuid);
          const preview = lyricsPreview(song.rewritten_content);

          return (
            <Card
              key={song.uuid}
              className={cn(
                'group cursor-pointer transition-colors',
                draggingSongUuid === song.uuid && 'opacity-40',
                isSelected && 'border-primary bg-selected-bg'
              )}
              onClick={() => selectMode ? toggleSelect(song.uuid) : handleView(song)}
              draggable={!selectMode || undefined}
              onDragStart={!selectMode ? (e) => handleDragStart(e, song.uuid) : undefined}
              onDragEnd={!selectMode ? handleDragEnd : undefined}
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
                    onChange={() => toggleSelect(song.uuid)}
                  />
                </label>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm sm:text-base mb-0.5 leading-snug">
                    <EditableTitle song={song} onSaved={handleSongUpdated} />
                    {artist}
                  </h3>
                  {preview && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {date}
                    {song.current_version > 1 ? ` \u00B7 v${song.current_version}` : ''}
                    {song.folder ? ` \u00B7 ${song.folder}` : ''}
                  </span>
                </div>
                <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                  <SongMenu
                    song={song}
                    onDelete={handleDeleteRequest}
                    onRename={handleRenameRequest}
                    onEdit={onLoadSong}
                    folders={folders}
                    onMoveToFolder={handleMoveToFolder}
                    onMoveToNewFolder={handleMoveToNewFolder}
                  />
                </div>
              </div>
            </Card>
          );
        })}
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
