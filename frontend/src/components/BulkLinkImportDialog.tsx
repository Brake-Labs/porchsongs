import { useRef, useState } from 'react';
import api from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** Pull the http(s) URLs out of pasted text, deduped, in paste order. */
export function parseUrlList(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const token of text.split(/\s+/)) {
    const trimmed = token.trim();
    if (!/^https?:\/\/\S+$/i.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    urls.push(trimmed);
  }
  return urls;
}

type ItemStatus = 'pending' | 'importing' | 'imported' | 'skipped' | 'failed';

interface Item {
  url: string;
  status: ItemStatus;
  detail?: string;
}

interface BulkLinkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: number | null;
  /** source_urls already in the library, so re-pasting the same list is a no-op. */
  existingSourceUrls: Set<string>;
  /** Called once, after a run that imported at least one chart. */
  onImported: () => void;
  /** Pause between fetches. The scrape happens server-side against the linked
      site, so a paste of fifty links must not become fifty requests in one
      burst from one host. Overridable for tests. */
  delayMs?: number;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'Waiting',
  importing: 'Importing…',
  imported: 'Imported',
  skipped: 'Already in library',
  failed: 'Failed',
};

export default function BulkLinkImportDialog({
  open,
  onOpenChange,
  profileId,
  existingSourceUrls,
  onImported,
  delayMs = 2000,
}: BulkLinkImportDialogProps) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'input' | 'running' | 'done'>('input');
  const [items, setItems] = useState<Item[]>([]);
  const cancelRef = useRef(false);
  const importedRef = useRef(0);

  const urlCount = parseUrlList(text).length;

  const setItem = (index: number, patch: Partial<Item>) => {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const reset = () => {
    setText('');
    setPhase('input');
    setItems([]);
    cancelRef.current = false;
    importedRef.current = 0;
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && phase === 'running') {
      // Closing mid-run means "stop", not "vanish with the run still going".
      // The loop notices at its next await and lands on the summary.
      cancelRef.current = true;
      return;
    }
    if (!next) {
      if (importedRef.current > 0) onImported();
      reset();
    }
    onOpenChange(next);
  };

  const runImport = async () => {
    if (profileId == null) return;
    const urls = parseUrlList(text);
    if (urls.length === 0) return;
    const initial: Item[] = urls.map(url => ({ url, status: 'pending' }));
    setItems(initial);
    setPhase('running');
    cancelRef.current = false;

    let didWork = false;
    for (const [i, url] of urls.entries()) {
      if (cancelRef.current) {
        setItem(i, { status: 'skipped', detail: 'Canceled' });
        continue;
      }
      if (existingSourceUrls.has(url)) {
        setItem(i, { status: 'skipped' });
        continue;
      }
      // Pace between fetches, not before the first one and not after skips.
      if (didWork && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        if (cancelRef.current) {
          setItem(i, { status: 'skipped', detail: 'Canceled' });
          continue;
        }
      }
      didWork = true;
      setItem(i, { status: 'importing' });
      try {
        const scraped = await api.scrapeUrl({ profile_id: profileId, url });
        // Saved as-is: link imports are already formatted charts, so they skip
        // the AI parse the single-link importer offers and cost no credits.
        const content = scraped.text.slice(0, 100_000);
        await api.saveSong({
          profile_id: profileId,
          title: scraped.title,
          artist: scraped.artist,
          source_url: url,
          original_content: content,
          rewritten_content: content,
          tags: [],
        });
        importedRef.current += 1;
        setItem(i, { status: 'imported' });
      } catch (err) {
        setItem(i, {
          status: 'failed',
          detail: err instanceof Error ? err.message : 'Import failed',
        });
      }
    }
    setPhase('done');
  };

  const counts = items.reduce(
    (acc, it) => {
      acc[it.status] += 1;
      return acc;
    },
    { pending: 0, importing: 0, imported: 0, skipped: 0, failed: 0 } as Record<ItemStatus, number>,
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from links</DialogTitle>
        </DialogHeader>
        <div className="px-5 py-4 flex flex-col gap-3">
          {phase === 'input' && (
            <>
              <p className="text-sm text-muted-foreground">
                Paste links to chord pages, one per line. Each page is fetched and
                saved to your library as-is; no AI credits are used.
              </p>
              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={8}
                placeholder={'https://example.com/my-song-chords\nhttps://example.com/another-song'}
                aria-label="Links to import"
                className="font-mono text-xs"
              />
            </>
          )}
          {phase !== 'input' && (
            <ul className="max-h-64 overflow-y-auto flex flex-col gap-1" aria-label="Import progress">
              {items.map(it => (
                <li key={it.url} className="flex items-baseline gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono" title={it.url}>
                    {it.url}
                  </span>
                  <span
                    className={cn(
                      'shrink-0',
                      it.status === 'imported' && 'text-success',
                      it.status === 'failed' && 'text-danger',
                      (it.status === 'pending' || it.status === 'skipped') && 'text-muted-foreground',
                    )}
                  >
                    {it.detail ?? STATUS_LABEL[it.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {phase === 'input' &&
              (urlCount > 0 ? `${urlCount} link${urlCount === 1 ? '' : 's'} found` : ' ')}
            {phase === 'running' &&
              `Importing ${counts.imported + counts.skipped + counts.failed + 1} of ${items.length}…`}
            {phase === 'done' &&
              `Done: ${counts.imported} imported, ${counts.skipped} skipped, ${counts.failed} failed`}
          </p>
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          {phase === 'input' && (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void runImport()} disabled={urlCount === 0 || profileId == null}>
                Import {urlCount > 0 ? urlCount : ''} link{urlCount === 1 ? '' : 's'}
              </Button>
            </>
          )}
          {phase === 'running' && (
            <Button variant="secondary" onClick={() => (cancelRef.current = true)}>
              Stop after this one
            </Button>
          )}
          {phase === 'done' && <Button onClick={() => handleOpenChange(false)}>Close</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
