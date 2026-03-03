import { useState, useEffect, useRef, useCallback } from 'react';
import api, { STORAGE_KEYS } from '@/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import Spinner from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { shouldShowAbcModelSelector } from '@/extensions/settings';
import type { AbcResult, LlmSettings, SavedModel } from '@/types';

interface MidiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songContent: string;
  songTitle?: string;
  songArtist?: string;
  profileId: number;
  llmSettings: LlmSettings;
  savedModels: SavedModel[];
  isPremium: boolean;
  isAdmin: boolean;
}

type GenerateState =
  | { phase: 'idle' }
  | { phase: 'generating'; reasoning: string; tokens: string }
  | { phase: 'done'; result: AbcResult }
  | { phase: 'error'; message: string };

export default function MidiDialog({
  open,
  onOpenChange,
  songContent,
  songTitle,
  songArtist,
  profileId,
  llmSettings,
  savedModels,
  isPremium,
  isAdmin,
}: MidiDialogProps) {
  const [provider, setProvider] = useState(
    () => localStorage.getItem(STORAGE_KEYS.ABC_PROVIDER) || llmSettings.provider
  );
  const [model, setModel] = useState(
    () => localStorage.getItem(STORAGE_KEYS.ABC_MODEL) || llmSettings.model
  );
  const [state, setState] = useState<GenerateState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const abcContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthRef = useRef<any>(null);
  const showModelSelector = shouldShowAbcModelSelector(isPremium, isAdmin);

  // Get unique providers from saved models
  const providers = [...new Set(savedModels.map(m => m.provider))];
  const modelsForProvider = savedModels
    .filter(m => m.provider === provider)
    .map(m => m.model);

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    localStorage.setItem(STORAGE_KEYS.ABC_PROVIDER, newProvider);
    // Pick first model for this provider
    const firstModel = savedModels.find(m => m.provider === newProvider)?.model || '';
    setModel(firstModel);
    localStorage.setItem(STORAGE_KEYS.ABC_MODEL, firstModel);
  };

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    localStorage.setItem(STORAGE_KEYS.ABC_MODEL, newModel);
  };

  const handleGenerate = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ phase: 'generating', reasoning: '', tokens: '' });

    try {
      const result = await api.abcStream(
        {
          profile_id: profileId,
          content: songContent,
          title: songTitle || undefined,
          artist: songArtist || undefined,
          provider,
          model,
        },
        (token) => {
          setState(prev =>
            prev.phase === 'generating'
              ? { ...prev, tokens: prev.tokens + token }
              : prev
          );
        },
        controller.signal,
        (reasoning) => {
          setState(prev =>
            prev.phase === 'generating'
              ? { ...prev, reasoning: prev.reasoning + reasoning }
              : prev
          );
        },
      );
      setState({ phase: 'done', result });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setState({ phase: 'idle' });
        return;
      }
      setState({ phase: 'error', message: (err as Error).message });
    }
  }, [profileId, songContent, songTitle, songArtist, provider, model]);

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  // Render ABC notation when done
  useEffect(() => {
    if (state.phase !== 'done' || !state.result.abc || !abcContainerRef.current) return;

    let cancelled = false;

    (async () => {
      const abcjs = await import('abcjs');
      if (cancelled) return;

      const visualObj = abcjs.renderAbc(abcContainerRef.current!, state.result.abc!, {
        responsive: 'resize',
        add_classes: true,
      });

      // Set up synth if available
      if (abcjs.synth && visualObj[0]) {
        try {
          const synthControl = new abcjs.synth.SynthController();
          const target = document.getElementById('abc-audio');
          if (target) {
            synthControl.load(target, null, {
              displayLoop: true,
              displayRestart: true,
              displayPlay: true,
              displayProgress: true,
              displayWarp: true,
            });
            const synth = new abcjs.synth.CreateSynth();
            await synth.init({ visualObj: visualObj[0] });
            await synthControl.setTune(visualObj[0], false);
            synthRef.current = synthControl;
          }
        } catch {
          // Synth may not work in all browsers
        }
      }
    })();

    return () => { cancelled = true; };
  }, [state]);

  // Cleanup synth on close
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      synthRef.current = null;
      setState({ phase: 'idle' });
    }
  }, [open]);

  const hasModel = provider && model;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Sheet Music{songTitle ? `: ${songTitle}` : ''}</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex-1 min-h-0 overflow-y-auto space-y-4">
          {/* Model selector */}
          {showModelSelector && (
            <div className="flex gap-2 items-center">
              <Select
                value={provider}
                onChange={e => handleProviderChange(e.target.value)}
                className="w-36 text-xs h-8 py-0"
                disabled={state.phase === 'generating'}
              >
                {providers.length === 0 && <option value="">No providers</option>}
                {providers.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
              <Select
                value={model}
                onChange={e => handleModelChange(e.target.value)}
                className="flex-1 text-xs h-8 py-0"
                disabled={state.phase === 'generating'}
              >
                {modelsForProvider.length === 0 && <option value="">No models</option>}
                {modelsForProvider.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </div>
          )}

          {/* Idle state */}
          {state.phase === 'idle' && (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4 text-sm">
                Generate sheet music with audio playback from your song.
              </p>
              <Button onClick={handleGenerate} disabled={!hasModel}>
                Generate Sheet Music
              </Button>
              {!hasModel && (
                <p className="text-xs text-muted-foreground mt-2">Select a model first</p>
              )}
            </div>
          )}

          {/* Generating state */}
          {state.phase === 'generating' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Spinner size="sm" />
                <span className="text-sm text-muted-foreground">Generating sheet music...</span>
              </div>
              {state.reasoning && (
                <pre className="whitespace-pre-wrap break-words text-xs font-mono max-h-32 overflow-y-auto opacity-70 bg-panel rounded-md p-3">
                  {state.reasoning}
                </pre>
              )}
              {state.tokens && (
                <pre className="whitespace-pre-wrap break-words text-xs font-mono max-h-48 overflow-y-auto bg-panel rounded-md p-3">
                  {state.tokens}
                </pre>
              )}
            </div>
          )}

          {/* Done - ABC notation */}
          {state.phase === 'done' && state.result.abc && (
            <div className="space-y-3">
              <div
                ref={abcContainerRef}
                className={cn(
                  'bg-white rounded-md p-4 overflow-x-auto',
                  '[&_svg]:max-w-full [&_svg]:h-auto'
                )}
              />
              <div id="abc-audio" className="[&_.abcjs-inline-audio]:bg-panel [&_.abcjs-inline-audio]:rounded-md [&_.abcjs-inline-audio]:p-2" />
              {state.result.explanation && (
                <p className="text-xs text-muted-foreground">{state.result.explanation}</p>
              )}
            </div>
          )}

          {/* Done - Tips */}
          {state.phase === 'done' && state.result.tips && (
            <Alert variant="warning">
              <div className="whitespace-pre-wrap text-sm">{state.result.tips}</div>
            </Alert>
          )}

          {/* Error state */}
          {state.phase === 'error' && (
            <Alert variant="error">
              <span>{state.message}</span>
              <Button variant="secondary" size="sm" onClick={handleGenerate}>
                Try Again
              </Button>
            </Alert>
          )}
        </DialogBody>

        <DialogFooter>
          {state.phase === 'generating' && (
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          )}
          {(state.phase === 'done' || state.phase === 'error') && (
            <Button variant="secondary" onClick={handleGenerate} disabled={!hasModel}>
              Regenerate
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
