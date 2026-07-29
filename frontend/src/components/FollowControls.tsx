import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import FollowDebugOverlay from '@/components/FollowDebugOverlay';
import type { UseFollowResult } from '@/hooks/useFollow';
import type { LyricState } from '@/lib/followAlign';

interface FollowControlsProps {
  follow: UseFollowResult;
  followOn: boolean;
  paused: boolean;
  micSupported: boolean;
  lyricStates: LyricState[];
  debug: boolean;
  onToggleFollow: () => void;
  onResume: () => void;
  onDemo: () => void;
  onSaveJson: () => void;
}

/**
 * The visible Follow-mode chrome layered over the performance sheet: the
 * primary Follow toggle, the "Resume follow" affordance after a manual scroll,
 * and (only under ?followdebug) the diagnostics HUD with demo/record controls.
 */
export default function FollowControls({
  follow,
  followOn,
  paused,
  micSupported,
  lyricStates,
  debug,
  onToggleFollow,
  onResume,
  onDemo,
  onSaveJson,
}: FollowControlsProps) {
  const label = !followOn
    ? 'Follow'
    : follow.error
      ? 'Mic error'
      : paused
        ? 'Paused'
        : 'Following';

  return (
    <>
      {/* Primary toggle */}
      <div className="absolute right-2 top-2 z-20 flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onToggleFollow}
          aria-pressed={followOn}
          aria-label={`Follow mode: ${label}`}
          title={!micSupported ? 'Voice follow needs Chrome or Edge' : 'Hands-free follow'}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors cursor-pointer',
            followOn
              ? 'border-primary bg-primary text-white'
              : 'border-border bg-card text-foreground hover:bg-panel',
          )}
        >
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              followOn && !paused && !follow.error
                ? 'animate-pulse bg-white'
                : followOn
                  ? 'bg-white/70'
                  : 'bg-primary',
            )}
          />
          {label}
        </button>
        {followOn && follow.error && (
          <span className="rounded bg-danger-light px-2 py-0.5 text-[11px] text-danger" role="alert">
            {follow.error.type}
          </span>
        )}
      </div>

      {/* Resume affordance after a manual scroll */}
      {followOn && paused && (
        <button
          type="button"
          onClick={onResume}
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg cursor-pointer"
        >
          Resume follow
        </button>
      )}

      {/* Diagnostics HUD (dev only) */}
      {debug && (
        <div className="absolute bottom-3 right-3 z-20 w-80 max-w-[calc(100%-1.5rem)] max-h-[60%] overflow-auto rounded-lg border border-border bg-card text-foreground shadow-2xl ring-1 ring-black/10">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Follow · debug
          </div>
          <div className="p-3">
            <FollowDebugOverlay
              estimate={follow.estimate}
              lyricStates={lyricStates}
              recentWords={follow.recentWords}
              running={follow.running}
              recording={follow.recording}
              error={follow.error}
              lastArbiter={follow.lastArbiter}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-border bg-panel px-3 py-2">
            <Button size="sm" variant="secondary" onClick={onDemo} disabled={lyricStates.length === 0}>
              Play demo
            </Button>
            {follow.recording ? (
              <Button size="sm" variant="secondary" onClick={onSaveJson}>
                Save JSON
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={follow.startRecording}>
                Record
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
