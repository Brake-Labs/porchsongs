import { useEffect, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils';
import type { Song } from '@/types';

interface TagEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: Song | null;
  /** Every tag in the library, so this is a picker first and a text field second. */
  allTags: string[];
  onSave: (song: Song, tags: string[]) => void;
}

/**
 * All of one song's tags at once.
 *
 * The song menu can toggle tags one at a time, which is the right shape for
 * "this one is also a waltz". It is the wrong shape for a song that needs four
 * tags it does not have yet, which is what this is for: tick what applies, type
 * anything new, save once.
 *
 * Existing tags come first as a picker. Typing is the fallback, not the primary
 * path, because a typed tag that differs by a capital letter or a plural from
 * one already in the library is how a tag list turns into a mess.
 */
export default function TagEditDialog({
  open,
  onOpenChange,
  song,
  allTags,
  onSave,
}: TagEditDialogProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTags(song?.tags ?? []);
      setDraft('');
    }
  }, [open, song?.uuid]);

  const has = (tag: string) => tags.some(t => t.toLowerCase() === tag.toLowerCase());

  const toggle = (tag: string) => {
    setTags(prev =>
      prev.some(t => t.toLowerCase() === tag.toLowerCase())
        ? prev.filter(t => t.toLowerCase() !== tag.toLowerCase())
        : [...prev, tag],
    );
  };

  const addDraft = () => {
    const name = draft.trim();
    if (!name) return;
    if (!has(name)) setTags(prev => [...prev, name]);
    setDraft('');
    inputRef.current?.focus();
  };

  const handleSave = () => {
    if (!song) return;
    // Whatever is sitting in the field was typed on purpose. Losing it because
    // somebody pressed Save instead of Enter is the kind of thing nobody
    // reports and everybody notices.
    const name = draft.trim();
    const next = name && !has(name) ? [...tags, name] : tags;
    onSave(song, next);
    onOpenChange(false);
  };

  const unused = allTags.filter(t => !has(t));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tags for {song?.title || 'this song'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                On this song
              </p>
              {tags.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tags yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggle(t)}
                      aria-label={`Remove ${t}`}
                      className="rounded-full bg-primary text-white border border-primary px-3 py-1 text-xs font-medium cursor-pointer"
                    >
                      {t} &times;
                    </button>
                  ))}
                </div>
              )}
            </div>

            {unused.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Tags you already use
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {unused.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggle(t)}
                      className={cn(
                        'rounded-full bg-card border border-border text-muted-foreground px-3 py-1 text-xs font-medium cursor-pointer',
                        'hover:border-primary hover:text-foreground',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={draft}
                placeholder="New tag"
                aria-label="New tag"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addDraft();
                  }
                }}
              />
              <Button variant="secondary" onClick={addDraft} disabled={!draft.trim()}>
                Add
              </Button>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!song}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
