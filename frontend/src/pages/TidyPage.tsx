import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '@/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import Spinner from '@/components/ui/spinner';
import { UNKNOWN_ARTIST_KEY } from '@/lib/artists';
import { buildProposals, hasChange, type MetaSource, type TidyProposal } from '@/lib/tidy';
import type { Song } from '@/types';

/** Where the library's Unknown artist bucket lives, for the way back. */
const UNKNOWN_BUCKET_URL =
  `/app/library?view=artists&artist=${encodeURIComponent(UNKNOWN_ARTIST_KEY)}`;

/**
 * Quick fills for a song that genuinely has no artist to find.
 *
 * These write a real artist value rather than marking the song as skipped, which
 * is what lets the bucket actually empty. A fiddle tune is by Traditional in the
 * same sense that anything is by anyone, and a song the user wrote is by them;
 * both are answers, not evasions, and both file the chart somewhere it can be
 * found again.
 */
const QUICK_FILLS = ['Traditional', 'Original'];

/** How many saves to have in flight at once when applying a batch. */
const APPLY_BATCH_SIZE = 8;

const SOURCE_LABEL: Record<MetaSource, string> = {
  filename: 'from the filename',
  chart: 'from the chart',
  library: 'from your other songs',
};

interface RowState {
  title: string;
  artist: string;
  picked: boolean;
}

/** Unreachable in practice: every rendered row has a proposal behind it. */
const EMPTY_ROW: RowState = { title: '', artist: '', picked: false };

/** The values a row would save, compared against what the song already holds. */
function rowChanges(song: Song, row: RowState): { title?: string | null; artist?: string | null } {
  const changes: { title?: string | null; artist?: string | null } = {};
  const title = row.title.trim();
  const artist = row.artist.trim();
  if (title !== (song.title || '')) changes.title = title || null;
  if (artist !== (song.artist || '')) changes.artist = artist || null;
  return changes;
}

function hasEdits(song: Song, row: RowState): boolean {
  return Object.keys(rowChanges(song, row)).length > 0;
}

interface TidyRowProps {
  proposal: TidyProposal;
  row: RowState;
  onChange: (uuid: string, next: Partial<RowState>) => void;
}

