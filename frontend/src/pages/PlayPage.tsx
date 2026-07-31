import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import api, { STORAGE_KEYS } from '@/api';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import { Select } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import TunerDialog from '@/components/TunerDialog';
import { PerformanceSheet, FontSizeStepper } from '@/components/PlayView';
import type { ColumnPref, SongVersion } from '@/components/PlayView';
import { maxColumnsForContent } from '@/lib/performanceLayout';
import useWakeLock from '@/hooks/useWakeLock';
import { cn } from '@/lib/utils';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song } from '@/types';

/**
 * The play route: /app/play/:uuid
 *
 * Playing a chart is the product, so it gets a route and a full-screen surface
 * rather than being a mode hidden inside the library list. AppShell hides its
 * header, tab bar, and footer for this path (see `chromeless` there), which also
 * means only one useWakeLock instance is mounted at a time.
 *
 * The route stays *inside* AppShell rather than beside it. Chrome is a rendering
 * concern, not a routing one, and moving out would remount the shell on every
 * library-to-play transition (refetching the profile, the model list, the song and
 * its chat history) and would put `onLoadSong` out of reach, breaking "Rewrite
 * with AI".
 */

/** Optional navigation state so the header can render before the fetch lands. */
interface PlayNavState {
  title?: string | null;
  artist?: string | null;
}

