import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { artistKeyOf } from '@/lib/artists';

export interface ArtistRenameTarget {
  /** The spelling shown on the card, which is what the endpoint is asked to match. */
  name: string;
  count: number;
}

interface ArtistRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: ArtistRenameTarget | null;
  /** Every artist in the library, so the merge can be spotted before it happens. */
  others: ArtistRenameTarget[];
  onConfirm: (from: string, to: string) => void;
}

/**
 * Rename an artist, and say so when that would merge two of them.
 *
 * Its own dialog rather than a `PromptDialog` because the warning has to appear
 * while the name is being typed. Renaming "Neil Young" to "Neil Young & Crazy
 * Horse" when both exist is a merge, and a merge is not reversible by renaming
 * back: the songs that were already under the destination cannot be told apart
 * from the ones that just arrived. Somebody who meant it should be able to do it
 * in one action, and somebody who did not should find out before they press the
 * button rather than after.
 */
export default function ArtistRenameDialog({
  open,
  onOpenChange,
  artist,
  others,
  onConfirm,
}: ArtistRenameDialogProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue(artist?.name ?? '');
  }, [open, artist]);

  const trimmed = value.trim();

  // The artist the typed name would land on, if any. Matched by the same folding
  // the library groups its cards by, so "neil young" finds "Neil Young".
  const mergeTarget = useMemo(() => {
    if (!trimmed || !artist) return null;
    const key = artistKeyOf(trimmed);
    if (key === artistKeyOf(artist.name)) return null;
    return others.find(o => artistKeyOf(o.name) === key) ?? null;
  }, [trimmed, artist, others]);

  const unchanged = !trimmed || (artist !== null && trimmed === artist.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename artist</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Changes the artist on {artist?.count === 1 ? 'the 1 chart' : `all ${artist?.count ?? 0} charts`}{' '}
              filed under {artist?.name}.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="artist-rename-input">Artist name</Label>
              <Input
                id="artist-rename-input"
                value={value}
                placeholder="Artist name"
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !unchanged && artist) {
                    e.preventDefault();
                    onConfirm(artist.name, trimmed);
                    onOpenChange(false);
                  }
                }}
              />
            </div>
            {mergeTarget && (
              <div
                data-testid="artist-merge-warning"
                className="rounded-md border border-primary bg-primary-light px-3 py-2 text-sm text-primary"
              >
                {mergeTarget.name} already has{' '}
                {mergeTarget.count === 1 ? '1 chart' : `${mergeTarget.count} charts`}. Renaming
                merges them into one artist, {(artist?.count ?? 0) + mergeTarget.count} in total,
                and that cannot be undone by renaming back.
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={unchanged}
            onClick={() => {
              if (!artist) return;
              onConfirm(artist.name, trimmed);
              onOpenChange(false);
            }}
          >
            {mergeTarget ? 'Merge' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
