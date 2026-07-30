import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import FollowDebugOverlay from '@/components/FollowDebugOverlay';
import type { UseFollowResult } from '@/hooks/useFollow';
import type { LyricState } from '@/lib/followAlign';

interface FollowControlsProps {
  follow: UseFollowResult;
  followOn: boolean;
  paused: boolean;
  /** Whether any recognizer is available in this browser. */
  supported: boolean;
  /** True when the active provider runs on-device (whisper), which downloads a model. */
  onDevice: boolean;
  lyricStates: LyricState[];
  debug: boolean;
  onToggleFollow: () => void;
  onResume: () => void;
  onDemo: () => void;
  onSaveJson: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  'permission-denied': 'Microphone blocked',
  'not-found': 'No microphone found',
  unsupported: 'Not supported here',
  'insecure-context': 'Needs a secure (https) page',
  aborted: 'Mic stopped',
  network: 'Network error',
  'model-download-failed': "Couldn't download voice model",
  'model-init-failed': "Voice model couldn't start",
};

/** The pill's short label for each lifecycle phase. */
function phaseLabel(follow: UseFollowResult, followOn: boolean, paused: boolean): string {
  if (!followOn) return 'Follow';
  if (follow.error) return 'Mic error';
  switch (follow.phase) {
    case 'preparing':
      return 'Preparing';
    case 'downloading': {
      const f = follow.progress?.fraction;
      return f != null ? `Downloading ${Math.round(f * 100)}%` : 'Downloading';
    }
    case 'ready':
    case 'listening':
      return 'Listening';
    case 'tracking':
      return paused ? 'Paused' : 'Following';
    default:
      return paused ? 'Paused' : 'Following';
  }
}

/**
 * The visible Follow-mode chrome layered over the performance sheet: the primary
 * Follow toggle (whose label honestly reflects the on-device model's
 * prepare/download phases rather than claiming "Following" while a model is
 * still downloading), the "Resume follow" affordance after a manual scroll, and
 * (only under ?followdebug) the diagnostics HUD with demo/record controls.
 */
export default function FollowControls({
  follow,
  followOn,
  paused,
  supported,
  onDevice,
  lyricStates,
  debug,
  onToggleFollow,
  onResume,
  onDemo,
  onSaveJson,
}: FollowControlsProps) {
  const label = phaseLabel(follow, followOn, paused);
  const isTracking = followOn && !follow.error && follow.phase === 'tracking' && !paused;
  const isPreparing = followOn && !follow.error && (follow.phase === 'preparing' || follow.phase === 'downloading');
  const tooltip = !supported
    ? 'Hands-free follow needs Chrome, Edge, or a browser with on-device speech support'
    : onDevice
      ? 'Hands-free follow, runs on your device'
      : 'Hands-free follow';

  return (
    <>
      {/* Primary toggle */}
      <div className="absolute right-2 top-2 z-20 flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onToggleFollow}
          aria-pressed={followOn}
          aria-label={`Follow mode: ${label}`}
          title={tooltip}
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
              isTracking
                ? 'animate-pulse bg-white'
                : isPreparing
                  ? 'animate-pulse bg-white/70'
                  : followOn
                    ? 'bg-white/70'
                    : 'bg-primary',
            )}
          />
          {label}
        </button>

        {/* Honest first-run setup note: progress + the privacy win, only for the
            on-device path (Web Speech routes audio to a third party, so the
            "stays on your device" line would be false there). */}
        {isPreparing && onDevice && (
          <div className="max-w-[220px] rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground shadow-sm">
            <div className="font-medium text-foreground">
              {follow.phase === 'downloading' ? 'Setting up hands-free Follow' : 'Starting voice model'}
            </div>
            <div>One-time setup on this browser. Your voice never leaves your device.</div>
            {follow.phase === 'downloading' && follow.progress?.fraction != null && (
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-panel">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${Math.round(follow.progress.fraction * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {followOn && follow.error && (
          <span className="rounded bg-danger-light px-2 py-0.5 text-[11px] text-danger" role="alert">
            {ERROR_MESSAGES[follow.error.type] ?? follow.error.type}
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
