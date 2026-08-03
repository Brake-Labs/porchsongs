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
import type { FolderSuggestion, Song } from '@/types';

interface FolderSuggestDialogProps {
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
  /** Called with the folder the user tapped. The dialog never files anything itself. */
  onPick: (song: Song, folder: string) => void;
  onOpenSettings?: () => void;
}

type Phase = 'offer' | 'loading' | 'done' | 'error';

/**
 * Opt-in, per chart: "where should this go?"
 *
 * Importing a chart is free and makes no LLM call, and that is the whole point
 * of the pricing story, so organising cannot ride along on the import path.
 * This is the other half of that trade: one deliberate tap, on one chart, with
 * the price on the button before you press it.
 *
 * Two taps, deliberately. The first buys a suggestion, the second files the
 * chart. Nothing is created or moved in between.
 */
export default function FolderSuggestDialog({
  open,
  onOpenChange,
  song,
  model,
  canUseAi,
  onPick,
  onOpenSettings,
}: FolderSuggestDialogProps) {
  const [phase, setPhase] = useState<Phase>('offer');
  const [suggestions, setSuggestions] = useState<FolderSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | undefined>();

  // Each opening starts over, so a suggestion for the last chart is never left
  // sitting in front of a different one.
  useEffect(() => {
    if (open) {
      setPhase('offer');
      setSuggestions([]);
      setError(null);
      setErrorType(undefined);
    }
  }, [open, song?.uuid]);

  const handleSuggest = async () => {
    if (!song) return;
    setPhase('loading');
    try {
      const result = await api.suggestFolder(song.id, model);
      setSuggestions(result);
      setPhase('done');
    } catch (err) {
      setError((err as Error).message);
      setErrorType((err as ApiError).errorType);
      setPhase('error');
    }
  };

  const handlePick = (folder: string) => {
    if (!song) return;
    onPick(song, folder);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suggest a folder</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {phase === 'offer' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Reads this chart and suggests where to file it, sorted by your existing folders.
                Nothing moves until you pick one.
              </p>
              {canUseAi ? (
                <p className="text-sm text-muted-foreground">Uses 1 AI credit.</p>
              ) : (
                // Same shape as the import screen's AI options: the action is
                // unavailable, the rest of filing still works by hand.
                <p className="text-sm text-muted-foreground">
                  Select a model to use the AI options. Filing charts by hand works without one.
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
              <p className="text-sm text-muted-foreground">Pick one to file this chart.</p>
              {suggestions.map((s) => (
                <button
                  key={`${s.is_new ? 'new' : 'old'}-${s.folder}`}
                  type="button"
                  onClick={() => handlePick(s.folder)}
                  className="flex items-center justify-between gap-3 w-full text-left rounded-md border border-border px-3 py-2.5 text-sm cursor-pointer hover:border-primary hover:bg-panel"
                >
                  <span className="truncate">{s.folder}</span>
                  {s.is_new && (
                    <span className="shrink-0 rounded-full bg-primary-light text-primary px-2 py-0.5 text-xs">
                      New folder
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {phase === 'done' && suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No suggestion this time. You can still file this chart from its menu.
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
                  {phase === 'error' ? 'Try again' : 'Suggest a folder'}
                </Button>
              )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
