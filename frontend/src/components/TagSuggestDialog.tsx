import { useEffect, useState } from 'react';
import api from '@/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import { isQuotaError, QuotaUpgradeLink } from '@/extensions';
import type { ApiError } from '@/api';
import type { TagSuggestion, Song } from '@/types';

interface TagSuggestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: Song | null;
  /**
   * Model id to send. Empty in premium, where the guard middleware pins the
   * platform model server-side, so this is not the availability signal.
   */
  model: string;
  /** False on an install with no gateway or no model picked. */
  canUseAi: boolean;
  /** Called with the song's full new tag list. The dialog never saves anything itself. */
  onApply: (song: Song, tags: string[]) => void;
  onOpenSettings?: () => void;
}

type Phase = 'offer' | 'loading' | 'done' | 'error';

/**
 * Opt-in, per chart: "what is this?"
 *
 * Importing a chart is free and makes no LLM call, and that is the whole point
 * of the pricing story, so organising cannot ride along on the import path.
 * This is the other half of that trade: one deliberate tap, on one chart, with
 * the price on the button before you press it.
 *
 * Two steps, deliberately. The first buys the suggestions, the second saves
 * them. Nothing is created or applied in between, and the suggestions arrive
 * pre-ticked only because a run nobody applies is a credit spent for nothing.
 */
export default function TagSuggestDialog({
  open,
  onOpenChange,
  song,
  model,
  canUseAi,
  onApply,
  onOpenSettings,
}: TagSuggestDialogProps) {
  const [phase, setPhase] = useState<Phase>('offer');
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | undefined>();

  // Each opening starts over, so a suggestion for the last chart is never left
  // sitting in front of a different one.
  useEffect(() => {
    if (open) {
      setPhase('offer');
      setSuggestions([]);
      setPicked([]);
      setError(null);
      setErrorType(undefined);
    }
  }, [open, song?.uuid]);

  const handleSuggest = async () => {
    if (!song) return;
    setPhase('loading');
    try {
      const result = await api.suggestTags(song.id, model);
      setSuggestions(result);
      // Ticked by default. A credit was already spent, and somebody who
      // disagrees with one of them unticks it in a tap.
      setPicked(result.map(s => s.tag));
      setPhase('done');
    } catch (err) {
      setError((err as Error).message);
      setErrorType((err as ApiError).errorType);
      setPhase('error');
    }
  };

  const toggle = (tag: string) => {
    setPicked(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  };

  const handleApply = () => {
    if (!song) return;
    const have = song.tags ?? [];
    const lower = new Set(have.map(t => t.toLowerCase()));
    const added = picked.filter(t => !lower.has(t.toLowerCase()));
    onApply(song, [...have, ...added]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suggest tags</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {phase === 'offer' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Reads this chart and suggests tags for it, preferring the tags you already
                use. Nothing is saved until you apply them.
              </p>
              {canUseAi ? (
                <p className="text-sm text-muted-foreground">Uses 1 AI credit.</p>
              ) : (
                // Same shape as the import screen's AI options: the action is
                // unavailable, the rest of tagging still works by hand.
                <p className="text-sm text-muted-foreground">
                  Select a model to use the AI options. Tagging charts by hand works without one.
                </p>
              )}
            </div>
          )}

          {phase === 'loading' && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Spinner size="sm" />
              <span>Thinking...</span>
            </div>
          )}

          {phase === 'done' && suggestions.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Untick anything that does not fit, then apply.
              </p>
              {suggestions.map((s) => (
                <label
                  key={s.tag}
                  className="flex items-center gap-3 w-full rounded-md border border-border px-3 py-2.5 text-sm cursor-pointer hover:border-primary hover:bg-panel"
                >
                  <input
                    type="checkbox"
                    className="accent-primary shrink-0"
                    checked={picked.includes(s.tag)}
                    onChange={() => toggle(s.tag)}
                  />
                  <span className="flex-1 truncate">{s.tag}</span>
                  {s.count === 0 && (
                    <span className="shrink-0 rounded-full bg-primary-light text-primary px-2 py-0.5 text-xs">
                      New tag
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}

          {phase === 'done' && suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No suggestion this time. You can still tag this chart from its menu.
            </p>
          )}

          {phase === 'error' && (
            <Alert variant="error">
              <div className="flex-1">
                <span>{error}</span>
                {isQuotaError(error ?? '', errorType) && (
                  <QuotaUpgradeLink className="ml-2 font-semibold text-primary underline" />
                )}
                {errorType?.startsWith('provider_') && (
                  <span className="block text-xs mt-1">Issue with the AI provider</span>
                )}
              </div>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {phase === 'done' || phase === 'error' ? 'Close' : 'Cancel'}
          </Button>
          {phase === 'done' && suggestions.length > 0 && (
            <Button onClick={handleApply} disabled={picked.length === 0}>
              {picked.length === 1 ? 'Add 1 tag' : `Add ${picked.length} tags`}
            </Button>
          )}
          {phase === 'offer' && !canUseAi
            ? onOpenSettings && (
                <Button
                  onClick={() => {
                    onOpenChange(false);
                    onOpenSettings();
                  }}
                >
                  Open settings
                </Button>
              )
            : (phase === 'offer' || phase === 'error') && (
                <Button onClick={handleSuggest} disabled={!song}>
                  {phase === 'error' ? 'Try again' : 'Suggest tags'}
                </Button>
              )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