function TidyRow({ proposal, row, onChange }: TidyRowProps) {
  const { song } = proposal;
  const uuid = song.uuid;
  const dirty = hasEdits(song, row);

  // Typing is an intention to save. Making the user tick a box after editing a
  // field would be the single most likely way to lose work on this screen.
  const edit = (next: Partial<RowState>) => onChange(uuid, { ...next, picked: true });

  return (
    <Card
      data-testid={`tidy-row-${uuid}`}
      className={row.picked && dirty ? 'p-3 border-primary' : 'p-3'}
    >
      <div className="flex gap-3">
        <Checkbox
          className="mt-2.5 shrink-0"
          checked={row.picked}
          disabled={!dirty}
          aria-label={`Apply changes to ${song.title || 'this song'}`}
          onChange={e => onChange(uuid, { picked: e.target.checked })}
        />
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {/* `aria-label` on the input rather than a wrapping label with an
              sr-only span. The span was both redundant, since an aria-label
              overrides a label element's text, and a layout bug: Tailwind's
              `sr-only` is `position: absolute`, `main` is not a containing
              block, so every one of them below the fold escaped that scroll
              container and stretched the document. */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              className="flex-1 min-w-0"
              value={row.title}
              placeholder="Song title"
              aria-label={`Title for ${song.title || 'this song'}`}
              onChange={e => edit({ title: e.target.value })}
            />
            <Input
              className="flex-1 min-w-0"
              value={row.artist}
              placeholder="Artist"
              aria-label={`Artist for ${song.title || 'this song'}`}
              onChange={e => edit({ artist: e.target.value })}
            />
          </div>

          {/* Offered whenever the field is empty, not only on rows the pass found
              nothing for: clearing a guess you disagree with should leave you the
              same one-tap answers as a row that never had one. */}
          {!row.artist.trim() && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {QUICK_FILLS.map(name => (
                <Button
                  key={name}
                  variant="secondary"
                  size="sm"
                  onClick={() => edit({ artist: name })}
                >
                  {name}
                </Button>
              ))}
            </div>
          )}

          {/* The evidence. The whole risk on this screen is a confidently wrong
              artist, so checking one has to cost a glance rather than a click
              through to the song. */}
          {proposal.evidence && (
            <p className="text-xs text-muted-foreground font-mono whitespace-pre-line line-clamp-3 break-words">
              {proposal.evidence}
            </p>
          )}

          {proposal.artistSource && (
            <p className="text-xs text-muted-foreground">
              Artist {SOURCE_LABEL[proposal.artistSource]}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The free pass over the library's "Unknown artist" bucket.
 *
 * Every guess on this screen is read from something already on the page: the
 * filename a tab arrived with, the head of a pasted chart, or the artist names
 * the user has already typed on their other songs. No LLM call, no credit, no
 * request beyond the library listing itself.
 *
 * Two steps, the same shape as `TagSuggestDialog`. The proposals arrive, and
 * nothing is written until the user applies them. Rows are pre-ticked because a
 * pass nobody applies is work for nothing, and every value is editable in place
 * because a guess the user cannot correct without leaving is a guess they will
 * decline instead of fixing.
 */
export default function TidyPage() {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, RowState>>({});
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    api.listSongs()
      .then(data => {
        setSongs(data);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        // Never present a load failure as "nothing to tidy". A user with a
        // hundred nameless charts and an expired session would otherwise be told
        // their library was already in order.
        setLoadError((err as Error)?.message || 'Could not load your library.');
        setLoaded(true);
      });
  }, []);

  const proposals = useMemo(() => buildProposals(songs), [songs]);

  /**
   * What each row shows before anybody touches it.
   *
   * Derived rather than copied into state by an effect. An effect would leave
   * the first paint with proposals but no rows, and the screen would render its
   * own list as empty for a frame. Only rows the user has actually edited live
   * in `edits`; everything else falls through to here, so a row reseeds itself
   * from the saved song the moment its uuid is dropped after a save.
   */
  const defaults = useMemo(() => {
    const map: Record<string, RowState> = {};
    for (const p of proposals) {
      map[p.song.uuid] = { title: p.title, artist: p.artist, picked: hasChange(p) };
    }
    return map;
  }, [proposals]);

  const rowOf = useCallback(
    (uuid: string): RowState => edits[uuid] ?? defaults[uuid] ?? EMPTY_ROW,
    [edits, defaults],
  );

  const setRow = useCallback((uuid: string, next: Partial<RowState>) => {
    setEdits(prev => {
      const base = prev[uuid] ?? defaults[uuid];
      if (!base) return prev;
      return { ...prev, [uuid]: { ...base, ...next } };
    });
  }, [defaults]);

  const pending = useMemo(
    () => proposals.filter(p => {
      const row = rowOf(p.song.uuid);
      return row.picked && hasEdits(p.song, row);
    }),
    [proposals, rowOf],
  );

  const freeFinds = useMemo(() => proposals.filter(p => p.artistSource !== null).length, [proposals]);

  const setAllPicked = (picked: boolean) => {
    setEdits(prev => {
      const next = { ...prev };
      for (const p of proposals) {
        const row = prev[p.song.uuid] ?? defaults[p.song.uuid];
        if (!row) continue;
        // Never tick a row with nothing to save: the count on the apply button
        // has to mean the number of songs that will change.
        if (!picked || hasEdits(p.song, row)) next[p.song.uuid] = { ...row, picked };
      }
      return next;
    });
  };

  /** Put back what a batch of saves overwrote. */
  const undo = async (before: Song[]) => {
    try {
      const restored = await Promise.all(
        before.map(song => api.updateSong(song.uuid, {
          title: song.title,
          artist: song.artist,
        } as Partial<Song>)),
      );
      setSongs(prev => prev.map(s => restored.find(r => r.uuid === s.uuid) ?? s));
      setEdits({});
      toast.success('Put back.');
    } catch (err) {
      toast.error('Could not undo: ' + (err as Error).message);
    }
  };

  const apply = async () => {
    if (pending.length === 0) return;
    setApplying(true);

    const before = pending.map(p => p.song);
    const saved: Song[] = [];
    const failures: string[] = [];

    // In batches rather than all at once. Somebody who has just imported a folder
    // of tabs can have a few hundred rows here, and firing that many writes in
    // one go is neither kind to the server nor recoverable when one fails.
    for (let i = 0; i < pending.length; i += APPLY_BATCH_SIZE) {
      const batch = pending.slice(i, i + APPLY_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(p => api.updateSong(
          p.song.uuid,
          rowChanges(p.song, rowOf(p.song.uuid)) as Partial<Song>,
        )),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') saved.push(result.value);
        else failures.push(batch[index]!.song.title || 'a song');
      });
    }

    if (saved.length > 0) {
      setSongs(prev => prev.map(s => saved.find(r => r.uuid === s.uuid) ?? s));
      // Dropped so the row falls back to a default rebuilt from the saved values.
      // A row that still has no artist stays in the list, correctly.
      setEdits(prev => {
        const next = { ...prev };
        for (const song of saved) delete next[song.uuid];
        return next;
      });
    }

    setApplying(false);

    if (failures.length > 0) {
      toast.error(
        saved.length > 0
          ? `Saved ${saved.length}. ${failures.length} could not be saved.`
          : 'Nothing could be saved. Check your connection and try again.',
      );
      return;
    }

    const undoable = before.filter(song => saved.some(s => s.uuid === song.uuid));
    toast.success(`Saved ${saved.length} ${saved.length === 1 ? 'song' : 'songs'}.`, {
      action: { label: 'Undo', onClick: () => void undo(undoable) },
    });
  };

  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <Spinner />
        <span className="text-sm">Loading your library...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link
          to={UNKNOWN_BUCKET_URL}
          className="text-xs text-primary font-semibold self-start hover:underline"
        >
          &larr; Back to the library
        </Link>
        <h1 className="font-display text-3xl sm:text-4xl">Name the unknowns</h1>
      </div>

      {loadError ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-danger">{loadError}</p>
        </Card>
      ) : proposals.length === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="font-display text-lg font-semibold text-foreground mb-2">
            Nothing to sort out
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Every song in your library has an artist on it.
          </p>
          <Button variant="secondary" onClick={() => navigate('/app/library')}>
            Back to the library
          </Button>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {proposals.length} {proposals.length === 1 ? 'song has' : 'songs have'} no artist.
            {freeFinds > 0
              ? ` ${freeFinds} of them can be named from what is already here, for free.`
              : ' None of them could be named from what is already here.'}
            {' '}Nothing is saved until you apply it.
          </p>

          <div
            data-testid="tidy-actions"
            className="flex items-center gap-2 flex-wrap sticky top-0 z-10 bg-background py-2"
          >
            <Button onClick={() => void apply()} disabled={pending.length === 0 || applying}>
              {applying
                ? 'Saving...'
                : pending.length === 1
                  ? 'Apply 1 change'
                  : `Apply ${pending.length} changes`}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAllPicked(true)}>
              Select all
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAllPicked(false)}>
              Clear
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {proposals.map(p => (
              <TidyRow
                key={p.song.uuid}
                proposal={p}
                row={rowOf(p.song.uuid)}
                onChange={setRow}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