export default function PlayPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const ctx = useOutletContext<AppShellContext>();
  const navState = (location.state ?? null) as PlayNavState | null;

  const [song, setSong] = useState<Song | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [tunerOpen, setTunerOpen] = useState(false);
  const [autoFontSize, setAutoFontSize] = useState<number | undefined>();

  // useLocalStorage is string-only, and these are unions, so persist by hand.
  const [perfVersion, setPerfVersionRaw] = useState<SongVersion>(() =>
    localStorage.getItem(STORAGE_KEYS.PERFORMANCE_VERSION) === 'original' ? 'original' : 'rewritten',
  );
  const setPerfVersion = useCallback((next: SongVersion) => {
    setPerfVersionRaw(next);
    localStorage.setItem(STORAGE_KEYS.PERFORMANCE_VERSION, next);
  }, []);

  const [perfColumns, setPerfColumnsRaw] = useState<ColumnPref>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.PERFORMANCE_LAYOUT);
    const n = Number(stored);
    return stored && n >= 1 && n <= 4 ? (n as ColumnPref) : 'auto';
  });
  const setPerfColumns = useCallback((next: ColumnPref) => {
    setPerfColumnsRaw(next);
    localStorage.setItem(STORAGE_KEYS.PERFORMANCE_LAYOUT, String(next));
  }, []);

  const [fontSize, setFontSize] = useState<number | null>(null);

  const wakeLock = useWakeLock();

  // Resolve the song by uuid. The library's old deep-link path only matched songs
  // already present in its in-memory list, so a cold link (a bookmark, a share, a
  // PWA relaunch) silently rendered nothing.
  useEffect(() => {
    if (!uuid) {
      setStatus('notfound');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    api
      .getSong(uuid)
      .then((loaded) => {
        if (cancelled) return;
        setSong(loaded);
        setFontSize(loaded.font_size && loaded.font_size > 0 ? loaded.font_size : null);
        setStatus('ready');
        // Remember which surface the user was last on, so a PWA relaunch at /app
        // returns them to the chart they were playing rather than the editor.
        localStorage.setItem(STORAGE_KEYS.CURRENT_SONG_ID, loaded.uuid);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = (err as Error)?.message ?? '';
        setStatus(/not found|404/i.test(message) ? 'notfound' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  const persistFontSize = useCallback(
    (next: number | null) => {
      setFontSize(next);
      if (!song) return;
      // Best effort. A read-only account cannot PUT, and the size still applies for
      // this session, so a failure here must not surface as an error.
      api.updateSong(song.uuid, { font_size: next ?? 0 } as Partial<Song>).catch(() => {});
    },
    [song],
  );

  const goBack = useCallback(() => navigate('/app/library'), [navigate]);

  if (status === 'loading') {
    return (
      <PlayChrome onBack={goBack} title={navState?.title ?? ''} artist={navState?.artist ?? ''}>
        <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
          <Spinner />
          <span className="text-sm">Loading chart...</span>
        </div>
      </PlayChrome>
    );
  }

  // Order matters: `song` is null for both outcomes, so the error check has to come
  // first or a dropped connection reads as "this chart was deleted", which sends the
  // user looking for a problem that does not exist.
  if (status === 'error') {
    return (
      <PlayChrome onBack={goBack} title={navState?.title ?? ''}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <h2 className="font-display text-xl text-foreground">Could not load this chart</h2>
          <p className="text-sm">Check your connection and try again.</p>
          <div className="flex gap-2">
            <Button onClick={() => uuid && navigate(`/app/play/${uuid}`, { replace: true })}>
              Retry
            </Button>
            <Button variant="secondary" onClick={goBack}>
              Back to library
            </Button>
          </div>
        </div>
      </PlayChrome>
    );
  }

  if (status === 'notfound' || !song) {
    return (
      <PlayChrome onBack={goBack} title="">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <h2 className="font-display text-xl text-foreground">This chart is not here</h2>
          <p className="text-sm">It may have been deleted, or the link may be wrong.</p>
          <Button onClick={goBack}>Back to library</Button>
        </div>
      </PlayChrome>
    );
  }

  const hasDistinctOriginal =
    song.original_content.trim() !== '' &&
    song.original_content.trim() !== song.rewritten_content.trim();
  const activeVersion: SongVersion = hasDistinctOriginal ? perfVersion : 'rewritten';
  const activeContent =
    activeVersion === 'original' ? song.original_content : song.rewritten_content;
  const maxCols = maxColumnsForContent(activeContent);

  if (!activeContent.trim()) {
    return (
      <PlayChrome onBack={goBack} title={song.title ?? ''} artist={song.artist ?? ''}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <h2 className="font-display text-xl text-foreground">This chart is empty</h2>
          <p className="text-sm">There is nothing to play yet.</p>
          <Button variant="secondary" onClick={goBack}>
            Back to library
          </Button>
        </div>
      </PlayChrome>
    );
  }

  return (
    <PlayChrome
      onBack={goBack}
      title={song.title ?? ''}
      artist={song.artist ?? ''}
      actions={
        <>
          <button
            type="button"
            onClick={() => setTunerOpen(true)}
            className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-panel hover:text-foreground cursor-pointer"
            aria-label="Open tuner"
            title="Tuner"
          >
            {/* Tuning fork / guitar head glyph */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 3v8a3 3 0 006 0V3" />
              <path d="M12 14v7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={wakeLock.toggle}
            aria-pressed={wakeLock.enabled}
            className={cn(
              'min-h-[2.75rem] px-3 inline-flex items-center justify-center rounded-md border text-xs cursor-pointer whitespace-nowrap',
              wakeLock.enabled
                ? 'border-primary bg-primary text-white'
                : 'border-border text-muted-foreground hover:bg-panel hover:text-foreground',
            )}
            // Engaged on tap, never automatically: iOS Safari has no native wake
            // lock and the nosleep fallback must run inside a user gesture, so an
            // effect-driven "auto" would silently do nothing on an iPad.
            title="Keep the screen awake while you play"
          >
            {wakeLock.enabled ? 'Awake' : 'Stay awake'}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md border border-border text-xl leading-none text-muted-foreground hover:bg-panel hover:text-foreground cursor-pointer"
                aria-label="Chart actions"
              >
                &hellip;
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  api.downloadSongPdf(song.uuid, song.title, song.artist).catch(() => {})
                }
              >
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => ctx?.onLoadSong?.(song)}>
                Rewrite with AI
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      controls={
        <>
          {hasDistinctOriginal && (
            <div
              className="inline-flex rounded-md border border-border overflow-hidden shrink-0"
              role="group"
              aria-label="Song version"
            >
              {(['rewritten', 'original'] as const).map((v, i) => (
                <button
                  key={v}
                  onClick={() => setPerfVersion(v)}
                  aria-pressed={activeVersion === v}
                  className={cn(
                    'px-3 min-h-[2.75rem] text-xs font-medium cursor-pointer transition-colors',
                    i > 0 && 'border-l border-border',
                    activeVersion === v
                      ? 'bg-primary text-white'
                      : 'bg-transparent text-muted-foreground hover:bg-panel hover:text-foreground',
                  )}
                >
                  {v === 'rewritten' ? 'Your Version' : 'Original'}
                </button>
              ))}
            </div>
          )}
          <FontSizeStepper
            value={fontSize}
            autoSize={autoFontSize}
            onChange={setFontSize}
            onCommit={persistFontSize}
          />
          {maxCols >= 2 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="whitespace-nowrap">Columns</span>
              <Select
                value={String(perfColumns)}
                onChange={(e) => {
                  const v = e.target.value;
                  setPerfColumns(v === 'auto' ? 'auto' : (Number(v) as ColumnPref));
                }}
                className="w-auto px-2 py-1 text-xs"
                aria-label="Number of columns"
              >
                <option value="auto">Auto</option>
                {Array.from({ length: maxCols }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </>
      }
    >
      <PerformanceSheet
        song={song}
        version={activeVersion}
        className="flex-1 min-h-0"
        fontSizeOverride={fontSize}
        columnsPref={perfColumns}
        llmModel={ctx?.llmSettings?.model}
        onAutoFontSize={setAutoFontSize}
      />
      <TunerDialog open={tunerOpen} onOpenChange={setTunerOpen} />
    </PlayChrome>
  );
}

interface PlayChromeProps {
  onBack: () => void;
  title: string;
  artist?: string;
  actions?: React.ReactNode;
  controls?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared frame for every play-route state, so loading, not-found, error, and the
 * chart itself all keep a route home. A full-screen surface with no way back is
 * a dead end, and this route has no header or tab bar to escape through.
 */
function PlayChrome({ onBack, title, artist, actions, controls, children }: PlayChromeProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-1 py-1 flex-wrap">
        <button
          onClick={onBack}
          className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-panel hover:text-foreground cursor-pointer"
          aria-label="Back to library"
        >
          &larr;
        </button>
        <div className="flex-1 min-w-0">
          <span className="font-display text-lg font-bold text-foreground truncate">
            {title || 'Untitled'}
          </span>
          {artist && <span className="text-sm text-muted-foreground ml-2">{artist}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
      </div>
      {controls && (
        <div className="shrink-0 flex items-center gap-2 px-1 pb-1 flex-wrap">{controls}</div>
      )}
      {children}
    </div>
  );
}
